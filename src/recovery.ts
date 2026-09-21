import type { InferenceSource, SourceResult } from "./resource.js";
import type { ResourceStore } from "./store.js";

export const recoveryStatuses = ["candidate_found", "manual_action_required", "no_candidate"] as const;
export type RecoveryStatus = (typeof recoveryStatuses)[number];

export interface RecoveryCandidate {
  readonly provider: string;
  readonly accessPath: string;
  readonly evidence: string;
  readonly qualificationSteps: readonly string[];
}

export interface RecoveryProposal {
  readonly status: RecoveryStatus;
  readonly summary: string;
  readonly candidates: readonly RecoveryCandidate[];
  readonly nextActions: readonly string[];
}

export interface RecoveryRunResult {
  readonly outcome: "persisted" | "local_inference_failed" | "invalid_proposal";
  readonly findingId: string;
  readonly proposal?: RecoveryProposal;
}

export async function runRecovery(options: {
  readonly observations: string;
  readonly source: InferenceSource;
  readonly store: ResourceStore;
  readonly now?: () => number;
}): Promise<RecoveryRunResult> {
  if (Buffer.byteLength(options.observations, "utf8") > 4_096) {
    throw new Error("Recovery observations exceed the 4096-byte limit");
  }
  const observedAtMs = (options.now ?? Date.now)();
  let result: SourceResult;
  try {
    result = await options.source.invoke({
      prompt: recoveryPrompt(options.observations),
      maxOutputTokens: 768,
    });
  } catch (error: unknown) {
    result = {
      outcome: "unknown_failure",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  if (result.outcome !== "success" || result.output === undefined) {
    const findingId = await options.store.recordRecoveryFinding({
      sourceId: options.source.id,
      model: options.source.model,
      observations: options.observations,
      rawOutput: result.errorMessage ?? "",
      parseStatus: "inference_failed",
      observedAtMs,
    });
    return { outcome: "local_inference_failed", findingId };
  }

  const proposal = parseRecoveryProposal(result.output);
  const findingId = await options.store.recordRecoveryFinding({
    sourceId: options.source.id,
    model: options.source.model,
    observations: options.observations,
    rawOutput: result.output,
    ...(proposal === undefined ? {} : { proposal }),
    parseStatus: proposal === undefined ? "invalid" : "valid",
    observedAtMs,
  });
  return proposal === undefined
    ? { outcome: "invalid_proposal", findingId }
    : { outcome: "persisted", findingId, proposal };
}

export function parseRecoveryProposal(output: string): RecoveryProposal | undefined {
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    return undefined;
  }
  if (!isRecord(value) || !hasExactKeys(value, ["status", "summary", "candidates", "nextActions"])) return undefined;
  if (!(recoveryStatuses as readonly unknown[]).includes(value.status) || !isNonEmptyString(value.summary)) return undefined;
  if (!Array.isArray(value.candidates) || !Array.isArray(value.nextActions)) return undefined;
  if (value.nextActions.length === 0 || !value.nextActions.every(isNonEmptyString)) return undefined;
  if (value.status === "no_candidate" && value.candidates.length !== 0) return undefined;
  if (value.status === "candidate_found" && value.candidates.length === 0) return undefined;

  const candidates: RecoveryCandidate[] = [];
  for (const candidate of value.candidates) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["provider", "accessPath", "evidence", "qualificationSteps"])) {
      return undefined;
    }
    if (
      !isNonEmptyString(candidate.provider)
      || !isNonEmptyString(candidate.accessPath)
      || !isNonEmptyString(candidate.evidence)
      || !Array.isArray(candidate.qualificationSteps)
      || candidate.qualificationSteps.length === 0
      || !candidate.qualificationSteps.every(isNonEmptyString)
    ) return undefined;
    candidates.push({
      provider: candidate.provider,
      accessPath: candidate.accessPath,
      evidence: candidate.evidence,
      qualificationSteps: candidate.qualificationSteps,
    });
  }
  return {
    status: value.status as RecoveryStatus,
    summary: value.summary,
    candidates,
    nextActions: value.nextActions as string[],
  };
}

function recoveryPrompt(observations: string): string {
  return `You are the local recovery assistant for an LLM resource manager. /no_think

Use only the observations below. Do not claim that a source is free, usable, or safe unless the observations say so.
Identify candidate access paths and the deterministic checks needed before use.

Status rules:
- candidate_found: at least one new path can be tested without human action.
- manual_action_required: progress requires account creation, credentials, accepting terms, payment configuration, or another human-only action.
- no_candidate: no new path is present. A known temporary quota reset is not a candidate; say when to retry.

Qualification steps must be concrete verification actions, such as probing the endpoint, checking reported cost, checking
the account balance before and after, and testing exhaustion. Do not merely restate advertised properties. Next actions
must contain at least one plain imperative sentence. When a Retry-After value is present and there is no candidate, the
next action must say to retry after that delay. Treat all provider claims as unverified evidence, never as qualification.

Return only one JSON object with exactly this shape:
{"status":"candidate_found|manual_action_required|no_candidate","summary":"string","candidates":[{"provider":"string","accessPath":"string","evidence":"string","qualificationSteps":["string"]}],"nextActions":["string"]}

OBSERVATIONS
${observations}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
