import type { Capability, InferenceSource, SourceResult } from "./resource.js";
import { resourceKey } from "./resource-loop.js";
import type { ResourceStore } from "./store.js";

export type EvidenceKind = "advertised" | "observed";
export type CapabilityVerdict = "supported" | "unsupported";
export type EvaluatorKind = "provider_claim" | "deterministic" | "llm";

export interface CapabilityEvidence {
  readonly sourceId: string;
  readonly model: string;
  readonly resolvedModel?: string;
  readonly accessPath: InferenceSource["accessPath"];
  readonly capability: Capability;
  readonly evidenceKind: EvidenceKind;
  readonly verdict: CapabilityVerdict;
  readonly numericValue?: number;
  readonly evaluator: EvaluatorKind;
  readonly testId: string;
  readonly input: string;
  readonly output?: string;
  readonly rationale: string;
  readonly uncertainty?: number;
  readonly observedAtMs: number;
}

interface EvaluationCase {
  readonly id: string;
  readonly capability: Capability;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  evaluate(result: SourceResult): {
    readonly verdict: CapabilityVerdict;
    readonly rationale: string;
  };
}

export const deterministicEvaluationCases: readonly EvaluationCase[] = [
  {
    id: "text-generation-v1",
    capability: "text_generation",
    prompt: "Reply with exactly: capability-text-ok",
    maxOutputTokens: 128,
    evaluate: exactText("capability-text-ok"),
  },
  {
    id: "instruction-following-v1",
    capability: "instruction_following",
    prompt: "Reply with exactly these three characters and nothing else: A7!",
    maxOutputTokens: 128,
    evaluate: exactText("A7!"),
  },
  {
    id: "structured-json-v1",
    capability: "structured_json",
    prompt: 'Return only this JSON object with no Markdown: {"status":"ok","value":7}',
    maxOutputTokens: 128,
    evaluate(result) {
      if (result.outcome !== "success" || result.output === undefined) {
        return { verdict: "unsupported", rationale: `inference_${result.outcome}` };
      }
      try {
        const value = JSON.parse(result.output) as unknown;
        const supported = typeof value === "object"
          && value !== null
          && !Array.isArray(value)
          && (value as Record<string, unknown>).status === "ok"
          && (value as Record<string, unknown>).value === 7
          && Object.keys(value).length === 2;
        return supported
          ? { verdict: "supported", rationale: "exact_json_shape" }
          : { verdict: "unsupported", rationale: "wrong_json_shape" };
      } catch {
        return { verdict: "unsupported", rationale: "invalid_json" };
      }
    },
  },
];

export async function evaluateSource(
  source: InferenceSource,
  store: ResourceStore,
  cases: readonly EvaluationCase[] = deterministicEvaluationCases,
  now: () => number = Date.now,
): Promise<readonly CapabilityEvidence[]> {
  const evidence: CapabilityEvidence[] = [];
  for (const evaluation of cases) {
    let result: SourceResult;
    try {
      result = await source.invoke({
        prompt: evaluation.prompt,
        maxOutputTokens: evaluation.maxOutputTokens,
      });
    } catch (error: unknown) {
      result = {
        outcome: "unknown_failure",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    const decision = evaluation.evaluate(result);
    const item: CapabilityEvidence = {
      sourceId: source.id,
      model: source.model,
      ...(result.resolvedModel === undefined ? {} : { resolvedModel: result.resolvedModel }),
      accessPath: source.accessPath,
      capability: evaluation.capability,
      evidenceKind: "observed",
      verdict: decision.verdict,
      evaluator: "deterministic",
      testId: evaluation.id,
      input: evaluation.prompt,
      ...(result.output === undefined ? {} : { output: result.output }),
      rationale: decision.rationale,
      observedAtMs: now(),
    };
    await store.recordCapabilityEvidence(item);
    evidence.push(item);
  }
  return evidence;
}

export function capabilityResourceKey(evidence: Pick<CapabilityEvidence, "sourceId" | "model">): string {
  return resourceKey({ id: evidence.sourceId, model: evidence.model });
}

function exactText(expected: string): EvaluationCase["evaluate"] {
  return (result) => {
    if (result.outcome !== "success" || result.output === undefined) {
      return { verdict: "unsupported", rationale: `inference_${result.outcome}` };
    }
    return result.output.trim() === expected
      ? { verdict: "supported", rationale: "exact_match" }
      : { verdict: "unsupported", rationale: "output_mismatch" };
  };
}
