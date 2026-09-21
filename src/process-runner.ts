import { spawn } from "node:child_process";

export interface ProcessResult {
  readonly exitCode?: number;
  readonly signal?: NodeJS.Signals;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError?: string;
}

export async function runProcess(options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly input: string;
  readonly timeoutMs: number;
}): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const maximumCapturedBytes = 1_000_000;
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let spawnError: string | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => appendBounded(stdout, chunk, maximumCapturedBytes));
    child.stderr.on("data", (chunk: Buffer) => appendBounded(stderr, chunk, maximumCapturedBytes));
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      resolve({
        ...(exitCode === null ? {} : { exitCode }),
        ...(signal === null ? {} : { signal }),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        ...(spawnError === undefined ? {} : { spawnError }),
      });
    });

    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
  });
}

function appendBounded(chunks: Buffer[], chunk: Buffer, maximumBytes: number): void {
  const capturedBytes = chunks.reduce((total, item) => total + item.length, 0);
  const remainingBytes = maximumBytes - capturedBytes;
  if (remainingBytes <= 0) return;
  chunks.push(chunk.subarray(0, remainingBytes));
}
