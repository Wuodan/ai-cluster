import type { InferenceRequest, InferenceSource, SourceResult } from "../resource.js";
import { invokeOpenAiCompatible, type Fetch } from "./openai-compatible.js";

export class GroqSource implements InferenceSource {
  readonly id = "groq";
  readonly model = "openai/gpt-oss-120b";
  readonly accessPath = "api" as const;
  readonly #apiKey: string;
  readonly #fetch: Fetch;

  constructor(apiKey: string, fetchImplementation: Fetch = globalThis.fetch) {
    this.#apiKey = apiKey;
    this.#fetch = fetchImplementation;
  }

  invoke(request: InferenceRequest): Promise<SourceResult> {
    return invokeOpenAiCompatible({
      apiKey: this.#apiKey,
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      fetch: this.#fetch,
      maxOutputTokens: request.maxOutputTokens,
      model: this.model,
      prompt: request.prompt,
      requestUsage: false,
      requireReportedZeroCost: false,
    });
  }
}
