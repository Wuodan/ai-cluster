import { randomUUID } from "node:crypto";

import type {
  AttemptOutcome,
  InferenceRequest,
  InferenceRunResult,
  InferenceSource,
  SourceResult,
  CurrentlyUnavailableResource,
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
    const unavailableResources: CurrentlyUnavailableResource[] = [];
    let suitableResourceCount = 0;

    for (const [index, source] of this.#sources.entries()) {
      const key = resourceKey(source);
      if (!await this.#store.resourceMeetsRequirements(key, request.requirements)) continue;
      suitableResourceCount += 1;
      let previousState = await this.#store.getResourceState(key);
      const selectionTimeMs = this.#now();
      if (previousState?.state === "disabled") {
        unavailableResources.push({
          sourceId: source.id,
          model: source.model,
          state: "disabled",
          reason: previousState.reason,
        });
        continue;
      }
      if (previousState?.retryAtMs !== undefined && previousState.retryAtMs > selectionTimeMs) {
        unavailableResources.push({
          sourceId: source.id,
          model: source.model,
          state: unavailableState(previousState.state),
          retryAtMs: previousState.retryAtMs,
          reason: previousState.reason,
        });
        continue;
      }
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
        ...(result.resolvedModel === undefined ? {} : { resolvedModel: result.resolvedModel }),
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
          requestId,
          sourceId: source.id,
          model: source.model,
          ...(result.resolvedModel === undefined ? {} : { resolvedModel: result.resolvedModel }),
          accessPath: source.accessPath,
          output: result.output,
        };
      }
    }

    if (suitableResourceCount === 0) {
      return {
        status: "no_suitable_source",
        requestId,
        requiredCapabilities: request.requirements?.capabilities ?? [],
        ...(request.requirements?.minimumContextTokens === undefined
          ? {}
          : { minimumContextTokens: request.requirements.minimumContextTokens }),
      };
    }
    if (outcomes.length === 0 && unavailableResources.length > 0) {
      return {
        status: "no_resource_currently_available",
        requestId,
        resources: unavailableResources,
      };
    }
    return { status: "no_source_succeeded", requestId, outcomes };
  }
}

export function resourceKey(source: Pick<InferenceSource, "id" | "model">): string {
  return `${source.id}:${source.model}`;
}

function unavailableState(state: string): CurrentlyUnavailableResource["state"] {
  if (state === "disabled" || state === "degraded" || state === "exhausted" || state === "cooling_down") {
    return state;
  }
  return "cooling_down";
}
