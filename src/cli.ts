import { readFileSync } from "node:fs";
import { join } from "node:path";

import { zeroCostResourceKeys } from "./policy.js";
import type { InferenceSource } from "./resource.js";
import { ResourceLoop } from "./resource-loop.js";
import { CodexCliSource } from "./sources/codex-cli.js";
import { GroqSource } from "./sources/groq.js";
import { OpenRouterSource } from "./sources/openrouter.js";
import { ResourceStore } from "./store.js";

const secretsDirectory = process.env.AI_CLUSTER_SECRETS_DIR ?? "/run/secrets";
const databasePath = process.env.AI_CLUSTER_DATABASE_PATH ?? "/data/resource-loop.sqlite";
const sourceNames = (process.env.AI_CLUSTER_SOURCES ?? "openrouter,groq")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

const prompt = await readStandardInput();
if (prompt.length === 0) {
  throw new Error("Expected a prompt on standard input");
}

const sources = sourceNames.map(createSource);
const store = new ResourceStore(databasePath);

try {
  const loop = new ResourceLoop({
    sources,
    allowedResources: zeroCostResourceKeys,
    store,
  });
  const result = await loop.run({ prompt, maxOutputTokens: 256 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "success") process.exitCode = 1;
} finally {
  store.close();
}

function createSource(name: string): InferenceSource {
  if (name === "openrouter") {
    return new OpenRouterSource(readSecret("openrouter_api_key"));
  }
  if (name === "groq") {
    return new GroqSource(readSecret("groq_api_key"));
  }
  if (name === "codex") {
    return new CodexCliSource();
  }
  throw new Error(`Unknown source: ${name}`);
}

function readSecret(name: string): string {
  const value = readFileSync(join(secretsDirectory, name), "utf8").trim();
  if (value.length === 0) throw new Error(`Secret file is empty: ${name}`);
  return value;
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}
