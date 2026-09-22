import assert from "node:assert/strict";
import { test } from "node:test";

import { AllowlistedResearchCollector } from "../src/research-collector.js";

test("collector fetches only an exact HTTPS allowlist entry", async () => {
  const calls: string[] = [];
  const collector = new AllowlistedResearchCollector({
    allowedUrls: ["https://docs.example.test/free"],
    fetchImplementation: (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("free tier claim", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }) as typeof fetch,
  });

  assert.equal((await collector.collect("https://docs.example.test/free")).content, "free tier claim");
  await assert.rejects(collector.collect("https://docs.example.test/other"), /exact allowlist/);
  await assert.rejects(collector.collect("http://docs.example.test/free"), /HTTPS/);
  assert.deepEqual(calls, ["https://docs.example.test/free"]);
});

test("collector rejects redirects, unsupported content, and oversized bodies", async () => {
  const redirecting = new AllowlistedResearchCollector({
    allowedUrls: ["https://docs.example.test/free"],
    fetchImplementation: (async () => new Response(null, {
      status: 302,
      headers: { location: "https://evil.example.test" },
    })) as typeof fetch,
  });
  await assert.rejects(redirecting.collect("https://docs.example.test/free"), /redirects/);

  const binary = new AllowlistedResearchCollector({
    allowedUrls: ["https://docs.example.test/free"],
    fetchImplementation: (async () => new Response("x", {
      headers: { "content-type": "application/octet-stream" },
    })) as typeof fetch,
  });
  await assert.rejects(binary.collect("https://docs.example.test/free"), /unsupported content type/);

  const oversized = new AllowlistedResearchCollector({
    allowedUrls: ["https://docs.example.test/free"],
    maximumBytes: 1_024,
    fetchImplementation: (async () => new Response("x".repeat(1_025), {
      headers: { "content-type": "text/plain" },
    })) as typeof fetch,
  });
  await assert.rejects(oversized.collect("https://docs.example.test/free"), /exceeds 1024 bytes/);
});

test("collector accepts compact provider Markdown documentation", async () => {
  const collector = new AllowlistedResearchCollector({
    allowedUrls: ["https://docs.example.test/pricing/index.md"],
    fetchImplementation: (async () => new Response("# Pricing\n\nFree allocation: unverified claim.", {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    })) as typeof fetch,
  });

  const document = await collector.collect("https://docs.example.test/pricing/index.md");
  assert.equal(document.contentType, "text/markdown");
});
