import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateSource, type CapabilityEvidence } from "../src/capability.js";
import type { InferenceRequest, InferenceSource, SourceResult } from "../src/resource.js";
import { ResourceLoop, resourceKey } from "../src/resource-loop.js";
import { ResourceStore } from "../src/store.js";

class EvaluationSource implements InferenceSource {
  readonly accessPath = "api" as const;
  calls = 0;
  readonly #results: SourceResult[];

  constructor(
    readonly id: string,
    readonly model: string,
    results: readonly SourceResult[],
  ) {
    this.#results = [...results];
  }

  async invoke(_request: InferenceRequest): Promise<SourceResult> {
    this.calls += 1;
    return this.#results.shift() ?? { outcome: "unknown_failure" };
  }
}

test("deterministic evaluations preserve their inputs, outputs, and decisions", async () => {
  const store = new ResourceStore(":memory:");
  const source = new EvaluationSource("provider", "model", [
    { outcome: "success", output: "capability-text-ok" },
    { outcome: "success", output: "A7!" },
    { outcome: "success", output: '{"status":"ok","value":7}' },
  ]);

  const evidence = await evaluateSource(source, store, undefined, () => 100);
  const stored = await store.listCapabilityEvidence(resourceKey(source));

  assert.equal(evidence.length, 3);
  assert.equal(stored.length, 3);
  assert.deepEqual(stored.map((item) => item.verdict), ["supported", "supported", "supported"]);
  const structured = stored.find((item) => item.capability === "structured_json");
  assert.equal(structured?.output, '{"status":"ok","value":7}');
  assert.equal(structured?.evaluator, "deterministic");
  store.close();
});

test("advertised capability alone does not make a source suitable", async () => {
  const store = new ResourceStore(":memory:");
  const source = new EvaluationSource("provider", "model", [
    { outcome: "success", output: "unused" },
  ]);
  await store.recordCapabilityEvidence(evidenceFor(source, {
    evidenceKind: "advertised",
    verdict: "supported",
    observedAtMs: 100,
  }));
  const loop = new ResourceLoop({
    sources: [source],
    allowedResources: new Set([resourceKey(source)]),
    store,
  });

  const result = await loop.run({
    prompt: "work",
    maxOutputTokens: 32,
    requirements: { capabilities: ["structured_json"] },
  });

  assert.deepEqual({ ...result, requestId: undefined }, {
    status: "no_suitable_source",
    requestId: undefined,
    requiredCapabilities: ["structured_json"],
  });
  assert.equal(source.calls, 0);
  store.close();
});

test("requirements select a passing source and exclude a failing source", async () => {
  const store = new ResourceStore(":memory:");
  const failing = new EvaluationSource("first", "model-a", [
    { outcome: "success", output: "must not run" },
  ]);
  const passing = new EvaluationSource("second", "model-b", [
    { outcome: "success", output: "selected" },
  ]);
  await store.recordCapabilityEvidence(evidenceFor(failing, {
    evidenceKind: "observed",
    verdict: "unsupported",
    observedAtMs: 100,
  }));
  await store.recordCapabilityEvidence(evidenceFor(passing, {
    evidenceKind: "observed",
    verdict: "supported",
    observedAtMs: 100,
  }));
  const loop = new ResourceLoop({
    sources: [failing, passing],
    allowedResources: new Set([resourceKey(failing), resourceKey(passing)]),
    store,
  });

  const result = await loop.run({
    prompt: "work",
    maxOutputTokens: 32,
    requirements: { capabilities: ["structured_json"] },
  });

  assert.equal(result.status, "success");
  assert.equal(failing.calls, 0);
  assert.equal(passing.calls, 1);
  store.close();
});

test("new observed evidence supersedes old evidence without deleting history", async () => {
  const store = new ResourceStore(":memory:");
  const source = new EvaluationSource("provider", "model", []);
  await store.recordCapabilityEvidence(evidenceFor(source, {
    evidenceKind: "observed",
    verdict: "supported",
    observedAtMs: 100,
  }));
  await store.recordCapabilityEvidence(evidenceFor(source, {
    evidenceKind: "observed",
    verdict: "unsupported",
    observedAtMs: 200,
  }));

  assert.equal(
    await store.resourceMeetsRequirements(resourceKey(source), {
      capabilities: ["structured_json"],
    }),
    false,
  );
  assert.equal((await store.listCapabilityEvidence(resourceKey(source), "structured_json")).length, 2);
  store.close();
});

function evidenceFor(
  source: InferenceSource,
  overrides: Pick<CapabilityEvidence, "evidenceKind" | "verdict" | "observedAtMs">,
): CapabilityEvidence {
  return {
    sourceId: source.id,
    model: source.model,
    accessPath: source.accessPath,
    capability: "structured_json",
    evaluator: overrides.evidenceKind === "advertised" ? "provider_claim" : "deterministic",
    testId: "structured-json-v1",
    input: "controlled input",
    output: "controlled output",
    rationale: "test evidence",
    ...overrides,
  };
}
