import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { capabilities, type Capability, type InferenceRequest, type ResourceRequirements } from "./resource.js";
import type { ResourceService } from "./service.js";

const maximumRequestBytes = 65_536;

export function createResourceHttpServer(service: ResourceService): Server {
  return createServer((request, response) => {
    void handleRequest(service, request, response).catch((error: unknown) => {
      sendJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

async function handleRequest(
  service: ResourceService,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/status") {
    sendJson(response, 200, await service.status());
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/history") {
    try {
      const limit = parseLimit(url.searchParams.get("limit"));
      sendJson(response, 200, await service.history(limit));
    } catch (error: unknown) {
      sendJson(response, 400, {
        error: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/audit") {
    sendJson(response, 200, await service.audit());
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/inference") {
    try {
      const inferenceRequest = parseInferenceRequest(await readJsonBody(request));
      const result = await service.infer(inferenceRequest);
      sendJson(response, result.status === "success" ? 200 : 503, result);
    } catch (error: unknown) {
      sendJson(response, 400, {
        error: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumRequestBytes) throw new Error(`Request exceeds ${maximumRequestBytes} bytes`);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function parseInferenceRequest(value: unknown): InferenceRequest {
  if (!isRecord(value) || typeof value.prompt !== "string" || value.prompt.trim().length === 0) {
    throw new Error("prompt must be a non-empty string");
  }
  const maxOutputTokens = value.maxOutputTokens ?? 256;
  if (!Number.isSafeInteger(maxOutputTokens) || (maxOutputTokens as number) < 1 || (maxOutputTokens as number) > 4_096) {
    throw new Error("maxOutputTokens must be an integer from 1 through 4096");
  }
  const requirements = parseRequirements(value.requirements);
  return {
    prompt: value.prompt,
    maxOutputTokens: maxOutputTokens as number,
    ...(requirements === undefined ? {} : { requirements }),
  };
}

function parseRequirements(value: unknown): ResourceRequirements | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("requirements must be an object");
  let requiredCapabilities: Capability[] | undefined;
  if (value.capabilities !== undefined) {
    if (!Array.isArray(value.capabilities) || !value.capabilities.every(
      (item) => typeof item === "string" && (capabilities as readonly string[]).includes(item),
    )) throw new Error("requirements.capabilities contains an unknown capability");
    requiredCapabilities = value.capabilities as Capability[];
  }
  const minimumContextTokens = value.minimumContextTokens;
  if (
    minimumContextTokens !== undefined
    && (!Number.isSafeInteger(minimumContextTokens) || (minimumContextTokens as number) < 1)
  ) throw new Error("requirements.minimumContextTokens must be a positive integer");
  return {
    ...(requiredCapabilities === undefined ? {} : { capabilities: requiredCapabilities }),
    ...(minimumContextTokens === undefined ? {} : { minimumContextTokens: minimumContextTokens as number }),
  };
}

function parseLimit(value: string | null): number {
  if (value === null) return 100;
  if (!/^\d+$/.test(value)) throw new Error("limit must be an integer");
  const limit = Number(value);
  if (limit < 1 || limit > 1_000) throw new Error("limit must be from 1 through 1000");
  return limit;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
