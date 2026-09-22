export interface ResourceServiceInferenceSuccess {
  readonly status: "success";
  readonly requestId: string;
  readonly sourceId: string;
  readonly model: string;
  readonly resolvedModel?: string;
  readonly output: string;
}

export interface ResourceServiceInferenceRefusal {
  readonly status: "refused";
  readonly requestId?: string;
  readonly reason: string;
}

export type ResourceServiceInferenceResult =
  | ResourceServiceInferenceSuccess
  | ResourceServiceInferenceRefusal;

export class ResourceServiceClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    readonly baseUrl: string;
    readonly timeoutMs?: number;
    readonly fetchImplementation?: typeof fetch;
  }) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(this.#baseUrl.protocol)) {
      throw new Error("Resource service URL must use HTTP or HTTPS");
    }
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 60_000) {
      throw new Error("Resource service timeout must be from 1000 through 60000 milliseconds");
    }
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async inferStructured(prompt: string, maxOutputTokens = 1_024): Promise<ResourceServiceInferenceResult> {
    const endpoint = new URL("/v1/inference", this.#baseUrl);
    let response: Response;
    try {
      response = await this.#fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          maxOutputTokens,
          requirements: { capabilities: ["structured_json"] },
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error: unknown) {
      return { status: "refused", reason: error instanceof Error ? error.message : String(error) };
    }

    let body: string;
    try {
      body = await readBoundedResponse(response, 1_048_576);
    } catch (error: unknown) {
      return { status: "refused", reason: error instanceof Error ? error.message : String(error) };
    }
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return { status: "refused", reason: `resource_service_invalid_json_http_${response.status}` };
    }
    if (!isRecord(value)) return { status: "refused", reason: "resource_service_invalid_response" };
    const requestId = typeof value.requestId === "string" ? value.requestId : undefined;
    if (
      response.ok
      && value.status === "success"
      && typeof value.sourceId === "string"
      && typeof value.model === "string"
      && typeof value.output === "string"
      && requestId !== undefined
    ) {
      return {
        status: "success",
        requestId,
        sourceId: value.sourceId,
        model: value.model,
        ...(typeof value.resolvedModel === "string" ? { resolvedModel: value.resolvedModel } : {}),
        output: value.output,
      };
    }
    return {
      status: "refused",
      ...(requestId === undefined ? {} : { requestId }),
      reason: typeof value.status === "string" ? value.status : `resource_service_http_${response.status}`,
    };
  }
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error(`Resource service response exceeds ${maximumBytes} bytes`);
    }
    chunks.push(item.value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
