import type { SourceResult } from "./resource.js";

export const resourceStates = [
  "unknown",
  "available",
  "degraded",
  "exhausted",
  "cooling_down",
  "disabled",
] as const;

export type ResourceState = (typeof resourceStates)[number];

export interface ResourceStateRecord {
  readonly resourceKey: string;
  readonly sourceId: string;
  readonly model: string;
  readonly state: ResourceState;
  readonly retryAtMs?: number;
  readonly consecutiveFailures: number;
  readonly observedAtMs: number;
  readonly reason: string;
}

export interface StateDecision {
  readonly state: ResourceState;
  readonly retryAtMs?: number;
  readonly consecutiveFailures: number;
  readonly reason: string;
}

export function decideResourceState(
  result: SourceResult,
  previousFailures: number,
  nowMs: number,
): StateDecision {
  if (result.outcome === "success") {
    return { state: "available", consecutiveFailures: 0, reason: "request_succeeded" };
  }

  const consecutiveFailures = previousFailures + 1;
  if (result.outcome === "rejected") {
    return {
      state: "disabled",
      consecutiveFailures,
      reason: result.errorCode ?? "request_rejected",
    };
  }

  const retryAtMs = inferRetryAt(result, consecutiveFailures, nowMs);
  if (result.outcome === "exhausted") {
    return {
      state: "exhausted",
      retryAtMs,
      consecutiveFailures,
      reason: result.errorCode ?? "resource_exhausted",
    };
  }
  if (result.outcome === "malformed_response") {
    return {
      state: "degraded",
      retryAtMs,
      consecutiveFailures,
      reason: "malformed_response",
    };
  }
  return {
    state: "cooling_down",
    retryAtMs,
    consecutiveFailures,
    reason: result.errorCode ?? result.outcome,
  };
}

function inferRetryAt(result: SourceResult, failures: number, nowMs: number): number {
  const explicitReset = result.quota?.resetsAt;
  if (explicitReset !== undefined) {
    const parsed = Date.parse(explicitReset);
    if (Number.isFinite(parsed) && parsed > nowMs) return parsed;
  }

  const raw = result.quota?.raw;
  const retryAfter = raw?.["retry-after"];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return nowMs + seconds * 1_000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date) && date > nowMs) return date;
  }

  const resetDuration = raw?.["x-ratelimit-reset-requests"];
  const durationMs = resetDuration === undefined ? undefined : parseDurationMs(resetDuration);
  if (durationMs !== undefined) return nowMs + durationMs;

  const exponentialMs = 60_000 * 2 ** Math.min(failures - 1, 8);
  return nowMs + Math.min(exponentialMs, 6 * 60 * 60 * 1_000);
}

function parseDurationMs(value: string): number | undefined {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(value);
  if (match === null || match[0].length === 0) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return (hours * 3_600 + minutes * 60 + seconds) * 1_000;
}
