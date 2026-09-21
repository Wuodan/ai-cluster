import { randomUUID } from "node:crypto";

import type {
  AttemptOutcome,
  InferenceRequest,
  InferenceRunResult,
  InferenceSource,
  SourceResult,
} from "./resource.js";
import { decideResourceState } from "./resource-state.js";
import type { ResourceStore } from "./store.js";

export class ResourceLoop {
  readonly #sources: readonly InferenceSource[];
  readonly #store: ResourceStore;
  readonly #now: () => number;

  constructor(options: {
    readonly sources: readonly InferenceSource[];
    readonly allowedResources: ReadonlySet<string>;
    readonly now?: () => number;
    readonly store: ResourceStore;
  }) {
    for (const source of options.sources) {
      const resource = resourceKey(source);
      if (!options.allowedResources.has(resource)) {
        throw new Error(`Resource is not in the zero-cost allowlist: ${resource}`);
      }
    }

    this.#sources = options.sources;
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
  }

  async run(request: InferenceRequest): Promise<InferenceRunResult> {
    const requestId = randomUUID();
    const outcomes: AttemptOutcome[] = [];
    let suitableResourceCount = 0;

    for (const [index, source] of this.#sources.entries()) {
      const key = resourceKey(source);
      if (!await this.#store.resourceMeetsRequirements(key, request.requirements)) continue;
      suitableResourceCount += 1;
      let previousState = await this.#store.getResourceState(key);
      const selectionTimeMs = this.#now();
      if (previousState?.state === "disabled") continue;
      if (previousState?.retryAtMs !== undefined && previousState.retryAtMs > selectionTimeMs) continue;
      if (previousState !== undefined && previousState.state !== "available" && previousState.state !== "unknown") {
        await this.#store.setResourceState({
          ...previousState,
          state: "unknown",
          observedAtMs: selectionTimeMs,
          reason: "cooldown_elapsed",
        });
        previousState = await this.#store.getResourceState(key);
      }

      const startedAtMs = this.#now();
      let result: SourceResult;

      try {
        result = await source.invoke(request);
      } catch (error: unknown) {
        result = {
          outcome: "unknown_failure",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }

      const finishedAtMs = this.#now();
      outcomes.push(result.outcome);
      await this.#store.recordAttempt({
        requestId,
        attemptNumber: index + 1,
        sourceId: source.id,
        model: source.model,
        outcome: result.outcome,
        startedAtMs,
        finishedAtMs,
        latencyMs: finishedAtMs - startedAtMs,
        ...(result.output === undefined ? {} : { output: result.output }),
        ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
        ...(result.errorMessage === undefined ? {} : { errorMessage: result.errorMessage }),
        ...(result.quota === undefined ? {} : { quota: result.quota }),
      });
      const decision = decideResourceState(
        result,
        previousState?.consecutiveFailures ?? 0,
        finishedAtMs,
      );
      await this.#store.setResourceState({
        resourceKey: key,
        sourceId: source.id,
        model: source.model,
        ...decision,
        observedAtMs: finishedAtMs,
      });

      if (result.outcome === "success" && result.output !== undefined) {
        return {
          status: "success",
          sourceId: source.id,
          model: source.model,
          output: result.output,
        };
      }
    }

    if (suitableResourceCount === 0) {
      return {
        status: "no_suitable_source",
        requiredCapabilities: request.requirements?.capabilities ?? [],
        ...(request.requirements?.minimumContextTokens === undefined
          ? {}
          : { minimumContextTokens: request.requirements.minimumContextTokens }),
      };
    }
    return { status: "no_source_succeeded", outcomes };
  }
}

export function resourceKey(source: Pick<InferenceSource, "id" | "model">): string {
  return `${source.id}:${source.model}`;
}
