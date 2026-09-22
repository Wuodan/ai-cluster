import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { InferenceSource } from "./resource.js";
import { GeminiSource } from "./sources/gemini.js";
import { GroqSource } from "./sources/groq.js";
import { LocalLlamaSource } from "./sources/local-llama.js";
import { OpenRouterSource } from "./sources/openrouter.js";

export function parseSourceNames(value: string): readonly string[] {
  return value.split(",").map((name) => name.trim()).filter((name) => name.length > 0);
}

export function createConfiguredSources(options: {
  readonly names: readonly string[];
  readonly secretsDirectory: string;
  readonly localEndpoint?: string;
}): readonly InferenceSource[] {
  return options.names.map((name): InferenceSource => {
    if (name === "openrouter") return new OpenRouterSource(readSecretFile(options.secretsDirectory, "openrouter_api_key"));
    if (name === "groq") return new GroqSource(readSecretFile(options.secretsDirectory, "groq_api_key"));
    if (name === "gemini") return new GeminiSource(readSecretFile(options.secretsDirectory, "gemini_api_key"));
    if (name === "local") {
      return new LocalLlamaSource(options.localEndpoint ?? "http://127.0.0.1:8080/v1/chat/completions");
    }
    throw new Error(`Unknown source: ${name}`);
  });
}

export function readSecretFile(directory: string, name: string): string {
  const value = readFileSync(join(directory, name), "utf8").trim();
  if (value.length === 0) throw new Error(`Secret file is empty: ${name}`);
  return value;
}
