import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess, type ProcessResult } from "../process-runner.js";
import type { InferenceRequest, InferenceSource, SourceResult } from "../resource.js";

type ProcessRunner = typeof runProcess;

export class CodexCliSource implements InferenceSource {
  readonly id = "codex-cli";
  readonly model = "account-default";
  readonly #runner: ProcessRunner;
  readonly #timeoutMs: number;

  constructor(options: { readonly runner?: ProcessRunner; readonly timeoutMs?: number } = {}) {
    this.#runner = options.runner ?? runProcess;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  async invoke(request: InferenceRequest): Promise<SourceResult> {
    const directory = mkdtempSync(join(tmpdir(), "ai-cluster-codex-"));
    try {
      const result = await this.#runner({
        command: "codex",
        args: [
          "exec",
          "--sandbox", "read-only",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--json",
          "-",
        ],
        cwd: directory,
        input: request.prompt,
        timeoutMs: this.#timeoutMs,
      });
      return classifyCodexResult(result);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function classifyCodexResult(result: ProcessResult): SourceResult {
  const output = extractAgentOutput(result.stdout);
  if (result.timedOut) {
    return {
      outcome: "unavailable",
      errorCode: "process_timeout",
      errorMessage: `Codex process exceeded its time limit${stderrSuffix(result.stderr)}`,
      ...(output === undefined ? {} : { output }),
    };
  }
  if (result.spawnError !== undefined) {
    return {
      outcome: "unavailable",
      errorCode: "process_spawn_error",
      errorMessage: result.spawnError,
      ...(output === undefined ? {} : { output }),
    };
  }
  if (result.exitCode !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();
    const outcome = /rate.?limit|quota|usage limit/.test(detail)
      ? "exhausted"
      : /auth|login|credential|unauthorized/.test(detail)
        ? "rejected"
        : "unknown_failure";
    return {
      outcome,
      errorCode: result.signal === undefined ? `process_exit_${result.exitCode ?? "unknown"}` : `signal_${result.signal}`,
      errorMessage: result.stderr.trim().slice(0, 1_000) || "Codex process failed",
      ...(output === undefined ? {} : { output }),
    };
  }
  if (output === undefined) {
    return {
      outcome: "malformed_response",
      errorMessage: "Codex process completed without an agent message",
    };
  }
  return { outcome: "success", output };
}

function extractAgentOutput(stdout: string): string | undefined {
  let output: string | undefined;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as {
        readonly type?: unknown;
        readonly item?: { readonly type?: unknown; readonly text?: unknown };
      };
      if (
        event.type === "item.completed"
        && event.item?.type === "agent_message"
        && typeof event.item.text === "string"
      ) {
        output = event.item.text;
      }
    } catch {
      // Non-JSON process output is retained by the runner but is not treated as an agent answer.
    }
  }
  return output;
}

function stderrSuffix(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length === 0 ? "" : `: ${trimmed.slice(0, 1_000)}`;
}
