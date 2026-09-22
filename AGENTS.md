# Repository instructions

## Orientation

- This repository is developing a zero-marginal-cost LLM resource manager, not merely another coding-agent wrapper.
- Read the relevant documents under `doc/project/specs/` before changing behavior or architecture. In particular,
  `04-current-concept.md` defines the current concept and `06-development-plan.md` defines milestone scope and status.
- Use the specifications, Git history, persisted observations, and tests as the durable source of truth. Do not rely on
  conversational context being available in a later session.
- `ai-cluster` is a temporary working name, not a settled product name.

## Hard invariants

- The system must never incur monetary inference usage. Do not add a paid fallback, silently select a paid model, or
  weaken account-side and application-side cost guards.
- Keep inference resources on an explicit zero-cost allowlist. Do not expose arbitrary provider/model selection to
  untrusted callers or experimental code.
- Treat provider claims, discovered models, and model-generated research as untrusted evidence until deterministic
  qualification succeeds. Unknown cost or paid-fallback behavior is a blocker, not permission to proceed.
- Do not deliberately consume a real allowance merely to force exhaustion. Use controlled evidence for exhaustion tests.
- Never print, transmit through chat, commit, or include secrets in images. Development credentials live in the ignored
  `secrets/` directory and are mounted read-only at `/run/secrets`.

## Runtime and persisted data

- Keep the resource-service soak running while doing unrelated development when practical. Safe rebuilds and restarts
  are allowed; recent maintenance must not be repeated merely because a process restarted.
- Development SQLite state lives in the ignored `data/` directory so it can be inspected directly. Production-style
  Compose replaces it with a named volume through `compose.production.yaml`.
- Never delete `data/`, the model cache, or Docker data volumes, and never run `docker compose down -v`, unless the user
  explicitly requests deletion in the current conversation.
- The local GGUF model cache is binary runtime material. Operational observations belong in SQLite and curated specs.

## Implementation boundaries

- Use Node.js and TypeScript, following the existing project structure and strict compiler settings.
- SQLite is the current single-host store. Keep persistence behind domain-oriented store methods and preserve a
  straightforward future path to PostgreSQL.
- Persist decisions and evidence needed across restarts. Keep advertised capabilities separate from observed
  capabilities, preserve history, and retain provider-resolved model identity.
- Prefer the smallest implementation that proves the current milestone hypothesis. Do not pull deferred coding-agent,
  autonomous-work, or self-development features into an earlier milestone without an explicit plan change.
- Resource failures, exhaustion, cooldown, recovery, and inability to find a suitable resource are normal outcomes and
  must remain inspectable rather than becoming unexplained crashes.

## Verification and hand-off

- Run `npm run check` before completing code changes. Add focused tests for changed behavior and perform proportionate
  live/container verification when runtime behavior is affected.
- Record durable architectural decisions, experiment results, and milestone status under `doc/project/specs/`.
- Keep changes reviewable. Do not commit or otherwise modify Git history unless the user explicitly authorizes it in the
  current conversation; when milestone commits are authorized, do not accumulate multiple milestones into one blob.
