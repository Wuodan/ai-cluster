import { evaluateSource } from "./capability.js";
import type { OpenRouterCatalog } from "./catalog.js";
import type { InferenceSource } from "./resource.js";
import { ResourceLoop, resourceKey } from "./resource-loop.js";
import type { MaintenanceRunRecord, ResourceStore } from "./store.js";

export interface MaintenanceTask {
  readonly kind: MaintenanceRunRecord["kind"];
  readonly target: string;
  readonly intervalMs: number;
  execute(): Promise<{ readonly outcome: "success" | "skipped"; readonly summary: string }>;
}

export async function runMaintenanceTask(
  task: MaintenanceTask,
  store: ResourceStore,
  now: () => number = Date.now,
): Promise<void> {
  const startedAtMs = now();
  try {
    const result = await task.execute();
    await store.recordMaintenanceRun({
      kind: task.kind,
      target: task.target,
      outcome: result.outcome,
      summary: result.summary,
      startedAtMs,
      finishedAtMs: now(),
    });
  } catch (error: unknown) {
    await store.recordMaintenanceRun({
      kind: task.kind,
      target: task.target,
      outcome: "failed",
      summary: error instanceof Error ? error.message : String(error),
      startedAtMs,
      finishedAtMs: now(),
    });
  }
}

export class MaintenanceScheduler {
  readonly #store: ResourceStore;
  readonly #tasks: readonly MaintenanceTask[];
  readonly #timers = new Set<NodeJS.Timeout>();
  #queue: Promise<void> = Promise.resolve();
  #stopped = true;

  constructor(tasks: readonly MaintenanceTask[], store: ResourceStore) {
    for (const task of tasks) {
      if (!Number.isSafeInteger(task.intervalMs) || task.intervalMs < 1_000) {
        throw new Error(`Invalid maintenance interval for ${task.kind}`);
      }
    }
    this.#tasks = tasks;
    this.#store = store;
  }

  start(runImmediately = true): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    for (const task of this.#tasks) this.#schedule(task, runImmediately ? 0 : task.intervalMs);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    await this.#queue;
  }

  #schedule(task: MaintenanceTask, delayMs: number): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (this.#stopped) return;
      this.#queue = this.#queue.then(() => runMaintenanceTask(task, this.#store));
      void this.#queue.finally(() => {
        if (!this.#stopped) this.#schedule(task, task.intervalMs);
      });
    }, delayMs);
    this.#timers.add(timer);
  }
}

export function createCatalogRefreshTask(
  catalog: OpenRouterCatalog,
  store: ResourceStore,
  intervalMs: number,
): MaintenanceTask {
  return {
    kind: "catalog_refresh",
    target: "openrouter",
    intervalMs,
    async execute() {
      const modelCount = await catalog.refresh(store);
      return { outcome: "success", summary: `observed_${modelCount}_free_models` };
    },
  };
}

export function createCapabilityEvaluationTask(
  sources: readonly InferenceSource[],
  allowedResources: ReadonlySet<string>,
  store: ResourceStore,
  intervalMs: number,
  now: () => number = Date.now,
): MaintenanceTask {
  return {
    kind: "capability_evaluation",
    target: "configured_pool",
    intervalMs,
    async execute() {
      let evaluated = 0;
      let skipped = 0;
      for (const source of sources) {
        const key = resourceKey(source);
        if (!allowedResources.has(key)) throw new Error(`Resource is not in the zero-cost allowlist: ${key}`);
        const state = await store.getResourceState(key);
        const currentTime = now();
        if (state?.state === "disabled" || (state?.retryAtMs !== undefined && state.retryAtMs > currentTime)) {
          skipped += 1;
          continue;
        }
        await evaluateSource(source, store);
        evaluated += 1;
      }
      return {
        outcome: evaluated === 0 ? "skipped" : "success",
        summary: `evaluated_${evaluated}_skipped_${skipped}`,
      };
    },
  };
}

export function createAvailabilityProbeTask(
  sources: readonly InferenceSource[],
  allowedResources: ReadonlySet<string>,
  store: ResourceStore,
  intervalMs: number,
  now: () => number = Date.now,
): MaintenanceTask {
  return {
    kind: "availability_probe",
    target: "configured_pool",
    intervalMs,
    async execute() {
      let probed = 0;
      let skipped = 0;
      for (const source of sources) {
        const key = resourceKey(source);
        const state = await store.getResourceState(key);
        const currentTime = now();
        if (
          state?.state === "available"
          || state?.state === "disabled"
          || (state?.retryAtMs !== undefined && state.retryAtMs > currentTime)
        ) {
          skipped += 1;
          continue;
        }
        const loop = new ResourceLoop({ sources: [source], allowedResources, store, now });
        await loop.run({ prompt: "Reply with exactly: resource-probe-ok", maxOutputTokens: 256 });
        probed += 1;
      }
      return {
        outcome: probed === 0 ? "skipped" : "success",
        summary: `probed_${probed}_skipped_${skipped}`,
      };
    },
  };
}
