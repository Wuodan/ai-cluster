import type { Fetch } from "./sources/openai-compatible.js";
import type { ResourceStore } from "./store.js";

export const catalogStatuses = ["quarantined", "qualified", "unavailable", "rejected"] as const;
export type CatalogStatus = (typeof catalogStatuses)[number];

export interface CatalogEntry {
  readonly modelId: string;
  readonly zeroCost: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class OpenRouterCatalog {
  readonly #apiKey: string;
  readonly #fetch: Fetch;

  constructor(apiKey: string, fetchImplementation: Fetch = globalThis.fetch) {
    this.#apiKey = apiKey;
    this.#fetch = fetchImplementation;
  }

  async refresh(store: ResourceStore, observedAtMs = Date.now()): Promise<number> {
    const response = await this.#fetch("https://openrouter.ai/api/v1/models", {
      headers: { authorization: `Bearer ${this.#apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`OpenRouter catalog request failed with HTTP ${response.status}`);

    const body = await response.json() as { readonly data?: readonly unknown[] };
    if (!Array.isArray(body.data)) throw new Error("OpenRouter catalog response has no model array");

    const entries = body.data.flatMap(parseOpenRouterEntry);
    await store.applyCatalogSnapshot("openrouter", entries, observedAtMs);
    return entries.length;
  }
}

function parseOpenRouterEntry(value: unknown): readonly CatalogEntry[] {
  if (typeof value !== "object" || value === null) return [];
  const candidate = value as {
    readonly id?: unknown;
    readonly context_length?: unknown;
    readonly pricing?: { readonly prompt?: unknown; readonly completion?: unknown };
  };
  if (typeof candidate.id !== "string" || !candidate.id.endsWith(":free")) return [];

  const promptPrice = candidate.pricing?.prompt;
  const completionPrice = candidate.pricing?.completion;
  const zeroCost = numericZero(promptPrice) && numericZero(completionPrice);
  return [{
    modelId: candidate.id,
    zeroCost,
    metadata: {
      promptPrice,
      completionPrice,
      contextLength: candidate.context_length,
    },
  }];
}

function numericZero(value: unknown): boolean {
  return (typeof value === "string" || typeof value === "number") && Number(value) === 0;
}
