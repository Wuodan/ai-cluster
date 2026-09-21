# Milestone 0 observations

This document contains sanitized empirical observations from project accounts. It must not contain credentials, account
or project identifiers, request identifiers, private prompts, or private source code.

## 2026-09-21

### OpenRouter

Account and key state before funding the account:

- The API key authenticates successfully.
- The account reports `is_free_tier: true`.
- The key reports a spending limit of `$0` and `$0` remaining.
- Recorded paid usage is `$0`.
- A chat-completions request using the exact model identifier `openrouter/free` succeeded.
- OpenRouter selected `nvidia/nemotron-3.5-content-safety:free` for the probe.
- The response reported 469 prompt tokens, 16 completion tokens, and a cost of `$0`.
- Key usage remained `$0` after the request.

The short completion allowance was consumed by reasoning, so this probe did not assess answer quality. It established
authentication, free-route availability, dynamic model selection, and zero recorded cost.

Important finding: a key-level spending limit of `$0` permits zero-cost requests. This appears to provide the required
provider-side protection for parked account credit without relying on model-access guardrails. It must be rechecked after
the account is funded with $10.

Account and key state after a one-time $10 credit purchase:

- The credits endpoint reported $10 total credits, $0 total usage, and a $10 balance before the probe.
- The project key retained its `$0` spending limit and `$0` remaining spending allowance.
- The account changed from `is_free_tier: true` to `is_free_tier: false`.
- A request using the exact `openrouter/free` identifier returned HTTP 200 and the requested `probe-ok` answer.
- OpenRouter selected `liquid/lfm-2.5-2.6b:free` for this probe.
- The response reported 17 prompt tokens, 39 completion tokens, and both request cost and upstream inference cost as `$0`.
- After the request, total usage remained $0 and the balance remained $10.
- The successful response did not include daily rate-limit headers. The documented increase to 1,000 free-model requests
  per day is therefore supported by OpenRouter's account policy and the observed account-tier transition, but its live
  counter was not directly observed.

The funded configuration passes the zero-spend safety check. The resource adapter must still restrict this credential to
the exact `openrouter/free` identifier, and balance monitoring remains required. OpenRouter may expire credits after
inactivity; its current support guidance says an inference request refreshes account activity before a scheduled
expiration.

### Cerebras

- The API key authenticates successfully.
- The models endpoint listed `gpt-oss-120b` and `qwen-3.8-27b`.
- A chat-completions request to `gpt-oss-120b` returned HTTP 402.
- The response type was `payment_required_error`, with `payment_required` as its code and a message directing the user to
  the billing tab.
- Replacing the API key did not change the result.
- A request to the other listed model, `qwen-3.8-27b`, returned the same payment-required response, indicating an
  account-level restriction rather than a model-specific one.

The public catalog describes free-trial and paid tiers and labels different context lengths as "free / paid," but the
authenticated project catalog offers both current models at explicit per-token prices. It also describes Qwen 3.8 27B as
available through PayGo. The project account has no usable free allocation.

Cerebras is therefore excluded as a current zero-cost source. Do not add paid capacity merely to make the probe succeed;
reconsider it only if a future free offer appears.

### Groq

- The API key authenticates successfully.
- The models endpoint returned several active text models, including `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and
  `qwen/qwen3.8-27b`.
- A chat-completions request to `openai/gpt-oss-120b` returned HTTP 200 and the requested `probe-ok` answer.
- The request used 77 prompt tokens, 45 completion tokens, and 122 tokens in total.
- The response headers reported a request limit of 1,000 with 999 remaining.
- The response headers reported a token limit of 8,000 with 7,859 remaining.
- Reset hints were present for both requests and tokens.

Groq is the second verified external source. Its quota is independent of OpenRouter, its API is OpenAI-compatible, and its
headers provide useful direct evidence for early resource-state management. The exact periods represented by the
reported limits should be obtained from account documentation or longer observation rather than inferred from one
response.

### Google Gemini Developer API

- The dedicated project's API key authenticates successfully.
- The project has no billing account linked, so it cannot advance from the free tier into paid API use.
- The models endpoint returned multiple Gemini and Gemma models supporting `generateContent`.
- Despite appearing in that model list, `gemini-2.5-flash` rejected inference with HTTP 404 and reported that it is no
  longer available to new users. The error recommended `gemini-3.6-flash` instead.
- A `gemini-3.6-flash` request returned HTTP 200 and the requested `probe-ok` answer.
- The successful request used 7 prompt tokens, 3 answer tokens, and 69 reasoning tokens, for 79 tokens in total.
- The response identified the service tier as `standard`; it did not expose quota-limit or remaining-quota headers.
- Google's current pricing page lists standard input and output for `gemini-3.6-flash` as free of charge on the free
  tier.

Gemini is the third verified independent external source. The disagreement between model discovery and actual inference
availability is an important resource-loop case: a catalog entry is only a candidate observation, not proof that a model
is usable. Active rate limits must be read from AI Studio or learned through use because they are project-specific.
