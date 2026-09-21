import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProcessResult } from "../src/process-runner.js";
import { CodexCliSource } from "../src/sources/codex-cli.js";

function runnerReturning(result: ProcessResult) {
  return async () => result;
}

test("Codex CLI extracts the final agent message", async () => {
  const source = new CodexCliSource({ runner: runnerReturning({
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: "thread.started", thread_id: "private" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }),
    ].join("\n"),
    stderr: "",
    timedOut: false,
  }) });

  assert.deepEqual(await source.invoke({ prompt: "work", maxOutputTokens: 32 }), {
    outcome: "success",
    output: "done",
  });
});

test("Codex CLI classifies quota failure and retains partial output", async () => {
  const source = new CodexCliSource({ runner: runnerReturning({
    exitCode: 1,
    stdout: JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "partial" },
    }),
    stderr: "Usage limit reached",
    timedOut: false,
  }) });

  const result = await source.invoke({ prompt: "work", maxOutputTokens: 32 });
  assert.equal(result.outcome, "exhausted");
  assert.equal(result.output, "partial");
  assert.equal(result.errorCode, "process_exit_1");
});

test("Codex CLI rejects successful but malformed output", async () => {
  const source = new CodexCliSource({ runner: runnerReturning({
    exitCode: 0,
    stdout: "not json",
    stderr: "",
    timedOut: false,
  }) });

  assert.equal(
    (await source.invoke({ prompt: "work", maxOutputTokens: 32 })).outcome,
    "malformed_response",
  );
});
