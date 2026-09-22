# Bounded resource-research and qualification worker

This worker is the first independent useful consumer of the resource service. It begins the next resource-loop step while
the Milestone 6 soak continues. It is deliberately a one-shot tool rather than another responsibility inside the
resource-service process.

## Boundary

One invocation accepts exactly one provider name and one documentation URL. The URL must exactly match an
operator-supplied allowlist and must use HTTPS. Collection does not follow redirects, accepts only HTML, plain text, or
JSON, reads at most 64 KiB by default, and times out after 15 seconds. The worker does not browse links from the page.
It retains that bounded snapshot and sends at most a sanitized 24 KiB excerpt to keep the resource-service request below
its own input bound even when JSON escaping expands the text.

The captured document is untrusted, including any instructions it contains. The worker sends it to the resource
service with a `structured_json` requirement. It has no provider credentials and cannot select a provider or model. A
bounded, strictly validated response may describe at most three candidates, eight claims per candidate, and twelve
qualification steps per candidate.

Every provider statement remains an untrusted claim. A candidate is never qualified by an LLM response or by the
presence of words such as "free tier." The worker persists:

- the exact source URL, bounded snapshot, content type, and SHA-256 digest;
- the resource-service request ID, selected route, provider-resolved model when supplied, and raw output;
- the parsed claims, manual blockers, and proposed qualification steps;
- the qualification adapter and deterministic observations, or the reason qualification did not run.

Research state is stored separately in `/data/resource-research.sqlite`; the worker does not write into the resource
service's operational database.

## Qualification policy

There is no generic endpoint/model probe. Qualification can run only through a code-trusted adapter that explicitly
matches the provider and access path. All of these checks must deterministically pass before a candidate can be marked
qualified:

1. exact zero marginal cost;
2. paid fallback is blocked;
3. the bounded access probe works.

A failed check rejects the candidate. Missing, unknown, duplicate, malformed, or adapter-failure evidence leaves it
incomplete. The current command registers no real candidate adapters; newly researched candidates therefore remain
incomplete until a candidate-specific adapter is reviewed and added.

Account creation, obtaining credentials, accepting terms, or configuring payment are manual blockers. If any is
reported, the worker records `manual_action_required` and does not invoke a qualification adapter. A later adapter must
also enforce its own account and cost boundary rather than trust the research result.

## Run one bounded task

The resource service must already be healthy. Supply the exact allowed page in both the environment allowlist and task:

```sh
AI_CLUSTER_RESEARCH_URLS='https://provider.example/pricing' \
  docker compose --profile tools run --rm -T research-worker <<'EOF'
{"provider":"Example Provider","url":"https://provider.example/pricing"}
EOF
```

The command prints only the run ID, outcome, and candidate count. Inspect the ignored development database locally; do
not edit it while a worker is writing:

```sh
sqlite3 -header -column data/resource-research.sqlite \
  "select id, provider, outcome, service_source_id, service_resolved_model from research_runs order by started_at_ms desc;"
sqlite3 -header -column data/resource-research.sqlite \
  "select provider, access_path, trust from research_candidates order by run_id, sequence;"
sqlite3 -header -column data/resource-research.sqlite \
  "select adapter_id, status, reason from qualification_attempts order by observed_at_ms desc;"
```

The source snapshot and model output can contain hostile or misleading public text. They are evidence for inspection,
not instructions for an operator or another process.

## Current limit

This slice proves bounded collection, resource-service consumption, durable untrusted findings, a fail-closed
qualification boundary, and human-decision stops. It does not yet schedule research, discover its own URLs, create
accounts, hold candidate credentials, or qualify a real new provider. The next safe increment is a candidate-specific
adapter selected from a persisted finding, after its zero-spend account boundary is known.
