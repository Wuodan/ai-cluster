# Early resource service interface

This is the first reviewable slice of Milestone 6. It exposes the resource loop to a future work loop without requiring
the client to know provider-specific APIs or model identifiers.

The service listens on `127.0.0.1:8787` by default. The Compose deployment binds the same loopback-only address on the
host while the service itself listens inside its private container network. Both long-running containers have health
checks and an `unless-stopped` restart policy; the service gets a 45-second shutdown grace period so a bounded provider
call can finish and SQLite can close cleanly.

Development Compose binds the ignored repository-local `data/` directory at `/data`, making SQLite observations directly
inspectable. `compose.production.yaml` replaces that bind mount with a named volume for production-style deployment.

## Endpoints

- `POST /v1/inference` accepts `prompt`, optional `maxOutputTokens`, and optional requirements containing
  `capabilities` and `minimumContextTokens`. Success returns the request ID, selected source, selectable model, actual
  provider-resolved model when supplied, access path, output, current resource state, and current observed capability
  evidence.
- `GET /v1/status` returns every configured resource, including an explicit unknown state before its first observation.
- `GET /v1/history?limit=100` returns bounded recent attempts plus state transitions and local recovery findings.
- `GET /v1/audit` checks every persisted attempt against the zero-cost allowlist and reports cost-guard rejections.
- `GET /health` reports process health.

When no resource has the requested capability evidence, inference returns HTTP 503 with
`status: "no_suitable_source"`. When suitable resources exist but all fail, it returns HTTP 503 with
`status: "no_source_succeeded"`. When matching resources exist but are disabled or still cooling down, it returns
`status: "no_resource_currently_available"` with the affected resources, reasons, and known retry times. All results
carry a request ID for history correlation.

The audit is deliberately labeled as an application-selection-policy audit. It can prove that this software did not
select a resource outside its allowlist and that OpenRouter rejected any response lacking exact zero reported cost. It
cannot independently prove a provider account balance; that requires provider-side balance observations.

## Current milestone boundary

The HTTP contract, persisted resolved-model identity, status, history, audit, and refusal behavior are implemented.

Background maintenance uses a single queue, so maintenance calls never overlap. Its defaults are:

- probe unknown or retry-eligible resources every 15 minutes, while skipping available, disabled, and still-cooling
  resources;
- refresh the OpenRouter free catalog every 6 hours;
- re-run the deterministic capability suite every 24 hours, skipping disabled and still-cooling resources.

Intervals can be changed with `AI_CLUSTER_PROBE_INTERVAL_MS`, `AI_CLUSTER_CATALOG_INTERVAL_MS`, and
`AI_CLUSTER_EVALUATION_INTERVAL_MS`; values below one second are rejected. Every run records kind, target, outcome,
summary, and start/finish time. Provider HTTP calls are bounded to 30 seconds. All inference maintenance paths apply the
same zero-cost allowlist as client requests. On restart, persisted last-run times determine the remaining delay; recent
work is not repeated merely because the process restarted.

Each completed or skipped maintenance run is also written as a structured `event: "maintenance"` line to standard
output. An initial `maintenance_configured` line shows the active intervals, so quiet logs mean that no task is due—not
that the scheduler is missing.

The live Compose service is now running against its persistent volume. Its first cycles recorded three resources, a
successful free-catalog snapshot, provider-resolved models, and a real OpenRouter transition from malformed response to
degraded, cooldown elapsed, and available. A sustained live run still remains before Milestone 6 is complete.
