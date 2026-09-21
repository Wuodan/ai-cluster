import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { InferenceRequest, InferenceSource, SourceResult } from "../src/resource.js";
import { ResourceLoop, resourceKey } from "../src/resource-loop.js";
import { ResourceStore } from "../src/store.js";

class FakeSource implements InferenceSource {
  readonly accessPath = "api" as const;
  readonly #results: SourceResult[];
  calls = 0;

  constructor(
    readonly id: string,
    readonly model: string,
    results: readonly SourceResult[],
  ) {
    this.#results = [...results];
  }

  async invoke(_request: InferenceRequest): Promise<SourceResult> {
    this.calls += 1;
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

  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...result, requestId: undefined }, {
    status: "success",
    requestId: undefined,
    sourceId: "second",
    model: "free-b",
    accessPath: "api",
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
    accessPath: "api",
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

  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...result, requestId: undefined }, {
    status: "no_source_succeeded",
    requestId: undefined,
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

test("does not retry an exhausted resource before its persisted reset time", async () => {
  const store = new ResourceStore(":memory:");
  let nowMs = 1_000_000;
  const exhausted = new FakeSource("first", "free-a", [
    {
      outcome: "exhausted",
      errorCode: "rate_limit",
      quota: { raw: { "retry-after": "60" } },
    },
  ]);
  const fallback = new FakeSource("second", "free-b", [
    { outcome: "success", output: "first fallback" },
    { outcome: "success", output: "second fallback" },
  ]);
  const loop = new ResourceLoop({
    sources: [exhausted, fallback],
    allowedResources: new Set([resourceKey(exhausted), resourceKey(fallback)]),
    now: () => nowMs,
    store,
  });

  await loop.run({ prompt: "work", maxOutputTokens: 32 });
  nowMs += 59_999;
  const result = await loop.run({ prompt: "work again", maxOutputTokens: 32 });

  assert.equal(exhausted.calls, 1);
  assert.equal(fallback.calls, 2);
  assert.equal(result.status, "success");
  assert.equal((await store.getResourceState(resourceKey(exhausted)))?.state, "exhausted");
  store.close();
});

test("reconsiders and recovers a resource after cooldown", async () => {
  const store = new ResourceStore(":memory:");
  let nowMs = 1_000_000;
  const recovering = new FakeSource("first", "free-a", [
    {
      outcome: "exhausted",
      errorCode: "rate_limit",
      quota: { raw: { "retry-after": "60" } },
    },
    { outcome: "success", output: "recovered" },
  ]);
  const fallback = new FakeSource("second", "free-b", [
    { outcome: "success", output: "fallback" },
  ]);
  const loop = new ResourceLoop({
    sources: [recovering, fallback],
    allowedResources: new Set([resourceKey(recovering), resourceKey(fallback)]),
    now: () => nowMs,
    store,
  });

  await loop.run({ prompt: "work", maxOutputTokens: 32 });
  nowMs += 60_000;
  const result = await loop.run({ prompt: "work again", maxOutputTokens: 32 });
  const state = await store.getResourceState(resourceKey(recovering));
  const transitions = await store.listStateTransitions(resourceKey(recovering));

  assert.deepEqual({ ...result, requestId: undefined }, {
    status: "success",
    requestId: undefined,
    sourceId: "first",
    model: "free-a",
    accessPath: "api",
    output: "recovered",
  });
  assert.equal(state?.state, "available");
  assert.equal(state?.consecutiveFailures, 0);
  assert.deepEqual(transitions.map((transition) => transition.state), [
    "exhausted",
    "unknown",
    "available",
  ]);
  store.close();
});

test("retains cooldown across a process restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-cluster-cooldown-test-"));
  const path = join(directory, "history.sqlite");
  const nowMs = 1_000_000;

  try {
    const firstStore = new ResourceStore(path);
    const exhausted = new FakeSource("source", "free-model", [
      {
        outcome: "exhausted",
        quota: { raw: { "retry-after": "60" } },
      },
    ]);
    const firstLoop = new ResourceLoop({
      sources: [exhausted],
      allowedResources: new Set([resourceKey(exhausted)]),
      now: () => nowMs,
      store: firstStore,
    });
    await firstLoop.run({ prompt: "work", maxOutputTokens: 32 });
    firstStore.close();

    const reopenedStore = new ResourceStore(path);
    const shouldBeSkipped = new FakeSource("source", "free-model", []);
    const secondLoop = new ResourceLoop({
      sources: [shouldBeSkipped],
      allowedResources: new Set([resourceKey(shouldBeSkipped)]),
      now: () => nowMs + 30_000,
      store: reopenedStore,
    });
    const result = await secondLoop.run({ prompt: "work again", maxOutputTokens: 32 });

    assert.equal(shouldBeSkipped.calls, 0);
    assert.deepEqual(
      { ...result, requestId: undefined },
      { status: "no_source_succeeded", requestId: undefined, outcomes: [] },
    );
    assert.equal((await reopenedStore.getResourceState(resourceKey(shouldBeSkipped)))?.state, "exhausted");
    reopenedStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
