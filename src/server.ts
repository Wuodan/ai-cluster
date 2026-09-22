import { OpenRouterCatalog } from "./catalog.js";
import { createConfiguredSources, parseSourceNames, readSecretFile } from "./configured-sources.js";
import { createResourceHttpServer } from "./http-api.js";
import {
  createAvailabilityProbeTask,
  createCapabilityEvaluationTask,
  createCatalogRefreshTask,
  MaintenanceScheduler,
  type MaintenanceTask,
} from "./maintenance.js";
import { zeroCostResourceKeys } from "./policy.js";
import { ResourceService } from "./service.js";
import { ResourceStore } from "./store.js";

const store = new ResourceStore(process.env.AI_CLUSTER_DATABASE_PATH ?? "/data/resource-loop.sqlite");
const sourceNames = parseSourceNames(process.env.AI_CLUSTER_SOURCES ?? "openrouter,groq,gemini,local");
const secretsDirectory = process.env.AI_CLUSTER_SECRETS_DIR ?? "/run/secrets";
const sources = createConfiguredSources({
  names: sourceNames,
  secretsDirectory,
  ...(process.env.AI_CLUSTER_LOCAL_ENDPOINT === undefined
    ? {}
    : { localEndpoint: process.env.AI_CLUSTER_LOCAL_ENDPOINT }),
});
const service = new ResourceService({ sources, allowedResources: zeroCostResourceKeys, store });
const server = createResourceHttpServer(service);
const maintenanceTasks: MaintenanceTask[] = [
  createAvailabilityProbeTask(
    sources,
    zeroCostResourceKeys,
    store,
    readInterval("AI_CLUSTER_PROBE_INTERVAL_MS", 15 * 60_000),
  ),
  createCapabilityEvaluationTask(
    sources,
    zeroCostResourceKeys,
    store,
    readInterval("AI_CLUSTER_EVALUATION_INTERVAL_MS", 24 * 60 * 60_000),
  ),
];
if (sourceNames.includes("openrouter")) {
  maintenanceTasks.push(createCatalogRefreshTask(
    new OpenRouterCatalog(readSecretFile(secretsDirectory, "openrouter_api_key")),
    store,
    readInterval("AI_CLUSTER_CATALOG_INTERVAL_MS", 6 * 60 * 60_000),
  ));
}
const maintenance = new MaintenanceScheduler(maintenanceTasks, store, Date.now, (run) => {
  process.stdout.write(`${JSON.stringify({ event: "maintenance", ...run })}\n`);
});
const host = process.env.AI_CLUSTER_HOST ?? "127.0.0.1";
const port = readPort(process.env.AI_CLUSTER_PORT ?? "8787");

server.listen(port, host, () => {
  process.stdout.write(`${JSON.stringify({ event: "listening", host, port })}\n`);
  process.stdout.write(`${JSON.stringify({
    event: "maintenance_configured",
    tasks: maintenanceTasks.map((task) => ({
      kind: task.kind,
      target: task.target,
      intervalMs: task.intervalMs,
    })),
  })}\n`);
  void maintenance.start(process.env.AI_CLUSTER_MAINTENANCE_RUN_ON_START !== "false");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void maintenance.stop().then(() => {
      store.close();
      process.exit(0);
    }));
  });
}

function readInterval(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000) throw new Error(`${name} must be at least 1000`);
  return parsed;
}

function readPort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("AI_CLUSTER_PORT must be an integer");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 65_535) throw new Error("AI_CLUSTER_PORT must be from 1 through 65535");
  return parsed;
}
