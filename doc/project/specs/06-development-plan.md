# Initial development plan

This plan covers the path from an empty repository to an early usable resource loop. It deliberately postpones the
autonomous coding engine, autonomous laboratory, and self-development system until the project can reliably obtain and
manage zero-cost intelligence.

The plan is hypothesis-driven. Each milestone should prove something about the project rather than merely add
components.

## Governing constraints

- The system must never incur monetary usage.
- External resources are assumed to change or disappear.
- Resource observations must survive process restarts.
- A resource's own claim that it is free is insufficient when paid fallback remains possible.
- Failure and exhaustion are normal states, not exceptional crashes.
- Early implementation should remain small enough to replace as the problem becomes better understood.

## Milestone 0: empirical source verification

### Hypothesis

At least two independent, capable external LLM resources can currently be accessed programmatically without monetary
spending, and their important operational behavior can be observed.

### Work

- Create or designate project accounts for OpenRouter and Groq.
- For OpenRouter, consider a dedicated $10-funded account to unlock the larger free-model allowance.
- Before using that account, disable automatic top-up and remove a reusable payment method where possible.
- Keep the project API key's account-side spending limit at $0 and verify it again after adding account credit.
- Keep its API key inside the trusted OpenRouter adapter and initially permit only the exact `openrouter/free` model
  identifier. Do not expose the key or arbitrary model selection to agents or experimental code.
- Do not attach a payment method unless zero paid usage can still be guaranteed independently of application logic.
- Probe each source manually with a minimal request.
- Record current models, limits, headers, representative responses, exhaustion errors, and recovery behavior.
- Check whether an account or provider can silently select a paid model or paid fallback.
- Record the OpenRouter balance before and after free-model probes; any decrease is a failed safety check.
- Select an initial local runtime and small fallback-model candidate for later testing.

### Exit criteria

- Two independent external sources have successfully answered test requests at zero cost.
- At least one source exposes useful quota or reset observations.
- The project has a documented way to guarantee that the test credentials cannot create charges.
- OpenRouter free-model probes leave the parked balance unchanged, and no untrusted caller can submit an arbitrary model
  identifier through the project key.
- The OpenRouter project key reports a $0 spending limit after the account has been funded.
- Unknown behavior is explicitly recorded rather than guessed.

This milestone includes manual work. Automating discovery before understanding even two concrete sources would hide the
problem behind premature abstractions.

### Current status

The milestone is complete. Its central hypothesis has been established more strongly than required: OpenRouter, Groq,
and Gemini have all answered project-account requests, and Groq exposes useful quota evidence. Groq and the dedicated
Gemini project have no paid fallback available. OpenRouter successfully serves its free route with a $10 account balance
while its project key has a $0 spending limit; the test request reported zero cost and left the balance unchanged.

OpenRouter documents an increase to 1,000 free-model requests per day after the $10 purchase, and the account changed out
of its free-tier classification after funding. The successful test response did not expose the live daily counter, so
the exact allowance remains policy evidence rather than a directly observed quota value. This uncertainty is recorded
rather than blocking the resource-loop implementation.

The provisional local fallback candidate is a CPU-only `llama.cpp` server running a quantized Qwen3 1.7B model. Its
currently packaged quantized model is approximately 1.4 GB. Qwen3 4B, at approximately 2.5 GB, is the stronger comparison
candidate if the smaller model cannot perform the recovery tasks. Selection is intentionally provisional until Milestone
5 defines and evaluates those tasks.

## Milestone 1: minimal persistent resource loop

### Hypothesis

A small deterministic program can invoke multiple heterogeneous sources, persist what happened, and select another
source when the preferred one cannot serve a request.

### Work

- Choose the implementation language and minimal project structure.
- Define the smallest useful request and result representation.
- Implement two source integrations from Milestone 0.
- Represent at least these outcomes: success, unavailable, exhausted, rejected, malformed response, and unknown failure.
- Persist attempts, timestamps, selected source/model, outcome, latency, and available quota/reset evidence.
- Implement deterministic source selection and fallback.
- Add a fake source so exhaustion, failure, and recovery can be tested without consuming real allowances.
- Enforce an allowlist of zero-cost endpoints and models.

### Exit criteria

- A request succeeds through either of two real independent sources.
- A simulated or real exhaustion causes selection of the other source without losing the original failure evidence.
- Restarting the program retains the observation history.
- No configured execution path can select a model known to have non-zero pricing.

The selection policy may initially be simple and deterministic. Intelligent triage is not needed to prove switching.

### Current status

The milestone is complete. The implementation uses Node.js 24, TypeScript, and Node's built-in SQLite module behind a
small domain-oriented store. SQLite is an initial single-host choice, not a permanent architectural dependency; IDs,
timestamps, store operations, and transaction boundaries should remain straightforward to move to PostgreSQL if
multi-process or multi-host operation later requires it.

The resource loop has fixed-model adapters for OpenRouter and Groq, a static zero-cost allowlist, normalized outcomes,
deterministic fallback, durable attempt and quota evidence, and fake-source tests. Both real adapters have completed
requests from the host and from the built OCI image. The container reads individual credentials through read-only secret
mounts and retains its SQLite history on a separate data volume. A restart test verifies that observations survive closing
and reopening the store.

## Milestone 2: live availability and recovery

### Hypothesis

The resource loop can distinguish temporary exhaustion from permanent or unknown failure well enough to stop wasting
requests and later reuse recovered capacity.

### Work

- Introduce explicit observed states such as unknown, available, degraded, exhausted, cooling down, and disabled.
- Interpret documented rate-limit and reset signals where available.
- Use bounded probing and backoff where reset information is absent.
- Prevent retry storms and repeated consumption of scarce allowance.
- Reconsider cooled-down resources when evidence says they may have recovered.
- Record state transitions and the observations that caused them.
- Exercise at least one real quota reset or refill cycle.

### Exit criteria

- An exhausted source is not selected repeatedly for normal requests.
- A recovered source returns to service without manual state editing.
- Restarting during cooldown preserves correct behavior.
- The state history explains why a source was avoided and later retried.

### Current status

The milestone is complete. Resource state is persisted independently for each source/model as unknown, available,
degraded, exhausted, cooling down, or disabled. Exhaustion honors explicit reset evidence when available; other temporary
failures use bounded exponential cooldown. Rejected resources are disabled rather than retried automatically.

Tests verify that an exhausted source is skipped before its retry time, that cooldown survives closing and reopening the
database, and that a recovered source is automatically reconsidered. Every change is recorded with a per-resource
transition sequence, previous state, reason, observation time, and optional retry time.

A live Groq exercise also observed its token bucket refill between requests: after waiting longer than the returned token
reset duration, remaining token capacity increased despite the second request consuming tokens. Deliberately exhausting
the real daily request allocation was unnecessary; exhaustion and recovery behavior is exercised with controlled fake
sources without wasting external capacity.

## Milestone 3: changing catalogs and tool-mediated access

### Hypothesis

The resource loop can handle more than a fixed list of OpenAI-compatible endpoints.

### Work

- Read and compare a provider's live model catalog with previously observed models.
- Detect a free model appearing, disappearing, or changing price/status.
- Quarantine newly discovered models until their zero-cost status and minimal behavior have been checked.
- Add one command/process-mediated resource, with OpenCode as the initial candidate.
- Capture process exit, structured output where available, rate-limit messages, authentication failure, and partial work.
- Keep the coding agent's execution semantics outside the generic resource observation core.

### Exit criteria

- Catalog changes become persisted observations rather than requiring a source-code edit.
- A newly absent or non-free model is not selected.
- The system can obtain and classify a result from one non-HTTP or agent-mediated access path.
- Failure of that process does not corrupt the resource loop.

### Current status

The milestone is complete. A successful OpenRouter snapshot retains only `:free` model identifiers and verifies
that both prompt and completion prices parse to zero. Newly discovered or reappearing models are quarantined. A model is
selectable only after a separate successful qualification, and it becomes unavailable or rejected when it disappears or
reports non-zero pricing. Snapshots and meaningful status changes are persisted.

The first live snapshot observed 21 zero-priced free-model entries. All 21 were quarantined and none was selectable.
Tests verify discovery, qualification, disappearance, price changes, and selection exclusion.

The first process-mediated resource uses the installed Codex CLI and the existing project-owner account allowance. It
does not select a particular model. Each invocation runs ephemerally in an empty temporary directory with a read-only
sandbox, prompt input on standard input, structured JSONL output, bounded output capture, and a bounded runtime. Exit
status, standard error, timeouts, malformed output, quota errors, authentication errors, and partial agent output are
classified. A live invocation succeeded through the resource loop and its result was persisted.

This adapter proves the non-HTTP path but is not a foundational dependency. The base OCI image does not bundle Codex or
its authentication; process resources must be installed and supplied by a deployment that chooses to use them. OpenCode
remains a later candidate if a genuinely independent zero-cost allowance can be configured without paid fallback.

## Milestone 4: capability evidence and task-aware selection

### Hypothesis

The system can make better choices than a fixed priority list by using durable evidence about resource capabilities and
past outcomes.

### Work

- Define a small evaluation suite covering the capabilities needed by resource management.
- Preserve test inputs, outputs, evaluator decisions, model identity, access path, and time.
- Separate advertised capability from observed capability.
- Allow task requests to state requirements such as tool use, structured output, context size, or coding quality.
- Select only resources with adequate current evidence.
- Use an LLM for comparative judgment only where deterministic evaluation is insufficient, and retain its rationale and
  uncertainty.

### Exit criteria

- The same request requirements can lead to different resource choices based on recorded evidence.
- A model that fails a required capability is not selected merely because it is available.
- Re-evaluation can supersede stale evidence without deleting history.
- The system can conclude that no currently available resource is suitable.

## Milestone 5: local fallback and resource recovery

### Hypothesis

A model fitting approximately 1--4 GB of RAM can assist deterministic tools in restoring external capability when the
known external pool is unusable.

### Work

- Turn the abstract recovery role into a small set of concrete tasks.
- Evaluate local model and runtime candidates against those tasks.
- Give the fallback narrowly scoped research and inspection tools.
- Simulate loss of every configured external source.
- Have the recovery path produce durable candidate-source findings and qualification steps.
- Where safe and feasible, use a recovered external model to continue deeper qualification.

### Exit criteria

- The fallback runs within the agreed local resource budget.
- With external sources disabled, it produces a useful, persisted recovery result rather than merely an error message.
- At least one controlled exercise progresses from no usable external source to a qualified external candidate, or
  produces clear evidence of the remaining manual obstacle.

Fully autonomous provider registration and adapter generation are not required for this milestone.

## Milestone 6: early resource service

### Hypothesis

The resource loop is reliable enough to supply an independent future work loop.

### Work

- Expose a stable local interface for requesting inference by requirements rather than provider name.
- Return the selected source/model and relevant evidence with every result.
- Provide current pool state, history, and a zero-spend audit.
- Add bounded background maintenance for catalog refresh, probes, and re-evaluation.
- Implement the explicit **cannot currently provide a suitable resource** result.
- Run continuously long enough to encounter genuine provider changes, exhaustion, and recovery.

### Exit criteria

- A client can request suitable zero-cost intelligence without knowing provider-specific details.
- The service survives restarts and expected source failures.
- At least two external sources and the local fallback are represented in its persistent state.
- It never substitutes paid inference when free capacity is unavailable.
- A sustained run produces an understandable history of selections, failures, cooldowns, recoveries, and refusals.

Reaching this milestone means the resource layer is usable in an early form. It does not mean the larger project is
complete.

## Deferred until after the early resource loop

- A general autonomous coding-agent integration.
- The work loop that chooses its own useful activities.
- Human inboxes, review batching, and bounded speculative work.
- The trusted-supervisor/autonomous-laboratory implementation.
- Self-development and pull requests to the canonical repository.
- Autonomous account creation.
- Contributions to external projects.
- Broad concurrency and distributed execution.

These remain part of the concept. They are deferred because implementing them before the resource loop works would build
the project on an unproven foundation.

## Initial operating defaults

The following defaults are sufficient to begin Milestone 0. They should be revised when experiments provide better
evidence.

### Accounts

The initial project accounts are:

1. OpenRouter, preferably dedicated to the project, with a protected $10 deposit to unlock the larger free-model
   allowance;
2. Groq, providing a verified independent direct free tier with observable request and token limits;
3. Gemini, providing a verified independent free tier through a dedicated project without linked billing.

OpenCode does not require investigation for Milestone 0: using OpenCode with an OpenRouter account does not create a
separate inference resource.

Accounts and API keys should be owned or explicitly supplied by the project owner. Account creation does not need to be
autonomous during initial development.

### Deployment and minimum hardware target

The prototype should target an OCI container on a Linux host and should not require a GPU. Development will occur on the
owner's laptop, which has ample capacity. Exact host specifications are not an input to the initial design.

Two provisional profiles make the requirement clearer:

- **Resource manager without local inference:** 2 CPU cores, 2 GB RAM, and approximately 5 GB of storage.
- **Resource manager with CPU-only fallback model:** 4 CPU cores, 8 GB RAM, and approximately 10--20 GB of storage.

The second profile assumes a quantized small model whose weights occupy approximately 1--4 GB, plus memory for its
runtime, the operating system, and the resource manager. Four GB of total system RAM may eventually be possible with a
smaller model, but it should not be promised before the recovery tasks and candidate models have been tested.

These are targets, not established minimums. Milestone 5 must measure and refine them. The eventual software should be
suitable for a laptop or a small rented VM.

### Secret storage

Secrets must never be committed, placed in container images, written into ordinary configuration, or passed as command
arguments that may appear in shell history or process listings.

During manual verification:

- credential files may live in the repository-local `secrets/` directory because it is excluded by both `.gitignore`
  and `.dockerignore`; a directory outside the repository would also be valid;
- directories should use mode `0700` and files mode `0600`;
- containers should receive individual credentials as read-only mounted secret files under `/run/secrets`;
- the program should read one credential per file and must never log its contents;
- repository ignore rules should still reject common local secret files as a secondary safeguard.

The exact host-side directory and secret-management product do not matter yet. A local owner-only directory is adequate
for Milestone 0; a later deployment can use Docker, Podman, systemd, or cloud secret mechanisms without changing the
program-facing `/run/secrets` convention.

### Account-specific observations

An account-specific observation is data such as an observed quota, remaining-request header, reset time, model list,
rate-limit error, or provider response collected while testing a project account.

Raw observations and logs should remain local because they may contain account identifiers, request identifiers,
prompts, or other sensitive metadata. Curated and deliberately redacted examples may be committed as documentation or
test fixtures when useful. Redaction must remove at least credentials, account and project identifiers, request IDs,
private prompts or code, and unnecessary exact usage history.

The implementation language selected in Milestone 1 is TypeScript on Node.js 24.
