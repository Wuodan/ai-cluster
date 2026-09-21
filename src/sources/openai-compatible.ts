import type { QuotaEvidence, SourceResult } from "../resource.js";

export type Fetch = typeof globalThis.fetch;

interface ChatCompletionResponse {
  readonly model?: unknown;
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown };
  }[];
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
  };
  readonly usage?: {
    readonly cost?: unknown;
  };
}

export async function invokeOpenAiCompatible(options: {
  readonly apiKey?: string;
  readonly endpoint: string;
  readonly fetch: Fetch;
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly prompt: string;
  readonly requestUsage: boolean;
  readonly requireReportedZeroCost: boolean;
}): Promise<SourceResult> {
  const response = await options.fetch(options.endpoint, {
    method: "POST",
    headers: {
      ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: "user", content: options.prompt }],
      max_tokens: options.maxOutputTokens,
      ...(options.requestUsage ? { usage: { include: true } } : {}),
    }),
  });
  const quota = quotaEvidence(response.headers);
  const body = await parseBody(response);

  if (!response.ok) {
    return {
      outcome: classifyStatus(response.status),
      ...(body.errorCode === undefined ? {} : { errorCode: body.errorCode }),
      ...(body.errorMessage === undefined ? {} : { errorMessage: body.errorMessage }),
      ...(quota === undefined ? {} : { quota }),
    };
  }

  if (body.json === undefined) {
    return {
      outcome: "malformed_response",
      errorMessage: "Provider returned a non-JSON success response",
      ...(quota === undefined ? {} : { quota }),
    };
  }

  const resolvedModel = typeof body.json.model === "string" ? body.json.model : undefined;

  if (options.requireReportedZeroCost && body.json.usage?.cost !== 0) {
    return {
      outcome: "rejected",
      errorCode: "zero_cost_invariant",
      errorMessage: "Provider did not report an exact zero cost",
      ...(resolvedModel === undefined ? {} : { resolvedModel }),
      ...(quota === undefined ? {} : { quota }),
    };
  }

  const output = body.json.choices?.[0]?.message?.content;
  if (typeof output !== "string") {
    return {
      outcome: "malformed_response",
      errorMessage: "Provider response did not contain text output",
      ...(resolvedModel === undefined ? {} : { resolvedModel }),
      ...(quota === undefined ? {} : { quota }),
    };
  }

  return {
    outcome: "success",
    output,
    ...(resolvedModel === undefined ? {} : { resolvedModel }),
    ...(quota === undefined ? {} : { quota }),
  };
}

function classifyStatus(status: number): SourceResult["outcome"] {
  if (status === 429) return "exhausted";
  if (status === 401 || status === 402 || status === 403) return "rejected";
  if (status === 404 || status >= 500) return "unavailable";
  return "unknown_failure";
}

async function parseBody(response: Response): Promise<{
  readonly json?: ChatCompletionResponse;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}> {
  const text = await response.text();
  let json: ChatCompletionResponse;
  try {
    json = JSON.parse(text) as ChatCompletionResponse;
  } catch {
    return text.length === 0 ? {} : { errorMessage: text.slice(0, 1_000) };
  }

  const code = json.error?.code;
  const message = json.error?.message;
  return {
    json,
    ...(typeof code === "string" || typeof code === "number" ? { errorCode: String(code) } : {}),
    ...(typeof message === "string" ? { errorMessage: message } : {}),
  };
}

function quotaEvidence(headers: Headers): QuotaEvidence | undefined {
  const rawEntries = [
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "retry-after",
  ]
    .map((name) => [name, headers.get(name)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);

  if (rawEntries.length === 0) return undefined;

  const raw = Object.fromEntries(rawEntries);
  return {
    ...integerEvidence(raw["x-ratelimit-limit-requests"], "requestsLimit"),
    ...integerEvidence(raw["x-ratelimit-remaining-requests"], "requestsRemaining"),
    ...integerEvidence(raw["x-ratelimit-limit-tokens"], "tokensLimit"),
    ...integerEvidence(raw["x-ratelimit-remaining-tokens"], "tokensRemaining"),
    raw,
  };
}

function integerEvidence(
  value: string | undefined,
  name: "requestsLimit" | "requestsRemaining" | "tokensLimit" | "tokensRemaining",
): Partial<Record<typeof name, number>> {
  if (value === undefined || !/^\d+$/.test(value)) return {};
  return { [name]: Number(value) };
}
