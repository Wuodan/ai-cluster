import assert from "node:assert/strict";
import { test } from "node:test";

import { GeminiSource } from "../src/sources/gemini.js";
import { GroqSource } from "../src/sources/groq.js";
import { LocalLlamaSource } from "../src/sources/local-llama.js";
import { OpenRouterSource } from "../src/sources/openrouter.js";

test("OpenRouter fixes the model and requires reported zero cost", async () => {
  let sentBody: unknown;
  const source = new OpenRouterSource("secret", async (_input, init) => {
    sentBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ message: { content: "should not pass" } }],
      usage: { cost: 0.01 },
    });
  });

  const result = await source.invoke({ prompt: "hello", maxOutputTokens: 10 });

  assert.equal((sentBody as { model: string }).model, "openrouter/free");
  assert.equal(result.outcome, "rejected");
  assert.equal(result.errorCode, "zero_cost_invariant");
});

test("Groq captures quota evidence", async () => {
  const source = new GroqSource("secret", async () => Response.json(
    { choices: [{ message: { content: "ok" } }] },
    {
      headers: {
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-remaining-requests": "999",
        "x-ratelimit-limit-tokens": "8000",
        "x-ratelimit-remaining-tokens": "7900",
      },
    },
  ));

  const result = await source.invoke({ prompt: "hello", maxOutputTokens: 10 });

  assert.equal(result.outcome, "success");
  assert.equal(result.output, "ok");
  assert.equal(result.quota?.requestsLimit, 1000);
  assert.equal(result.quota?.tokensRemaining, 7900);
});

test("rate limiting is classified as exhaustion", async () => {
  const source = new GroqSource("secret", async () => Response.json(
    { error: { code: "rate_limit_exceeded", message: "wait" } },
    { status: 429, headers: { "retry-after": "60" } },
  ));

  const result = await source.invoke({ prompt: "hello", maxOutputTokens: 10 });

  assert.equal(result.outcome, "exhausted");
  assert.equal(result.errorCode, "rate_limit_exceeded");
  assert.equal(result.quota?.raw?.["retry-after"], "60");
});

test("Gemini fixes the model and keeps its credential out of the URL", async () => {
  let sentUrl = "";
  let sentHeaders = new Headers();
  let sentBody: unknown;
  const source = new GeminiSource("secret", async (input, init) => {
    sentUrl = String(input);
    sentHeaders = new Headers(init?.headers);
    sentBody = JSON.parse(String(init?.body));
    return Response.json({
      modelVersion: "gemini-3.6-flash-001",
      candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
    });
  });

  const result = await source.invoke({ prompt: "hello", maxOutputTokens: 10 });

  assert.equal(sentUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  assert.equal(sentUrl.includes("secret"), false);
  assert.equal(sentHeaders.get("x-goog-api-key"), "secret");
  assert.deepEqual(sentBody, {
    contents: [{ role: "user", parts: [{ text: "hello" }] }],
    generationConfig: {
      maxOutputTokens: 10,
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  });
  assert.equal(result.outcome, "success");
  assert.equal(result.output, "ok");
  assert.equal(result.resolvedModel, "gemini-3.6-flash-001");
});

test("Gemini treats a token-truncated answer as malformed", async () => {
  const source = new GeminiSource("secret", async () => Response.json({
    modelVersion: "gemini-3.6-flash",
    candidates: [{ content: { parts: [{ text: "partial" }] }, finishReason: "MAX_TOKENS" }],
  }));

  const result = await source.invoke({ prompt: "hello", maxOutputTokens: 10 });

  assert.equal(result.outcome, "malformed_response");
  assert.match(result.errorMessage ?? "", /maxOutputTokens/);
});

test("Gemini rate limiting is classified as exhaustion", async () => {
  const source = new GeminiSource("secret", async () => Response.json(
    { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota reached" } },
    { status: 429, headers: { "retry-after": "60" } },
  ));

  const result = await source.invoke({ prompt: "hello", maxOutputTokens: 10 });

  assert.equal(result.outcome, "exhausted");
  assert.equal(result.errorCode, "RESOURCE_EXHAUSTED");
  assert.equal(result.errorMessage, "quota reached");
  assert.equal(result.quota?.raw?.["retry-after"], "60");
});

test("local llama uses its fixed model without a credential", async () => {
  let authorization: string | null = null;
  let body: { model?: string } = {};
  const source = new LocalLlamaSource("http://local.test/v1/chat/completions", async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    body = JSON.parse(String(init?.body)) as { model?: string };
    return Response.json({ model: "loaded-local-model", choices: [{ message: { content: "ok" } }] });
  });

  const result = await source.invoke({ prompt: "hello", maxOutputTokens: 10 });

  assert.equal(body.model, "qwen3-4b-q4_k_m");
  assert.equal(authorization, null);
  assert.equal(result.outcome, "success");
  assert.equal(result.resolvedModel, "loaded-local-model");
});

test("an empty provider answer is malformed rather than successful", async () => {
  const source = new GroqSource("secret", async () => Response.json({
    choices: [{ message: { content: "" } }],
  }));

  const result = await source.invoke({ prompt: "hello", maxOutputTokens: 10 });

  assert.equal(result.outcome, "malformed_response");
});
