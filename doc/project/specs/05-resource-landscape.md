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

## Investigated candidates

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

[OpenRouter's documentation describes model allowlists](https://openrouter.ai/docs/guides/features/guardrails/overview),
but the project account's current Privacy UI exposes only a prompt-injection guardrail, not model-access guardrails. The
project must not assume that the documented model allowlist is available.

Initially, the OpenRouter key should be held only by the trusted resource adapter, which permits exactly the
`openrouter/free` model identifier. Agents and experimental code must not receive the key or supply an arbitrary model
identifier. The project key currently has an account-side spending limit of $0; a free request succeeds despite that
limit. This is the primary provider-side spending protection and must remain $0 after funding the account. Automatic
top-up should be disabled, a reusable payment method should be removed where possible, and the parked balance should be
monitored. Any balance decrease is a zero-spend invariant violation and should disable the source.

Assessment: with a protected $10 deposit and 1,000 free requests per day, this becomes a strong initial source rather
than merely a small bootstrap source.

### Cerebras Inference (currently paid)

[Cerebras documents free-trial and paid tiers](https://inference-docs.cerebras.ai/models/overview), and its model table
labels context lengths as "free / paid." This does not mean that current project accounts receive ongoing inference at
zero cost.

The authenticated project catalog currently exposes only two models:

- `gpt-oss-120b`, priced at $0.35/M input tokens and $0.75/M output tokens;
- `qwen-3.8-27b`, priced at $0.99/M input tokens and $1.49/M output tokens.

Both models returned `402 payment_required` through two valid API keys. Cerebras also describes Qwen 3.8 27B as a PayGo
model in its authenticated interface.

Assessment: Cerebras is not currently a zero-cost source and is excluded from the initial implementation. It may be
reconsidered if Cerebras offers a new free trial or tier later.

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

The dedicated project has now been tested without a linked billing account. Its API key authenticated, and
`gemini-3.6-flash` completed a generation request successfully. Google's current pricing page lists that model's standard
input and output as free of charge on the free tier. The API did not return remaining-quota headers; Google states that
active project-specific limits are visible in AI Studio.

The models endpoint also advertised `gemini-2.5-flash`, but an inference request reported that the model is unavailable
to new users and recommended `gemini-3.6-flash`. The resource manager must therefore probe actual usability rather than
treating model-list membership as sufficient evidence.

Assessment: a verified third independent source with a hard zero-spend boundary supplied by the absence of linked
billing. Its free-tier data treatment makes it unsuitable for private source code unless that policy changes.

## Further candidates

These are worth retaining in the research queue, but they need not be part of the first implementation.

### Groq

[Groq publishes free-tier limits and rate-limit response headers](https://console.groq.com/docs/rate-limits). Its direct,
OpenAI-compatible API and explicit remaining/reset headers make integration straightforward. Its model selection overlaps
with other providers, but the account quota and serving infrastructure are independent. A project-account probe has now
successfully used `openai/gpt-oss-120b` and observed request and token limits in the response headers.

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
2. **Groq free tier** as a verified independent direct provider with observable limits.
3. **Gemini Developer API free tier**, now verified as a third independent direct provider.
4. **A small local model** as the always-available fallback; model selection is deferred until its concrete recovery tasks
   are clearer.

OpenCode Zen, Cerebras, Cloudflare, Hugging Face, and NVIDIA form a useful later discovery set. Cerebras remains in that
set because its documented free tier may become available even though the project account currently receives a
payment-required response. The first prototype does not need to integrate every readily available API. Its purpose is to
prove heterogeneous observation and switching without building a static catalog that will immediately become obsolete.

## Verification still required

Before implementation relies on any external candidate, a project-owned account should be used to record:

- whether billing details are required;
- whether accidental paid usage is technically possible;
- whether any account-side spending limit can additionally protect the parked credit;
- available models and their current zero-price status;
- actual account-specific request and token limits;
- response headers and error bodies near exhaustion;
- reset or refill behavior;
- whether failed requests consume allowance;
- API, CLI, or browser-only access paths;
- data retention and training treatment;
- automation restrictions relevant to the intended use.

These observations should later become resource-loop data rather than remain prose maintained by hand.
