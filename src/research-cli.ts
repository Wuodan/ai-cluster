import { AllowlistedResearchCollector } from "./research-collector.js";
import { runResearchTask, type ResearchTask } from "./research.js";
import { ResearchStore } from "./research-store.js";
import { ResourceServiceClient } from "./resource-service-client.js";

const allowedUrls = (process.env.AI_CLUSTER_RESEARCH_URLS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const store = new ResearchStore(process.env.AI_CLUSTER_RESEARCH_DATABASE_PATH ?? "/data/resource-research.sqlite");

try {
  const task = parseTask(JSON.parse(await readBoundedStandardInput(16_384)) as unknown);
  const collector = new AllowlistedResearchCollector({ allowedUrls });
  const inferenceClient = new ResourceServiceClient({
    baseUrl: process.env.AI_CLUSTER_RESOURCE_SERVICE_URL ?? "http://127.0.0.1:8787",
  });
  const result = await runResearchTask({ task, collector, inferenceClient, store });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.outcome !== "persisted") process.exitCode = 1;
} finally {
  store.close();
}

function parseTask(value: unknown): ResearchTask {
  if (!isRecord(value) || !hasExactKeys(value, ["provider", "url"])) {
    throw new Error("Research task must contain exactly provider and url");
  }
  if (typeof value.provider !== "string" || value.provider.trim() === "" || value.provider.length > 200) {
    throw new Error("Research provider must be a non-empty string of at most 200 characters");
  }
  if (typeof value.url !== "string") throw new Error("Research url must be a string");
  return { provider: value.provider, url: value.url };
}

async function readBoundedStandardInput(maximumBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBytes) throw new Error(`Research task exceeds ${maximumBytes} bytes`);
    chunks.push(buffer);
  }
  const value = Buffer.concat(chunks).toString("utf8").trim();
  if (value === "") throw new Error("Expected a research task on standard input");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}
