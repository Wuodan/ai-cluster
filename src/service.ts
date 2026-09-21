import type { InferenceRequest, InferenceRunResult, InferenceSource } from "./resource.js";
import { ResourceLoop, resourceKey } from "./resource-loop.js";
import type { ResourceStateRecord } from "./resource-state.js";
import type { ResourceStore, StoredCapabilityEvidence } from "./store.js";

export interface SelectionEvidence {
  readonly state?: ResourceStateRecord;
  readonly capabilities: readonly StoredCapabilityEvidence[];
}

export type ServiceInferenceResult = InferenceRunResult & {
  readonly evidence?: SelectionEvidence;
};

export class ResourceService {
  readonly #allowedResources: ReadonlySet<string>;
  readonly #loop: ResourceLoop;
  readonly #sources: readonly InferenceSource[];
  readonly #store: ResourceStore;

  constructor(options: {
    readonly sources: readonly InferenceSource[];
    readonly allowedResources: ReadonlySet<string>;
    readonly store: ResourceStore;
  }) {
    this.#sources = options.sources;
    this.#allowedResources = options.allowedResources;
    this.#store = options.store;
    this.#loop = new ResourceLoop(options);
  }

  async infer(request: InferenceRequest): Promise<ServiceInferenceResult> {
    const result = await this.#loop.run(request);
    if (result.status !== "success") return result;
    const key = `${result.sourceId}:${result.model}`;
    const state = await this.#store.getResourceState(key);
    return {
      ...result,
      evidence: {
        ...(state === undefined ? {} : { state }),
        capabilities: await this.#store.listCurrentObservedCapabilityEvidence(key),
      },
    };
  }

  async status(): Promise<unknown> {
    const persistedStates = new Map(
      (await this.#store.listResourceStates()).map((state) => [state.resourceKey, state]),
    );
    return {
      resources: await Promise.all(this.#sources.map(async (source) => {
        const key = resourceKey(source);
        return {
          resourceKey: key,
          sourceId: source.id,
          model: source.model,
          accessPath: source.accessPath,
          allowed: this.#allowedResources.has(key),
          state: persistedStates.get(key) ?? {
            resourceKey: key,
            sourceId: source.id,
            model: source.model,
            state: "unknown",
            consecutiveFailures: 0,
            reason: "not_yet_observed",
          },
          capabilities: await this.#store.listCurrentObservedCapabilityEvidence(key),
        };
      })),
    };
  }

  async history(limit = 100): Promise<unknown> {
    const states = await this.#store.listResourceStates();
    return {
      attempts: await this.#store.listRecentAttempts(limit),
      transitions: Object.fromEntries(await Promise.all(states.map(async (state) => [
        state.resourceKey,
        await this.#store.listStateTransitions(state.resourceKey),
      ]))),
      recoveryFindings: await this.#store.listRecoveryFindings(),
    };
  }

  async audit(): Promise<unknown> {
    const attempts = await this.#store.listAttempts();
    const selectionViolations = attempts.filter(
      (attempt) => !this.#allowedResources.has(`${attempt.sourceId}:${attempt.model}`),
    );
    const costGuardRejections = attempts.filter((attempt) => attempt.errorCode === "zero_cost_invariant");
    return {
      scope: "application_selection_policy",
      assessment: selectionViolations.length === 0 ? "no_paid_path_selected" : "selection_violation",
      paidInferenceAllowed: false,
      configuredResources: this.#sources.map((source) => ({
        resourceKey: resourceKey(source),
        allowed: this.#allowedResources.has(resourceKey(source)),
      })),
      attemptsAudited: attempts.length,
      selectionViolations,
      costGuardRejections: costGuardRejections.length,
      limitation: "This audit proves application selection behavior, not provider account balance.",
    };
  }
}
