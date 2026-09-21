import { readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateSource } from "./capability.js";
import { zeroCostResourceKeys } from "./policy.js";
import { capabilities, type Capability, type InferenceSource, type ResourceRequirements } from "./resource.js";
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
const command = process.env.AI_CLUSTER_COMMAND ?? "infer";
const sources = sourceNames.map(createSource);
const store = new ResourceStore(databasePath);

try {
  if (command === "evaluate") {
    for (const source of sources) {
      const evidence = await evaluateSource(source, store);
      process.stdout.write(`${JSON.stringify({
        resource: `${source.id}:${source.model}`,
        evidence: evidence.map((item) => ({
          capability: item.capability,
          verdict: item.verdict,
          resolvedModel: item.resolvedModel,
          rationale: item.rationale,
        })),
      })}\n`);
    }
  } else if (command === "infer") {
    const prompt = await readStandardInput();
    if (prompt.length === 0) throw new Error("Expected a prompt on standard input");
    const loop = new ResourceLoop({
      sources,
      allowedResources: zeroCostResourceKeys,
      store,
    });
    const requirements = readRequirements();
    const result = await loop.run({
      prompt,
      maxOutputTokens: 256,
      ...(requirements === undefined ? {} : { requirements }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "success") process.exitCode = 1;
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} finally {
  store.close();
}

function readRequirements(): ResourceRequirements | undefined {
  const requested = (process.env.AI_CLUSTER_REQUIRED_CAPABILITIES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const requiredCapabilities = requested.map((item): Capability => {
    if (!(capabilities as readonly string[]).includes(item)) {
      throw new Error(`Unknown required capability: ${item}`);
    }
    return item as Capability;
  });
  const contextValue = process.env.AI_CLUSTER_MIN_CONTEXT_TOKENS;
  const minimumContextTokens = contextValue === undefined ? undefined : Number(contextValue);
  if (minimumContextTokens !== undefined && (!Number.isSafeInteger(minimumContextTokens) || minimumContextTokens <= 0)) {
    throw new Error("AI_CLUSTER_MIN_CONTEXT_TOKENS must be a positive integer");
  }
  if (requiredCapabilities.length === 0 && minimumContextTokens === undefined) return undefined;
  return {
    ...(requiredCapabilities.length === 0 ? {} : { capabilities: requiredCapabilities }),
    ...(minimumContextTokens === undefined ? {} : { minimumContextTokens }),
  };
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
