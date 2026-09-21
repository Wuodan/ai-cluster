# Initial zero-cost resource landscape

Status: research snapshot from 2026-09-21. Offers, models, limits, and terms are expected to change. That instability is
part of the problem `ai-cluster` intends to handle.

This document identifies plausible starting resources for the first resource-loop prototype. It is not an exhaustive
provider catalog, and none of the resources below has yet been verified with project-owned accounts.

## What matters for the prototype

An initial resource is useful when it provides several of the following:

- no marginal monetary cost and no possibility of accidental paid fallback;
- a programmatic or automatable access path;
- a capable text or coding model;
- observable limits, reset information, or recognizable exhaustion errors;
- changing availability that exercises the resource loop;
- independence from the other initial resources;
- enough capacity to perform meaningful experiments.

The initial set should not consist solely of aliases for the same underlying provider. Correlated failures would create
the appearance of a pool without providing real redundancy.

## Strong initial candidates

### OpenRouter free models

[OpenRouter's current free plan](https://openrouter.ai/pricing) offers API and chat access to more than 25 free models,
with no payment method and a limit of 50 requests per day. OpenRouter currently raises the free-model allowance to 1,000
requests per day after at least $10 of credit has been added to the account. The credit is not a subscription charge and
need not be consumed. Its free-model collection changes over time, and the `openrouter/free` route can select a currently
available compatible free model.

Why it is useful:

- A dedicated unfunded account can remain structurally non-billable at the lower allowance.
- A one-time $10 deposit makes the higher allowance large enough for meaningful work without creating marginal cost,
  provided the credit is protected from use.
- One OpenAI-compatible API exposes a changing pool of models.
- The model catalog is queryable.
- It provides a natural test of model appearance, disappearance, and provider-side routing.

Limitations:

- Fifty requests per day is too small for sustained agentic work; the useful configuration likely requires the deposit.
- A funded account can consume the parked credit if a paid model or fallback is selected accidentally.
- The free router may obscure which underlying resource decisions should belong to `ai-cluster`.
- Different free models may have different context, privacy, and tool-use characteristics.
- Failed or poorly chosen requests can consume scarce daily capacity.

[OpenRouter guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview) can restrict an API key to an
explicit model allowlist independently of application code. A funded project account should disable automatic top-up,
avoid retaining a reusable payment method where possible, and apply a provider-side allowlist containing only the free
router and/or verified `:free` model identifiers. The exact protection must be tested before the account is automated.

Assessment: with a protected $10 deposit and 1,000 free requests per day, this becomes a strong initial source rather
than merely a small bootstrap source.

### Cerebras Inference free tier

[Cerebras documents a free API tier](https://inference-docs.cerebras.ai/support/rate-limits) with explicit request and
token buckets. At the time of research, `gpt-oss-120b` has limits including 30 requests per minute, one million tokens per
day, and 14,400 requests per day. Exact account limits remain authoritative and may differ.

Why it is useful:

- It is a direct provider independent of OpenRouter's account-level quota.
- Its API is OpenAI-compatible.
- Rate-limit headers and documented refill behavior provide useful observations for early state management.
- The published free capacity is large enough for meaningful tests.

Limitations:

- The free model set and limits can be temporarily reduced under demand.
- A small number of available models provides limited diversity.
- Published limits must still be verified against the actual project account.

Assessment: probably the best first direct-provider companion to OpenRouter.

### OpenCode Zen free models

[OpenCode Zen currently lists several models at zero token price](https://dev.opencode.ai/docs/zen), while explicitly
describing some free offers as available only for a limited time. Zen provides documented model-list and inference
endpoints, and [OpenCode can run a selected model non-interactively](https://opencode.ai/v2/docs/models).

Why it is useful:

- Limited-time teaser models closely match the kind of opportunity the project is intended to use.
- The same offer can potentially be observed through both a direct API and an existing coding-agent process.
- Model churn and undocumented practical exhaustion are valuable resource-loop test cases.
- OpenCode already supports many other providers and local models.

Limitations and safety concern:

- Zen's setup documentation asks for billing details and describes automatic balance reload for paid use.
- Zero-price models share a gateway with paid models.
- The project must verify that auto-reload is disabled and prevent selection or fallback to every non-zero-price model.
- Current free offers may disappear before implementation begins.

Assessment: a potentially useful volatile source, but it must not be enabled until zero-spend enforcement is proven.
It is a later candidate for both API-mediated and tool-mediated access experiments. Previous use of OpenCode with an
OpenRouter account does not establish that OpenCode Zen provides a separate allowance.

### Google Gemini Developer API free tier

[Google currently offers selected Gemini models with free input and output tokens](https://ai.google.dev/gemini-api/docs/pricing).
[Limits vary by model and project](https://ai.google.dev/gemini-api/docs/rate-limits), and daily quotas reset at midnight
Pacific time.

Why it is useful:

- Capable models and long contexts are available through a direct API.
- Quota exhaustion produces a documented `RESOURCE_EXHAUSTED` error.
- It is independent of the other proposed accounts.
- The reset behavior gives the resource loop a predictable recovery case.

Limitations:

- Exact active limits must be queried or observed per project.
- Free-tier prompts and responses may be used to improve Google's products.
- Model availability and free-tier eligibility change.
- A billing-linked project must not accidentally move the system onto paid usage.

Assessment: a strong additional source after the hard zero-spend boundary has been verified.

## Additional candidates

These are worth retaining in the research queue, but they need not be part of the first implementation.

### Groq

[Groq publishes free-tier limits and rate-limit response headers](https://console.groq.com/docs/rate-limits). Its direct,
OpenAI-compatible API and explicit remaining/reset headers make integration straightforward. Its model selection overlaps
with other providers, but the account quota and serving infrastructure are independent.

### Cloudflare Workers AI

[Cloudflare's free plan currently includes 10,000 neurons per day](https://developers.cloudflare.com/workers-ai/platform/pricing/),
resetting at 00:00 UTC. On the free plan, operations fail after the allocation is exhausted rather than becoming billable.
Its different accounting unit would be a useful later test of normalized resource observations.

### Hugging Face Inference Providers

[Free users currently receive a small monthly credit](https://huggingface.co/docs/inference-providers/pricing), and the
[Hub API exposes whether a provider/model combination is temporarily free](https://huggingface.co/docs/inference-providers/hub-api).
The small standing credit is not attractive as primary capacity, but the catalog metadata may be valuable for discovering
temporary promotions across providers.

### NVIDIA hosted NIM trial endpoints

[NVIDIA Developer Program members can use hosted NIM endpoints for prototyping](https://docs.api.nvidia.com/nim/docs/run-anywhere).
The catalog contains capable large models, but the exact trial quotas and permissible sustained use require empirical and
terms review.

## Rejected or stale candidates

### GitHub Models

GitHub Models previously offered useful free inference, but [GitHub retired the service on 2026-07-30](https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/).
It should not be implemented. Its disappearance is, however, a good example of why the resource loop exists.

## Recommended initial resource set

The first experiments should attempt to verify:

1. **OpenRouter free models** on a dedicated account with a protected $10 deposit, as a rotating aggregator with up to
   1,000 free requests per day.
2. **Cerebras free tier** as an independent, higher-capacity direct provider with observable limits.
3. **An additional direct provider**, initially Gemini or Groq, to ensure the pool is not merely different routes into
   the same underlying allowance.
4. **A small local model** as the always-available fallback; model selection is deferred until its concrete recovery tasks
   are clearer.

OpenCode Zen, Cloudflare, Hugging Face, and NVIDIA form a useful later discovery set. The first prototype does not need to
integrate every readily available API. Its purpose is to prove heterogeneous observation and switching without building
a static catalog that will immediately become obsolete.

## Verification still required

Before implementation relies on any external candidate, a project-owned account should be used to record:

- whether billing details are required;
- whether accidental paid usage is technically possible;
- whether provider-side model restrictions prevent consumption of parked credit;
- available models and their current zero-price status;
- actual account-specific request and token limits;
- response headers and error bodies near exhaustion;
- reset or refill behavior;
- whether failed requests consume allowance;
- API, CLI, or browser-only access paths;
- data retention and training treatment;
- automation restrictions relevant to the intended use.

These observations should later become resource-loop data rather than remain prose maintained by hand.
