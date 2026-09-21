import assert from "node:assert/strict";
import { test } from "node:test";

import { runProcess } from "../src/process-runner.js";

test("process runner captures stdout, stderr, and exit status", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 7"],
    cwd: process.cwd(),
    input: "",
    timeoutMs: 1_000,
  });

  assert.equal(result.stdout, "out");
  assert.equal(result.stderr, "err");
  assert.equal(result.exitCode, 7);
  assert.equal(result.timedOut, false);
});

test("process runner terminates work after a timeout", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => undefined, 1000)"],
    cwd: process.cwd(),
    input: "",
    timeoutMs: 25,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
});
