import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import type { CapabilityEvidence } from "../src/capability.js";
import { createResourceHttpServer } from "../src/http-api.js";
import type { InferenceRequest, InferenceSource, SourceResult } from "../src/resource.js";
import { resourceKey } from "../src/resource-loop.js";
import { ResourceService } from "../src/service.js";
import { ResourceStore } from "../src/store.js";

test("HTTP service selects by requirements and exposes evidence, history, status, and audit", async () => {
  const store = new ResourceStore(":memory:");
  const source = new FakeSource({ outcome: "success", output: "answer", resolvedModel: "actual-free-model" });
  const key = resourceKey(source);
  await store.recordCapabilityEvidence(textEvidence(source));
  const service = new ResourceService({ sources: [source], allowedResources: new Set([key]), store });
  const server = createResourceHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const inferenceResponse = await fetch(`${base}/v1/inference`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "work",
        maxOutputTokens: 32,
        requirements: { capabilities: ["text_generation"] },
      }),
    });
    const inference = await inferenceResponse.json() as Record<string, any>;
    assert.equal(inferenceResponse.status, 200);
    assert.equal(inference.status, "success");
    assert.equal(inference.sourceId, "provider");
    assert.equal(inference.model, "free-route");
    assert.equal(inference.resolvedModel, "actual-free-model");
    assert.equal(inference.accessPath, "api");
    assert.equal(inference.evidence.capabilities[0].verdict, "supported");

    const status = await (await fetch(`${base}/v1/status`)).json() as Record<string, any>;
    assert.equal(status.resources[0].state.state, "available");

    const history = await (await fetch(`${base}/v1/history?limit=10`)).json() as Record<string, any>;
    assert.equal(history.attempts.length, 1);
    assert.equal(history.attempts[0].resolvedModel, "actual-free-model");
    assert.deepEqual(history.transitions[key].map((item: { state: string }) => item.state), ["available"]);

    const audit = await (await fetch(`${base}/v1/audit`)).json() as Record<string, any>;
    assert.equal(audit.assessment, "no_paid_path_selected");
    assert.equal(audit.paidInferenceAllowed, false);
    assert.equal(audit.attemptsAudited, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    store.close();
  }
});

test("HTTP service explicitly refuses a request without capability evidence", async () => {
  const store = new ResourceStore(":memory:");
  const source = new FakeSource({ outcome: "success", output: "must not run" });
  const service = new ResourceService({
    sources: [source],
    allowedResources: new Set([resourceKey(source)]),
    store,
  });
  const server = createResourceHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/inference`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "write code", requirements: { capabilities: ["coding"] } }),
    });
    const result = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 503);
    assert.equal(result.status, "no_suitable_source");
    assert.deepEqual(result.requiredCapabilities, ["coding"]);
    assert.equal(source.calls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    store.close();
  }
});

class FakeSource implements InferenceSource {
  readonly id = "provider";
  readonly model = "free-route";
  readonly accessPath = "api" as const;
  calls = 0;
  readonly #result: SourceResult;

  constructor(result: SourceResult) {
    this.#result = result;
  }

  async invoke(_request: InferenceRequest): Promise<SourceResult> {
    this.calls += 1;
    return this.#result;
  }
}

function textEvidence(source: InferenceSource): CapabilityEvidence {
  return {
    sourceId: source.id,
    model: source.model,
    accessPath: source.accessPath,
    capability: "text_generation",
    evidenceKind: "observed",
    verdict: "supported",
    evaluator: "deterministic",
    testId: "text-generation-v1",
    input: "controlled",
    output: "controlled",
    rationale: "exact_match",
    observedAtMs: 100,
  };
}
