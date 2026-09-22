# Local recovery observations

Observed on 2026-09-21. This note records the Milestone 5 experiment; model availability and runtime behavior can change.

## Recovery contract

The local model is not a general replacement for the external pool. It receives bounded, sanitized observations and has
three jobs:

1. Distinguish a temporary wait from a genuinely new access path.
2. Extract candidate provider, access path, supporting evidence, and concrete qualification checks.
3. Stop at a clearly named manual obstacle when progress needs an account, credentials, terms acceptance, or payment
   configuration.

It returns one strict JSON object. The deterministic layer validates the shape and persists the observations, raw output,
parsed proposal, model identity, parse result, and time. The result never qualifies a source or authorizes spending. It
contains no credential and cannot create an account or call a candidate endpoint.

The current inspection boundary is intentionally narrow: the recovery command reads at most 4096 bytes of already
captured text on standard input. That text can come from the resource state/catalog code or from an explicitly allowed
page captured by a deterministic caller. Automatic open-web research and page fetching are not yet granted to the model.

## Runtime selection

The runtime is the CPU image `ghcr.io/ggml-org/llama.cpp:server`, on a private container network with no published port.
The selected model is `ggml-org/Qwen3-4B-GGUF:Q4_K_M`. The published GGUF file is 2.5 GB and Apache-2.0 licensed:

- <https://huggingface.co/ggml-org/Qwen3-4B-GGUF/tree/main>
- <https://github.com/ggml-org/llama.cpp/blob/master/docs/docker.md>

The first candidate, Qwen3 1.7B Q4_K_M, used a 1.28 GB file and approximately 1.2 GiB resident memory. It handled some
recovery prompts, but mislabeled a pure HTTP 429/reset case as a newly found candidate. It also passed only basic text
generation in the existing short-budget capability suite. It was therefore rejected for the recovery role.

Qwen3 4B Q4_K_M used approximately 2.05 GiB resident memory after a recovery request with a 2048-token context and one
server slot. This remains inside the provisional 1--4 GB local-memory target. One measured recovery request processed
342 prompt tokens at about 196 tokens/second and generated 79 tokens at about 12 tokens/second on the development
machine; timings are observations, not minimum hardware requirements.

## Controlled outage results

With all external sources represented as unavailable, Qwen3 4B produced valid persisted results for all three recovery
tasks:

- All sources returning HTTP 429 with `Retry-After: 1800`: `no_candidate`, with an instruction to retry after 1800
  seconds.
- A hypothetical unauthenticated OpenAI-compatible free endpoint: `candidate_found`, with endpoint probing, cost,
  availability, rate-limit, and exhaustion checks retained as untrusted qualification work.
- A hypothetical free trial requiring signup, terms acceptance, and an API key: `manual_action_required`, identifying
  account creation as the remaining human obstacle.

The latter two provider examples deliberately use invalid/hypothetical domains. They exercise judgment and persistence
without treating an unverified real provider as safe or creating an external account.

The existing general capability suite is not the acceptance test for this fallback. Small reasoning models may spend a
short output budget before producing their final response. Recovery uses a bounded 768-token output budget within the
2048-token runtime context and is accepted only when its complete output passes the strict proposal parser.

## Reproduction

Start the isolated local server (the first run downloads the 2.5 GB model):

```sh
docker compose up -d local-llama
```

After its health endpoint is ready, pipe observations to the one-shot recovery command:

```sh
printf '%s\n' 'All external sources are unavailable. No alternative path was found.' \
  | docker compose --profile tools run --rm -T resource-manager
```

During development, the SQLite database is retained in the ignored repository-local `data/` directory so it can be
inspected directly. The model cache is retained separately in the `model-cache` Docker volume.

## Remaining boundary

This milestone proves useful local interpretation and durable recovery output, not autonomous provider acquisition. A
later step still needs a safe deterministic collector for allowlisted pages, plus candidate-specific qualification code.
Unknown cost behavior, account setup, paid fallback, or terms acceptance must remain explicit manual obstacles.
