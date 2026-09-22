# Resource-service soak runbook

This run keeps the early resource service available while later development continues. It is intended to reveal real
catalog changes, intermittent provider failures, cooldown/recovery behavior, restart problems, and policy violations.
It does not deliberately exhaust a free allowance.

The soak is useful evidence for Milestone 6, but it is not a gate that prevents later core development from consuming
the service while the soak continues.

## Start or update

From the repository root:

```sh
docker compose up -d --build resource-service
```

This also starts the private `local-llama` dependency. The first start downloads the selected model; later starts reuse
the named model-cache volume. Provider keys are read from the ignored `secrets/` directory. The HTTP API is published
only on `127.0.0.1:8787`.

The service is already running if both rows below report `healthy`:

```sh
docker compose ps
```

Development state is stored under the ignored repository-local `data/` directory. A production-style deployment uses a
named data volume instead:

```sh
docker compose -f compose.yaml -f compose.production.yaml up -d --build resource-service
```

## Monitor

Follow operational logs until interrupted with Ctrl-C; this does not stop the containers:

```sh
docker compose logs -f --tail=100 resource-service local-llama
```

Inspect process health and the current resource pool:

```sh
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8787/v1/status | jq .
```

Inspect recent inference attempts, state transitions, and maintenance heartbeats:

```sh
curl -sS 'http://127.0.0.1:8787/v1/history?limit=100' | jq .
```

Inspect the application-level zero-spend audit:

```sh
curl -sS http://127.0.0.1:8787/v1/audit | jq .
```

`jq` is only for readable formatting; omit `| jq .` if it is not installed.

The 15-minute availability job records a durable maintenance row even when every available resource is correctly
skipped. Those rows act as low-cost heartbeats. Catalog refreshes occur every 6 hours and capability evaluations every
24 hours. Recent work is not repeated after a restart. Each run emits a structured `maintenance` log event; startup also
emits `maintenance_configured` with the active intervals. It is therefore normal for the log to remain quiet between
scheduled events.

The database can also be inspected directly during development:

```sh
ls -lh data/
sqlite3 -header -column data/resource-loop.sqlite \
  "select kind, target, outcome, summary, datetime(started_at_ms / 1000, 'unixepoch', 'localtime') as started from maintenance_runs order by started_at_ms desc limit 20;"
```

Read it while the service is running if desired, but do not edit it behind the service's back.

## Check Milestone 6 readiness without waiting in an interactive session

After the service has remained running through the next normal daily capability-evaluation cycle, run this once from the
repository root:

```sh
npm run soak:check
```

The checker is read-only. It does not call any model or consume provider allowance. It reads the local HTTP status and
audit plus aggregate evidence from `data/resource-loop.sqlite`. It checks:

- that the host can reach the loopback HTTP interface;
- that exactly the expected OpenRouter, Groq, Gemini, and local resources are configured and allowlisted;
- that all four resources are currently available and have capability evidence;
- that the application-selection audit reports no paid path;
- that persisted maintenance spans at least 24 hours and the latest run of each kind did not fail;
- that a normal capability-evaluation run completed after Gemini was first observed;
- that the state history contains a temporary failure followed by recovery.

While a time or maintenance condition is still pending, the command prints `WAIT`, ends with `NOT READY`, and exits with
status 1. Leave the soak running and repeat the command later; do not shorten the configured intervals merely to make it
pass. When every condition passes, it ends with `READY FOR REVIEW` and exits with status 0. Send that summary with the
next request to review and, if appropriate, close Milestone 6.

To check a non-default database or service address:

```sh
AI_CLUSTER_DATABASE_PATH=/path/to/resource-loop.sqlite \
AI_CLUSTER_BASE_URL=http://127.0.0.1:8787 \
npm run soak:check
```

## Restart and persistence check

This exercises process restart without deleting data:

```sh
docker compose restart resource-service
docker compose ps
curl -sS 'http://127.0.0.1:8787/v1/history?limit=10' | jq .
```

The history should still contain entries from before the restart. Both long-running containers use the
`unless-stopped` restart policy.

## Stop without deleting observations

```sh
docker compose stop
```

Starting again with `docker compose up -d resource-service` reuses `data/resource-loop.sqlite` and the model cache. Do
not delete the `data/` directory. In the production-style Compose configuration, avoid `docker compose down -v` unless
the explicit intention is to delete its named data volume.

## Hand-off for continued development

Leave the service running and return to the project later with a request to continue. The next inspection can read the
same API and SQLite database. Useful evidence includes:

- different provider-resolved models for the same free route;
- catalog additions, removals, or price/status changes;
- failures followed by cooldown and recovery;
- maintained capability evidence changing over time;
- explicit refusals when no suitable or currently available resource exists;
- an audit that continues to show no selection outside the zero-cost allowlist.
