import assert from "node:assert/strict";
import { test } from "node:test";

import { ResourceServiceClient } from "../src/resource-service-client.js";

test("resource service client requests capability-selected structured output", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const client = new ResourceServiceClient({
    baseUrl: "http://resource-service:8787",
    fetchImplementation: (async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        status: "success",
        requestId: "request-1",
        sourceId: "groq",
        model: "free-route",
        resolvedModel: "actual-model",
        output: "{}",
      });
    }) as typeof fetch,
  });

  const result = await client.inferStructured("extract", 512);
  assert.equal(result.status, "success");
  assert.deepEqual(requestBody, {
    prompt: "extract",
    maxOutputTokens: 512,
    requirements: { capabilities: ["structured_json"] },
  });
});

test("resource service client preserves a bounded refusal", async () => {
  const client = new ResourceServiceClient({
    baseUrl: "http://resource-service:8787",
    fetchImplementation: (async () => Response.json({
      status: "no_resource_currently_available",
      requestId: "request-2",
    }, { status: 503 })) as typeof fetch,
  });

  assert.deepEqual(await client.inferStructured("extract"), {
    status: "refused",
    requestId: "request-2",
    reason: "no_resource_currently_available",
  });
});
