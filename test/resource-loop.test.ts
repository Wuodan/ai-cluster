import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { InferenceRequest, InferenceSource, SourceResult } from "../src/resource.js";
import { ResourceLoop, resourceKey } from "../src/resource-loop.js";
import { ResourceStore } from "../src/store.js";

class FakeSource implements InferenceSource {
  readonly #results: SourceResult[];

  constructor(
    readonly id: string,
    readonly model: string,
    results: readonly SourceResult[],
  ) {
    this.#results = [...results];
  }

  async invoke(_request: InferenceRequest): Promise<SourceResult> {
    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("No fake result configured");
    }
    return result;
  }
}

test("falls back deterministically and records both attempts", async () => {
  const store = new ResourceStore(":memory:");
  const exhausted = new FakeSource("first", "free-a", [
    {
      outcome: "exhausted",
      errorCode: "rate_limit",
      quota: { requestsRemaining: 0, resetsAt: "2026-09-22T00:00:00Z" },
    },
  ]);
  const available = new FakeSource("second", "free-b", [
    { outcome: "success", output: "done" },
  ]);
  const loop = new ResourceLoop({
    sources: [exhausted, available],
    allowedResources: new Set([resourceKey(exhausted), resourceKey(available)]),
    store,
  });

  const result = await loop.run({ prompt: "work", maxOutputTokens: 32 });
  const attempts = await store.listAttempts();

  assert.deepEqual(result, {
    status: "success",
    sourceId: "second",
    model: "free-b",
    output: "done",
  });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.outcome, "exhausted");
  assert.equal(attempts[0]?.quota?.requestsRemaining, 0);
  assert.equal(attempts[1]?.outcome, "success");
  assert.equal(attempts[0]?.requestId, attempts[1]?.requestId);
  store.close();
});

test("converts a thrown source error into durable evidence", async () => {
  const store = new ResourceStore(":memory:");
  const broken: InferenceSource = {
    id: "broken",
    model: "free-c",
    async invoke() {
      throw new Error("network down");
    },
  };
  const loop = new ResourceLoop({
    sources: [broken],
    allowedResources: new Set([resourceKey(broken)]),
    store,
  });

  const result = await loop.run({ prompt: "work", maxOutputTokens: 32 });
  const attempts = await store.listAttempts();

  assert.deepEqual(result, {
    status: "no_source_succeeded",
    outcomes: ["unknown_failure"],
  });
  assert.equal(attempts[0]?.errorMessage, "network down");
  store.close();
});

test("rejects a configured resource absent from the zero-cost allowlist", () => {
  const store = new ResourceStore(":memory:");
  const source = new FakeSource("provider", "paid-model", []);

  assert.throws(
    () => new ResourceLoop({ sources: [source], allowedResources: new Set(), store }),
    /not in the zero-cost allowlist/,
  );
  store.close();
});

test("retains attempts after the store is reopened", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-cluster-test-"));
  const path = join(directory, "history.sqlite");

  try {
    const firstStore = new ResourceStore(path);
    const source = new FakeSource("source", "free-model", [
      { outcome: "success", output: "persisted" },
    ]);
    const loop = new ResourceLoop({
      sources: [source],
      allowedResources: new Set([resourceKey(source)]),
      store: firstStore,
    });
    await loop.run({ prompt: "work", maxOutputTokens: 32 });
    firstStore.close();

    const reopenedStore = new ResourceStore(path);
    const attempts = await reopenedStore.listAttempts();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.output, "persisted");
    reopenedStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
