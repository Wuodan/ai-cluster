export const attemptOutcomes = [
  "success",
  "unavailable",
  "exhausted",
  "rejected",
  "malformed_response",
  "unknown_failure",
] as const;

export type AttemptOutcome = (typeof attemptOutcomes)[number];

export interface InferenceRequest {
  readonly prompt: string;
  readonly maxOutputTokens: number;
}

export interface QuotaEvidence {
  readonly requestsLimit?: number;
  readonly requestsRemaining?: number;
  readonly tokensLimit?: number;
  readonly tokensRemaining?: number;
  readonly resetsAt?: string;
  readonly raw?: Readonly<Record<string, string>>;
}

export interface SourceResult {
  readonly outcome: AttemptOutcome;
  readonly output?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly quota?: QuotaEvidence;
}

export interface InferenceSource {
  readonly id: string;
  readonly model: string;
  invoke(request: InferenceRequest): Promise<SourceResult>;
}

export interface SuccessfulInference {
  readonly status: "success";
  readonly sourceId: string;
  readonly model: string;
  readonly output: string;
}

export interface NoSourceSucceeded {
  readonly status: "no_source_succeeded";
  readonly outcomes: readonly AttemptOutcome[];
}

export type InferenceRunResult = SuccessfulInference | NoSourceSucceeded;
