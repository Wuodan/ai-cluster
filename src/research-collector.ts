export interface CollectedDocument {
  readonly url: string;
  readonly contentType: string;
  readonly content: string;
}

export class AllowlistedResearchCollector {
  readonly #allowedUrls: ReadonlySet<string>;
  readonly #fetch: typeof fetch;
  readonly #maximumBytes: number;
  readonly #timeoutMs: number;

  constructor(options: {
    readonly allowedUrls: readonly string[];
    readonly maximumBytes?: number;
    readonly timeoutMs?: number;
    readonly fetchImplementation?: typeof fetch;
  }) {
    if (options.allowedUrls.length === 0) throw new Error("At least one research URL must be allowlisted");
    this.#allowedUrls = new Set(options.allowedUrls.map((value) => normalizeAllowedUrl(value)));
    this.#maximumBytes = options.maximumBytes ?? 65_536;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.#maximumBytes) || this.#maximumBytes < 1_024 || this.#maximumBytes > 262_144) {
      throw new Error("Research document limit must be from 1024 through 262144 bytes");
    }
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 60_000) {
      throw new Error("Research timeout must be from 1000 through 60000 milliseconds");
    }
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async collect(urlValue: string): Promise<CollectedDocument> {
    const url = normalizeAllowedUrl(urlValue);
    if (!this.#allowedUrls.has(url)) throw new Error("Research URL is not on the exact allowlist");
    const response = await this.#fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: { accept: "text/markdown, text/html, text/plain, application/json" },
    });
    if (response.status >= 300 && response.status < 400) throw new Error("Research document redirects are not followed");
    if (!response.ok) throw new Error(`Research document returned HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!new Set(["text/markdown", "text/html", "text/plain", "application/json"]).has(contentType)) {
      throw new Error(`Research document has unsupported content type: ${contentType || "missing"}`);
    }
    const content = await readBoundedText(response, this.#maximumBytes);
    return { url, contentType, content };
  }
}

function normalizeAllowedUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Research URLs must use HTTPS");
  url.hash = "";
  if (url.username !== "" || url.password !== "") throw new Error("Research URLs must not contain credentials");
  return url.toString();
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let content = "";
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error(`Research document exceeds ${maximumBytes} bytes`);
    }
    content += decoder.decode(item.value, { stream: true });
  }
  return content + decoder.decode();
}
