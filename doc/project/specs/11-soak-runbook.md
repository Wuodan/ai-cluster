# Resource-service soak runbook

This run keeps the early resource service available while later development continues. It is intended to reveal real
catalog changes, intermittent provider failures, cooldown/recovery behavior, restart problems, and policy violations.
It does not deliberately exhaust a free allowance.

The soak is useful evidence for Milestone 6, but it is not a gate that prevents work on the resource-research worker or
the later coding loop. Those can consume the service while the soak continues.

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

Inspect recent inference attempts, state transitions, recovery findings, and maintenance heartbeats:

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
24 hours. Recent work is not repeated after a restart.

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

Starting again with `docker compose up -d resource-service` reuses the database and model cache. Do not use
`docker compose down -v` unless the explicit intention is to delete both named volumes, including soak history.

## Hand-off for continued development

Leave the service running and return to the project later with a request to continue. The next inspection can read the
same API and named SQLite volume. Useful evidence includes:

- different provider-resolved models for the same free route;
- catalog additions, removals, or price/status changes;
- failures followed by cooldown and recovery;
- maintained capability evidence changing over time;
- explicit refusals when no suitable or currently available resource exists;
- an audit that continues to show no selection outside the zero-cost allowlist.
