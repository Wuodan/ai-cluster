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
  readonly requirements?: ResourceRequirements;
}

export interface ResourceRequirements {
  readonly capabilities?: readonly Capability[];
  readonly minimumContextTokens?: number;
}

export const capabilities = [
  "text_generation",
  "instruction_following",
  "structured_json",
  "tool_use",
  "coding",
  "context_tokens",
] as const;

export type Capability = (typeof capabilities)[number];

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
  readonly resolvedModel?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly quota?: QuotaEvidence;
}

export interface InferenceSource {
  readonly id: string;
  readonly model: string;
  readonly accessPath: "api" | "process" | "local";
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

export interface NoSuitableSource {
  readonly status: "no_suitable_source";
  readonly requiredCapabilities: readonly Capability[];
  readonly minimumContextTokens?: number;
}

export type InferenceRunResult = SuccessfulInference | NoSourceSucceeded | NoSuitableSource;
