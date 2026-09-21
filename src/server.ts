import { createConfiguredSources, parseSourceNames } from "./configured-sources.js";
import { createResourceHttpServer } from "./http-api.js";
import { zeroCostResourceKeys } from "./policy.js";
import { ResourceService } from "./service.js";
import { ResourceStore } from "./store.js";

const store = new ResourceStore(process.env.AI_CLUSTER_DATABASE_PATH ?? "/data/resource-loop.sqlite");
const sources = createConfiguredSources({
  names: parseSourceNames(process.env.AI_CLUSTER_SOURCES ?? "openrouter,groq,local"),
  secretsDirectory: process.env.AI_CLUSTER_SECRETS_DIR ?? "/run/secrets",
  ...(process.env.AI_CLUSTER_LOCAL_ENDPOINT === undefined
    ? {}
    : { localEndpoint: process.env.AI_CLUSTER_LOCAL_ENDPOINT }),
});
const service = new ResourceService({ sources, allowedResources: zeroCostResourceKeys, store });
const server = createResourceHttpServer(service);
const host = process.env.AI_CLUSTER_HOST ?? "127.0.0.1";
const port = readPort(process.env.AI_CLUSTER_PORT ?? "8787");

server.listen(port, host, () => {
  process.stdout.write(`${JSON.stringify({ event: "listening", host, port })}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}

function readPort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("AI_CLUSTER_PORT must be an integer");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 65_535) throw new Error("AI_CLUSTER_PORT must be from 1 through 65535");
  return parsed;
}
