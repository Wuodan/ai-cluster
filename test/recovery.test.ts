import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRecoveryProposal, runRecovery } from "../src/recovery.js";
import type { InferenceRequest, InferenceSource, SourceResult } from "../src/resource.js";
import { ResourceStore } from "../src/store.js";

const validProposal = {
  status: "manual_action_required",
  summary: "A candidate exists but needs an account.",
  candidates: [{
    provider: "Example AI",
    accessPath: "https://example.test/v1",
    evidence: "The supplied page says a free tier exists.",
    qualificationSteps: ["Create a project account", "Verify that paid fallback is disabled"],
  }],
  nextActions: ["Ask the owner to create the account"],
} as const;

test("strictly parses a recovery proposal", () => {
  assert.deepEqual(parseRecoveryProposal(JSON.stringify(validProposal)), validProposal);
  assert.equal(parseRecoveryProposal(`Here is the result: ${JSON.stringify(validProposal)}`), undefined);
  assert.equal(parseRecoveryProposal(JSON.stringify({ ...validProposal, trusted: true })), undefined);
  assert.equal(parseRecoveryProposal(JSON.stringify({ ...validProposal, status: "candidate_found", candidates: [] })), undefined);
});

test("persists a valid recovery finding", async () => {
  const store = new ResourceStore(":memory:");
  const source = new StubSource({ outcome: "success", output: JSON.stringify(validProposal) });
  try {
    const result = await runRecovery({
      observations: "All configured external sources are disabled. Example AI advertises a free tier requiring signup.",
      source,
      store,
      now: () => 1234,
    });

    assert.equal(result.outcome, "persisted");
    assert.deepEqual(result.proposal, validProposal);
    const findings = await store.listRecoveryFindings();
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.parseStatus, "valid");
    assert.deepEqual(findings[0]?.proposal, validProposal);
    assert.equal(findings[0]?.observedAtMs, 1234);
  } finally {
    store.close();
  }
});

test("persists failed and malformed recovery attempts", async () => {
  const store = new ResourceStore(":memory:");
  try {
    const failed = await runRecovery({
      observations: "none",
      source: new StubSource({ outcome: "unavailable", errorMessage: "offline" }),
      store,
    });
    const malformed = await runRecovery({
      observations: "none",
      source: new StubSource({ outcome: "success", output: "not json" }),
      store,
    });

    assert.equal(failed.outcome, "local_inference_failed");
    assert.equal(malformed.outcome, "invalid_proposal");
    assert.deepEqual((await store.listRecoveryFindings()).map((item) => item.parseStatus).sort(), [
      "inference_failed",
      "invalid",
    ].sort());
  } finally {
    store.close();
  }
});

test("bounds observations and persists a thrown local inference error", async () => {
  const store = new ResourceStore(":memory:");
  try {
    await assert.rejects(
      runRecovery({ observations: "x".repeat(4_097), source: new ThrowingSource(), store }),
      /4096-byte limit/,
    );
    const result = await runRecovery({ observations: "bounded", source: new ThrowingSource(), store });
    assert.equal(result.outcome, "local_inference_failed");
    assert.equal((await store.listRecoveryFindings())[0]?.rawOutput, "local server unreachable");
  } finally {
    store.close();
  }
});

class StubSource implements InferenceSource {
  readonly id = "local-llama";
  readonly model = "qwen3-4b-q4_k_m";
  readonly accessPath = "local" as const;
  readonly #result: SourceResult;

  constructor(result: SourceResult) {
    this.#result = result;
  }

  async invoke(_request: InferenceRequest): Promise<SourceResult> {
    return this.#result;
  }
}

class ThrowingSource implements InferenceSource {
  readonly id = "local-llama";
  readonly model = "qwen3-4b-q4_k_m";
  readonly accessPath = "local" as const;

  async invoke(_request: InferenceRequest): Promise<SourceResult> {
    throw new Error("local server unreachable");
  }
}
