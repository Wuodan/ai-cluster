import type { InferenceRequest, InferenceSource, SourceResult } from "../resource.js";
import { invokeOpenAiCompatible, type Fetch } from "./openai-compatible.js";

export const localLlamaModel = "qwen3-4b-q4_k_m";

export class LocalLlamaSource implements InferenceSource {
  readonly id = "local-llama";
  readonly model = localLlamaModel;
  readonly accessPath = "local" as const;
  readonly #endpoint: string;
  readonly #fetch: Fetch;

  constructor(endpoint: string, fetchImplementation: Fetch = globalThis.fetch) {
    this.#endpoint = endpoint;
    this.#fetch = fetchImplementation;
  }

  invoke(request: InferenceRequest): Promise<SourceResult> {
    return invokeOpenAiCompatible({
      endpoint: this.#endpoint,
      fetch: this.#fetch,
      maxOutputTokens: request.maxOutputTokens,
      model: this.model,
      prompt: request.prompt,
      requestUsage: false,
      requireReportedZeroCost: false,
    });
  }
}
