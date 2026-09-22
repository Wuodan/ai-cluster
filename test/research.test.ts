import assert from "node:assert/strict";
import { test } from "node:test";

import type { CollectedDocument } from "../src/research-collector.js";
import {
  decideQualification,
  parseResearchProposal,
  runResearchTask,
  type QualificationAdapter,
  type ResearchCandidate,
  type ResearchInferenceClient,
} from "../src/research.js";
import { ResearchStore } from "../src/research-store.js";

const candidate: ResearchCandidate = {
  provider: "Example AI",
  accessPath: "https://api.example.test/v1",
  claims: [{ kind: "zero_cost", statement: "A free tier is advertised.", evidence: "Pricing table: Free" }],
  manualBlockers: [],
  qualificationSteps: ["Check exact model pricing", "Verify paid fallback is blocked"],
};

const candidateProposal = {
  status: "candidate_found",
  summary: "One unverified path was found.",
  candidates: [candidate],
} as const;

test("strictly parses bounded research proposals", () => {
  assert.deepEqual(parseResearchProposal(JSON.stringify(candidateProposal), "Example AI"), candidateProposal);
  assert.equal(parseResearchProposal(JSON.stringify({ ...candidateProposal, trusted: true }), "Example AI"), undefined);
  assert.equal(parseResearchProposal(JSON.stringify(candidateProposal), "Different AI"), undefined);
  assert.equal(parseResearchProposal(JSON.stringify({
    ...candidateProposal,
    candidates: [{ ...candidate, manualBlockers: ["credentials"] }],
  }), "Example AI"), undefined);
});

test("persists research claims as untrusted and refuses generic qualification", async () => {
  const store = new ResearchStore(":memory:");
  try {
    const result = await runResearchTask({
      task: { provider: "Example AI", url: "https://docs.example.test/free" },
      collector: new StubCollector(),
      inferenceClient: new StubInferenceClient(JSON.stringify(candidateProposal)),
      store,
      now: increasingClock(),
    });

    assert.equal(result.outcome, "persisted");
    assert.equal((await store.listRuns())[0]?.serviceRequestId, "request-1");
    assert.equal((await store.listCandidates())[0]?.trust, "untrusted");
    assert.deepEqual((await store.listQualifications()).map(({ status, reason }) => ({ status, reason })), [{
      status: "incomplete",
      reason: "no_trusted_qualification_adapter",
    }]);
  } finally {
    store.close();
  }
});

test("stops at a human blocker without invoking a qualification adapter", async () => {
  const store = new ResearchStore(":memory:");
  let calls = 0;
  const adapter: QualificationAdapter = {
    id: "must-not-run",
    supports: () => true,
    qualify: async () => {
      calls += 1;
      return [];
    },
  };
  const blocked = {
    status: "manual_action_required",
    summary: "An account and payment setup are required.",
    candidates: [{ ...candidate, manualBlockers: ["account_creation", "payment_configuration"] }],
  } as const;
  try {
    await runResearchTask({
      task: { provider: "Example AI", url: "https://docs.example.test/free" },
      collector: new StubCollector(),
      inferenceClient: new StubInferenceClient(JSON.stringify(blocked)),
      qualificationAdapters: [adapter],
      store,
    });
    assert.equal(calls, 0);
    assert.equal((await store.listQualifications())[0]?.status, "manual_action_required");
  } finally {
    store.close();
  }
});

test("only code-trusted deterministic evidence can qualify a candidate", async () => {
  const store = new ResearchStore(":memory:");
  const adapter: QualificationAdapter = {
    id: "example-v1",
    supports: (item) => item.provider === "Example AI" && item.accessPath === "https://api.example.test/v1",
    qualify: async () => [
      { check: "zero_cost", verdict: "pass", evidence: "Exact model price was deterministically zero." },
      { check: "paid_fallback_blocked", verdict: "pass", evidence: "The test account has no billing path." },
      { check: "access_works", verdict: "pass", evidence: "A bounded probe succeeded." },
    ],
  };
  try {
    await runResearchTask({
      task: { provider: "Example AI", url: "https://docs.example.test/free" },
      collector: new StubCollector(),
      inferenceClient: new StubInferenceClient(JSON.stringify(candidateProposal)),
      qualificationAdapters: [adapter],
      store,
    });
    assert.deepEqual((await store.listQualifications()).map(({ adapterId, status }) => ({ adapterId, status })), [{
      adapterId: "example-v1",
      status: "qualified",
    }]);
  } finally {
    store.close();
  }
});

test("persists a trusted qualification adapter failure as incomplete", async () => {
  const store = new ResearchStore(":memory:");
  const adapter: QualificationAdapter = {
    id: "failing-adapter",
    supports: () => true,
    qualify: async () => { throw new Error("bounded probe failed"); },
  };
  try {
    await runResearchTask({
      task: { provider: "Example AI", url: "https://docs.example.test/free" },
      collector: new StubCollector(),
      inferenceClient: new StubInferenceClient(JSON.stringify(candidateProposal)),
      qualificationAdapters: [adapter],
      store,
    });
    assert.deepEqual((await store.listQualifications()).map(({ status, reason }) => ({ status, reason })), [{
      status: "incomplete",
      reason: "qualification_adapter_failed:bounded probe failed",
    }]);
  } finally {
    store.close();
  }
});

test("qualification fails closed on failed, unknown, duplicate, or missing checks", () => {
  assert.equal(decideQualification([
    { check: "zero_cost", verdict: "fail", evidence: "Price was non-zero." },
  ]).status, "rejected");
  assert.equal(decideQualification([
    { check: "zero_cost", verdict: "pass", evidence: "zero" },
    { check: "paid_fallback_blocked", verdict: "unknown", evidence: "not visible" },
    { check: "access_works", verdict: "pass", evidence: "probe" },
  ]).status, "incomplete");
  assert.equal(decideQualification([
    { check: "zero_cost", verdict: "pass", evidence: "zero" },
    { check: "zero_cost", verdict: "pass", evidence: "zero again" },
  ]).reason, "invalid_or_duplicate_qualification_evidence");
});

class StubCollector {
  async collect(url: string): Promise<CollectedDocument> {
    return { url, contentType: "text/plain", content: "Example AI advertises a free tier." };
  }
}

class StubInferenceClient implements ResearchInferenceClient {
  readonly #output: string;

  constructor(output: string) {
    this.#output = output;
  }

  async inferStructured(): Promise<ReturnType<ResearchInferenceClient["inferStructured"]> extends Promise<infer T> ? T : never> {
    return {
      status: "success",
      requestId: "request-1",
      sourceId: "groq",
      model: "free-model",
      resolvedModel: "actual-model",
      output: this.#output,
    };
  }
}

function increasingClock(): () => number {
  let value = 100;
  return () => value++;
}
