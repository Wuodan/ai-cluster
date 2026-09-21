import { randomUUID } from "node:crypto";

import type {
  AttemptOutcome,
  InferenceRequest,
  InferenceRunResult,
  InferenceSource,
  SourceResult,
} from "./resource.js";
import type { ResourceStore } from "./store.js";

export class ResourceLoop {
  readonly #sources: readonly InferenceSource[];
  readonly #store: ResourceStore;

  constructor(options: {
    readonly sources: readonly InferenceSource[];
    readonly allowedResources: ReadonlySet<string>;
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
  }

  async run(request: InferenceRequest): Promise<InferenceRunResult> {
    const requestId = randomUUID();
    const outcomes: AttemptOutcome[] = [];

    for (const [index, source] of this.#sources.entries()) {
      const startedAtMs = Date.now();
      let result: SourceResult;

      try {
        result = await source.invoke(request);
      } catch (error: unknown) {
        result = {
          outcome: "unknown_failure",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }

      const finishedAtMs = Date.now();
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

      if (result.outcome === "success" && result.output !== undefined) {
        return {
          status: "success",
          sourceId: source.id,
          model: source.model,
          output: result.output,
        };
      }
    }

    return { status: "no_source_succeeded", outcomes };
  }
}

export function resourceKey(source: Pick<InferenceSource, "id" | "model">): string {
  return `${source.id}:${source.model}`;
}
