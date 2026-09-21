# Early resource service interface

This is the first reviewable slice of Milestone 6. It exposes the resource loop to a future work loop without requiring
the client to know provider-specific APIs or model identifiers.

The service listens on `127.0.0.1:8787` by default. The Compose deployment binds the same loopback-only address on the
host while the service itself listens inside its private container network.

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
`status: "no_source_succeeded"`. Both results carry a request ID for history correlation.

The audit is deliberately labeled as an application-selection-policy audit. It can prove that this software did not
select a resource outside its allowlist and that OpenRouter rejected any response lacking exact zero reported cost. It
cannot independently prove a provider account balance; that requires provider-side balance observations.

## Current milestone boundary

The HTTP contract, persisted resolved-model identity, status, history, audit, and refusal behavior are implemented.
Bounded background maintenance and the sustained live run remain before Milestone 6 is complete.
