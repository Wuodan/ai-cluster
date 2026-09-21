import assert from "node:assert/strict";
import { test } from "node:test";

import { GroqSource } from "../src/sources/groq.js";
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
