import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAvailabilityProbeTask,
  createCapabilityEvaluationTask,
  runMaintenanceTask,
  type MaintenanceTask,
} from "../src/maintenance.js";
import type { InferenceRequest, InferenceSource, SourceResult } from "../src/resource.js";
import { resourceKey } from "../src/resource-loop.js";
import { ResourceStore } from "../src/store.js";

test("maintenance records success and failure without throwing", async () => {
  const store = new ResourceStore(":memory:");
  let now = 100;
  const success: MaintenanceTask = {
    kind: "catalog_refresh",
    target: "provider",
    intervalMs: 1_000,
    async execute() {
      return { outcome: "success", summary: "observed_2_free_models" };
    },
  };
  const failure: MaintenanceTask = {
    kind: "capability_evaluation",
    target: "provider",
    intervalMs: 1_000,
    async execute() {
      throw new Error("provider offline");
    },
  };

  await runMaintenanceTask(success, store, () => now++);
  await runMaintenanceTask(failure, store, () => now++);

  const runs = await store.listRecentMaintenanceRuns(10);
  assert.deepEqual(runs.map((run) => [run.kind, run.outcome, run.summary]), [
    ["capability_evaluation", "failed", "provider offline"],
    ["catalog_refresh", "success", "observed_2_free_models"],
  ]);
  store.close();
});

test("availability maintenance probes only unknown or retry-eligible resources", async () => {
  const store = new ResourceStore(":memory:");
  const unknown = new FakeSource("unknown", [{ outcome: "success", output: "resource-probe-ok" }]);
  const available = new FakeSource("available", []);
  await store.setResourceState({
    resourceKey: resourceKey(available),
    sourceId: available.id,
    model: available.model,
    state: "available",
    consecutiveFailures: 0,
    observedAtMs: 100,
    reason: "request_succeeded",
  });
  const allowed = new Set([resourceKey(unknown), resourceKey(available)]);

  const task = createAvailabilityProbeTask([unknown, available], allowed, store, 1_000, () => 200);
  await runMaintenanceTask(task, store, () => 200);

  assert.equal(unknown.calls, 1);
  assert.equal(available.calls, 0);
  assert.equal((await store.getResourceState(resourceKey(unknown)))?.state, "available");
  assert.equal((await store.listRecentMaintenanceRuns(1))[0]?.summary, "probed_1_skipped_1");
  store.close();
});

test("capability maintenance respects disabled state", async () => {
  const store = new ResourceStore(":memory:");
  const disabled = new FakeSource("disabled", []);
  await store.setResourceState({
    resourceKey: resourceKey(disabled),
    sourceId: disabled.id,
    model: disabled.model,
    state: "disabled",
    consecutiveFailures: 1,
    observedAtMs: 100,
    reason: "request_rejected",
  });

  const task = createCapabilityEvaluationTask(
    [disabled],
    new Set([resourceKey(disabled)]),
    store,
    1_000,
    () => 200,
  );
  await runMaintenanceTask(task, store, () => 200);

  assert.equal(disabled.calls, 0);
  assert.equal((await store.listRecentMaintenanceRuns(1))[0]?.outcome, "skipped");
  store.close();
});

class FakeSource implements InferenceSource {
  readonly model = "free-model";
  readonly accessPath = "api" as const;
  calls = 0;
  readonly #results: SourceResult[];

  constructor(readonly id: string, results: readonly SourceResult[]) {
    this.#results = [...results];
  }

  async invoke(_request: InferenceRequest): Promise<SourceResult> {
    this.calls += 1;
    return this.#results.shift() ?? { outcome: "unknown_failure" };
  }
}
