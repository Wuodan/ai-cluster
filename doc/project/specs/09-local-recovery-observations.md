# Historical local recovery experiment

Observed on 2026-09-21. This note preserves an experiment that informed local-model selection. The candidate-provider
recovery command and persistence/API surface were removed after scope review: automated acquisition of additional
provider accounts is not current project work. Model availability and runtime behavior can change.

## Experimental recovery contract

The experiment treated the local model as a bounded interpreter rather than a general replacement for the external pool.
It received sanitized observations and had three jobs:

1. Distinguish a temporary wait from a genuinely new access path.
2. Extract candidate provider, access path, supporting evidence, and concrete qualification checks.
3. Stop at a clearly named manual obstacle when progress needs an account, credentials, terms acceptance, or payment
   configuration.

It returned one strict JSON object. The deterministic layer validated the shape and persisted the observations, raw
output, parsed proposal, model identity, parse result, and time. The result never qualified a source or authorized
spending. It contained no credential and could not create an account or call a candidate endpoint.

The inspection boundary was intentionally narrow: the recovery command read at most 4096 bytes of already captured text
on standard input. Automatic open-web research and page fetching were not granted to the model.

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

## Resulting boundary

The experiment demonstrated that the 4B model can interpret bounded observations, but that behavior is not needed for
the current product direction. The local runtime remains as an independently available inference source. Historical
rows in the ignored development database are retained, but the application no longer reads or creates recovery findings.
