# Capability evaluation observations

This document records sanitized evaluation observations. Evaluation inputs are deliberately public, synthetic prompts;
outputs and provider-resolved model identities may be retained. Credentials, request identifiers, and account identifiers
must not be recorded.

## 2026-09-21

The initial deterministic suite tested:

- exact text generation;
- exact instruction following;
- a fixed two-field JSON object with no surrounding prose or Markdown.

### OpenRouter free route

- Text generation passed through `nex-agi/nex-n2.5-mini:free`.
- Exact instruction following passed through `inclusionai/ling-3.0-flash-sante:free`.
- Structured JSON failed through `inclusionai/ling-3.0-flash-fin:free`; the returned text was not valid JSON.

The different resolved models demonstrate that `openrouter/free` must be evaluated as a changing access path. A success
from one routed model does not establish a permanent capability of the next selection. Route evidence needs repeated,
time-aware evaluation if it is later used for higher-confidence work.

### Groq

`openai/gpt-oss-120b` passed all three deterministic tests. A subsequent inference requiring structured JSON skipped the
OpenRouter route and successfully selected Groq.

### Refusal when evidence is absent

Neither resource had observed tool-use evidence. A request requiring tool use returned `no_suitable_source` without
calling either provider. This is the intended behavior: availability and advertised capability do not substitute for
adequate evidence.
