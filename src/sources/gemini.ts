import type { InferenceRequest, InferenceSource, QuotaEvidence, SourceResult } from "../resource.js";
import type { Fetch } from "./openai-compatible.js";

export const geminiModel = "gemini-3.6-flash";

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly { readonly text?: unknown }[];
    };
    readonly finishReason?: unknown;
  }[];
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly status?: unknown;
  };
  readonly modelVersion?: unknown;
  readonly promptFeedback?: { readonly blockReason?: unknown };
}

export class GeminiSource implements InferenceSource {
  readonly id = "gemini";
  readonly model = geminiModel;
  readonly accessPath = "api" as const;
  readonly #apiKey: string;
  readonly #fetch: Fetch;

  constructor(apiKey: string, fetchImplementation: Fetch = globalThis.fetch) {
    this.#apiKey = apiKey;
    this.#fetch = fetchImplementation;
  }

  async invoke(request: InferenceRequest): Promise<SourceResult> {
    const response = await this.#fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.#apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            maxOutputTokens: request.maxOutputTokens,
            thinkingConfig: { thinkingLevel: "minimal" },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const quota = quotaEvidence(response.headers);
    const parsed = await parseBody(response);

    if (!response.ok) {
      return {
        outcome: classifyStatus(response.status),
        ...(parsed.errorCode === undefined ? {} : { errorCode: parsed.errorCode }),
        ...(parsed.errorMessage === undefined ? {} : { errorMessage: parsed.errorMessage }),
        ...(quota === undefined ? {} : { quota }),
      };
    }

    if (parsed.json === undefined) {
      return {
        outcome: "malformed_response",
        errorMessage: "Gemini returned a non-JSON success response",
        ...(quota === undefined ? {} : { quota }),
      };
    }

    const resolvedModel = typeof parsed.json.modelVersion === "string"
      ? parsed.json.modelVersion
      : this.model;
    const parts = parsed.json.candidates?.[0]?.content?.parts ?? [];
    const finishReason = parsed.json.candidates?.[0]?.finishReason;
    const output = parts
      .map((part) => part.text)
      .filter((text): text is string => typeof text === "string")
      .join("");
    if (finishReason === "MAX_TOKENS") {
      return {
        outcome: "malformed_response",
        errorMessage: "Gemini exhausted maxOutputTokens before completing its answer",
        resolvedModel,
        ...(quota === undefined ? {} : { quota }),
      };
    }
    if (output.trim().length === 0) {
      const blockReason = parsed.json.promptFeedback?.blockReason;
      const reason = typeof finishReason === "string"
        ? finishReason
        : typeof blockReason === "string" ? blockReason : undefined;
      return {
        outcome: "malformed_response",
        errorMessage: reason === undefined
          ? "Gemini response did not contain non-empty text output"
          : `Gemini response did not contain text output (${reason})`,
        resolvedModel,
        ...(quota === undefined ? {} : { quota }),
      };
    }

    return {
      outcome: "success",
      output,
      resolvedModel,
      ...(quota === undefined ? {} : { quota }),
    };
  }
}

function classifyStatus(status: number): SourceResult["outcome"] {
  if (status === 429) return "exhausted";
  if (status === 401 || status === 402 || status === 403) return "rejected";
  if (status === 404 || status >= 500) return "unavailable";
  return "unknown_failure";
}

async function parseBody(response: Response): Promise<{
  readonly json?: GeminiResponse;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}> {
  const text = await response.text();
  let json: GeminiResponse;
  try {
    json = JSON.parse(text) as GeminiResponse;
  } catch {
    return text.length === 0 ? {} : { errorMessage: text.slice(0, 1_000) };
  }

  const code = json.error?.status ?? json.error?.code;
  const message = json.error?.message;
  return {
    json,
    ...(typeof code === "string" || typeof code === "number" ? { errorCode: String(code) } : {}),
    ...(typeof message === "string" ? { errorMessage: message } : {}),
  };
}

function quotaEvidence(headers: Headers): QuotaEvidence | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter === null) return undefined;
  return { raw: { "retry-after": retryAfter } };
}
