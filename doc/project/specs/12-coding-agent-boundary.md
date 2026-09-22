# Proposed coding-agent boundary

This document records the current working design for connecting the resource layer to software-development work. It is
a proposal for review, not a claim that the work loop or a coding-agent integration has been implemented. Open questions
and later owner feedback should revise this document before implementation fixes the boundary in code.

## Decision under discussion

The project should use an existing coding agent rather than reproduce repository discovery, context assembly, file
editing, command execution, and the inner test-and-repair loop. The project's own deterministic supervisor should remain
the central authority. It should control a coding agent through the Agent Client Protocol (ACP), while the coding agent
should obtain inference only through the resource service's zero-cost model gateway.

The small local model is a resource available through that gateway. It may later assist with bounded classification,
summarization, or planning, but it is not the central supervisor and must not be responsible for keeping the system
alive. Recovery must continue to work when every LLM is unavailable or has produced an unusable result.

The intended boundaries are:

```text
                       deterministic work supervisor
                    task state, policy, recovery, review
                              |              |
                         ACP  |              | status/control
                              v              v
                         coding agent   resource service
                           (initial       availability, quota,
                        OpenCode candidate) selection, zero cost
                              |              ^
                              | model API    |
                              v              |
                       local model gateway --+
                              |
                 +------------+------------+
                 v            v            v
               Groq       OpenRouter    Gemini/local
```

ACP and the model API solve different problems. ACP is the control interface between the supervisor and a coding agent.
An OpenAI-compatible local API is the provisional inference interface between the coding agent and the resource layer.

## Responsibilities

### Deterministic work supervisor

The project-owned supervisor is the durable central process. Initially it should be a persisted state machine rather
than an LLM agent. It is responsible for:

- accepting and persisting tasks;
- creating an isolated worktree or other contained workspace;
- starting, monitoring, stopping, and restarting an ACP agent process;
- creating, resuming, or replacing agent sessions;
- supplying the task and relevant durable context;
- mediating permission requests according to project policy;
- enforcing time, attempt, concurrency, and authority bounds;
- observing progress and correlating agent activity with resource-service attempts;
- independently running required validation;
- pausing work when no suitable zero-cost resource is available;
- deciding when to retry, request human input, retain a candidate, or abandon it;
- preserving enough state to continue after its own restart.

A stronger LLM may later propose plans or subtasks. Such a model remains an adviser or worker: it does not become the
liveness mechanism or final authority merely because it supplied a plan.

### Coding agent

The coding agent owns the inner software-development loop for one bounded assignment. It is responsible for:

- exploring the repository and choosing relevant context;
- deciding which files to inspect or edit;
- invoking its coding tools and applying edits;
- running commands and interpreting their immediate results;
- maintaining its conversation and tool history;
- managing or compacting its model context;
- iterating on compiler, lint, and test failures;
- optionally using its own subagents within the bounded assignment.

The coding agent is not responsible for global resource accounting, zero-cost enforcement, the durable project task
queue, trusted-code promotion, or long-term retry scheduling. Its own subagent mechanism does not replace the project
supervisor.

### Resource service and model gateway

The resource service remains the sole authority for inference-resource use. A local compatibility gateway should let a
coding agent submit the multi-message and tool-capable requests it needs without receiving provider credentials. The
resource layer is responsible for:

- enforcing the explicit zero-cost allowlist;
- keeping provider credentials outside the coding-agent process;
- selecting only resources with adequate observed capabilities;
- observing provider exhaustion, cooldown, failure, and recovery;
- preserving provider-resolved model identity and request evidence;
- retrying or switching only when doing so is safe for the request semantics;
- returning an explicit unavailable or unsuitable result instead of using a paid fallback.

The gateway may expose virtual models such as `coding-tools`, `coding-text`, or `large-context`. These names describe
requirements rather than providers. Their exact set is unresolved and should be introduced only when experiments show
that it is needed.

### Independent validation

The coding agent may run tests as part of its work, but the supervisor must repeat the required deterministic checks
outside the agent's own judgment. Passing an agent-reported test is evidence, not automatic permission to promote a
change into the trusted repository.

## ACP as the agent-control interface

The project should act as an ACP client and launch or connect to an ACP-compatible coding agent. ACP version 1 currently
provides the relevant baseline: capability negotiation, session creation and resumption, prompts, streaming updates,
tool and permission events, usage updates, cancellation, and optional mode and model configuration.

This is preferable to driving a terminal UI and parsing human-oriented output. It also reduces coupling to a particular
agent implementation. ACP compatibility alone does not make agents behaviorally interchangeable, so each agent still
requires qualification with the resource pool and the project's containment policy.

ACP does not define the project's task queue, provider quota states, zero-cost routing, context-compaction policy,
workspace containment, acceptance tests, or trusted promotion. Those remain project-owned concerns. Small
agent-specific adapters may also be required for capabilities that ACP does not standardize, such as explicitly asking
an agent to compact a session.

Protocol references:

- [ACP introduction](https://agentclientprotocol.com/get-started/introduction)
- [ACP version 1 prompt lifecycle](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP version 1 session configuration](https://agentclientprotocol.com/protocol/v1/session-config-options)
- [ACP agent registry](https://agentclientprotocol.com/get-started/registry)

## Failure ownership

Different token and capacity failures belong to different layers.

### Provider allowance or rate limit

The resource service records exhaustion or cooldown and may select another qualified, compatible zero-cost resource. If
none exists, it returns an explicit unavailable result. The supervisor then pauses the task until the persisted retry
time or another useful event; it does not require an LLM to make that decision.

### Model context limit

The coding agent owns the conversation and is therefore best placed to compact it. The supervisor should observe usage
and session events, cancel a stuck turn, and resume, fork, or replace a session when the agent cannot recover. A durable
checkpoint can combine the task, current workspace state, validation results, and an agent-produced summary, but the
workspace and test evidence remain authoritative if the summary is incomplete.

### Output limit or interrupted turn

The agent may continue an incomplete inner loop. If it stops incorrectly, the supervisor decides whether a bounded
continuation is safe based on the ACP result, recorded resource attempt, workspace changes, and validation state.

### Agent or supervisor process failure

The supervisor should restart the agent and resume from persisted session or workspace state. The supervisor's own task
state must also survive restart. Neither recovery path may depend on an LLM being available.

## Model continuity and failover

Changing physical models on every request is unsafe even when all candidates implement a nominally compatible API.
Models may differ in tool-call behavior, supported roles, reasoning or continuation metadata, context limits, and edit
reliability.

The provisional design should therefore pin or lease a qualified physical resource for a suitable boundary, such as an
agent session or prompt turn. Transparent retry is acceptable before a visible result only when the alternative is
known to be compatible and the request does not rely on provider-specific continuation state. Otherwise the gateway
should expose the failure and let the supervisor coordinate a session-level recovery. The precise lease boundary needs
an experiment before it becomes an interface commitment.

For a rotating route such as `openrouter/free`, coding evidence must retain the provider-resolved model. Route-level
success must not be treated as stable evidence that every subsequently selected underlying model works with the agent.

## Initial agent candidate

OpenCode is the current first candidate because it combines:

- native ACP version 1 operation through `opencode acp`;
- session create, resume, fork, cancellation, and streamed activity through ACP;
- custom OpenAI-compatible provider configuration;
- local-model support;
- a coding-tool loop that can remain behind the ACP boundary.

The intended use is its machine interface, not automation of its interactive terminal UI. The supervisor would start
OpenCode as an ACP subprocess in a controlled environment and point its only configured model provider at the local
resource gateway.

OpenCode references:

- [OpenCode ACP interface](https://opencode.ai/v2/docs/cli/acp/)
- [OpenCode provider configuration](https://opencode.ai/docs/providers)

OpenCode is a candidate, not a permanent dependency. Other ACP agents can later be tested through the same supervisor
boundary. Aider remains potentially useful as a comparative coding harness, but without a suitable native ACP boundary
it is not the preferred first supervisor integration.

## Credential and containment requirements

The coding-agent environment must not contain the owner's Codex, ChatGPT, or other personal paid credentials. It must
also not inherit globally stored coding-agent provider credentials. It should receive only the local gateway address and
any non-secret local authentication token used to restrict that gateway.

The eventual execution environment should provide:

- no direct provider API keys;
- restricted outbound network access appropriate to the task;
- an isolated worktree or disposable repository copy;
- explicit ACP permission decisions;
- controlled agent configuration that cannot silently enable another provider;
- no authority to merge or promote changes into the trusted line.

Provider secrets remain mounted only into the trusted resource service. Containment must make bypassing the gateway a
structural boundary rather than a prompt instruction.

## Provisional first integration sequence

This architecture does not change the current Milestone 6 completion boundary. After the early resource service is
usable, the smallest informative coding integration would be:

1. implement the multi-message, tool-capable local gateway surface required by the selected agent;
2. implement a minimal ACP client that starts OpenCode and persists session/task identity;
3. run bounded coding tasks only in disposable repositories or worktrees;
4. record the agent version, virtual requirement, selected and resolved models, attempts, edits, commands, and results;
5. score deterministic outcomes such as patch validity, compilation, tests, regressions, and task completion;
6. exercise provider unavailability, agent restart, cancellation, and context-pressure recovery with controlled evidence;
7. use the observations to decide which responsibilities and interfaces need to grow.

Online research and published coding benchmarks may identify models worth testing, but they do not replace observed
results from the selected agent and the project's own task corpus. The local model may cheaply summarize this evidence;
it must not be the sole judge of coding quality.

## Questions deliberately left open

- Which exact ACP version and SDK revision should the first implementation pin?
- Which OpenCode capabilities behave reliably with the currently available free models?
- Does the first gateway need both Chat Completions and Responses-style APIs, or only one narrow surface?
- Should a physical resource be leased for a prompt turn, an ACP session, or another boundary?
- How should the gateway communicate typed exhaustion and incompatibility through an API expected by an existing agent?
- What context threshold should trigger a checkpoint, compaction, or session replacement?
- Which commands may the agent run without a permission round trip?
- What disposable-workspace and network containment are sufficient for the first experiment?
- Which small coding tasks provide useful evidence without creating excessive review work?
- When should a second ACP agent be tested to prove that the abstraction is genuinely portable?
