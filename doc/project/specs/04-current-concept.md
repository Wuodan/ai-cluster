# ai-cluster: current concept

`ai-cluster` is only a temporary working title chosen to create the repository. It is not intended to constrain the
project's identity or final name.

This document consolidates the current shared understanding of the project. It is not an implementation plan. Earlier
documents preserve the initial idea and the discussion that led here.

## Central premise

`ai-cluster` shall sustain useful autonomous work by finding, evaluating, and using capable LLM resources that have no
marginal monetary cost.

Individual free resources are expected to be temporary and unreliable. A good model may be available through a free
allowance for some time, become unavailable or exhausted, and become usable again later. Providers, models, limits,
interfaces, and offers will change. The system shall treat that churn as normal rather than depend on one permanently
available provider.

Coding is an intended use of the acquired capacity, but it is not the project's novel foundation. The first problem is
creating and maintaining the pool of usable free intelligence. The system cannot perform autonomous coding work until
that resource layer works in at least an early, usable form.

## Meaning of free

The hard constraint is zero marginal monetary spending by the system.

Existing hardware, electricity, internet access, and accounts supplied by the owner are acceptable. Free accounts,
promotional allowances, free tiers, aggregators, locally hosted models, and models bundled with tools such as coding
agents may all be potential resources.

A one-time owner-funded account deposit that remains unspent may also be acceptable as setup infrastructure. It does not
turn paid inference into an allowed resource: the system must be technically prevented from consuming the deposit.

Repeated sign-up schemes intended to multiply a provider's allowance are out of scope. Accounts and credentials are
supplied by the owner. Autonomous discovery and registration of additional provider accounts is not part of the current
development direction; it may be reconsidered only in the far future if sustained operation proves that the configured
resource pool is insufficient.

## Heterogeneous resources

A resource does not need to expose a conventional LLM API. Access may be available through:

- a provider API;
- an aggregator or router;
- a command-line coding agent or another user-facing tool;
- a temporary or promotional service;
- a small local model;
- another access mechanism discovered later.

The software may therefore need to operate existing tools rather than merely normalize HTTP APIs. It shall not depend
on a single provider, model, interface, or coding agent.

## Two cooperating loops

### Resource loop

The resource loop keeps usable intelligence available. It shall eventually be capable of:

1. accepting configured free resources and discovering models available through those configured accounts;
2. determining how they can be accessed;
3. testing their current availability and capabilities;
4. observing quality, failures, exhaustion, and recovery;
5. selecting suitable resources for particular kinds of decisions or work;
6. switching when a resource becomes unsuitable or unavailable;
7. retrying resources that may have recovered;
8. reporting when the known pool is no longer sufficient.

Not all of this must be present in the first implementation. In particular, the mechanisms for inferring limits,
cooldowns, and recovery are deliberately undecided.

### Work loop

The work loop decides how available intelligence should be spent. It may eventually:

- accept tasks from the owner;
- choose useful work without waiting for a task;
- plan and delegate software-development work;
- evaluate earlier work and routing decisions;
- identify weaknesses in `ai-cluster`;
- develop and test improvements to itself;
- perform other useful work inside its permitted environment.

The work loop depends on the resource loop. Consequently, resource setup and management come first in development.

## Persistent learning

Learning must produce durable, inspectable results rather than exist only in an LLM context or process memory. Possible
results include:

- a catalog of known resources and access mechanisms;
- observations of successes, failures, exhaustion, and recovery;
- capability evaluations and their supporting test results;
- records of which models or agents performed well on which kinds of work;
- decision records and outcome assessments;
- discovered availability patterns;
- new or repaired integrations;
- tested candidate changes to `ai-cluster`.

The exact storage model is an implementation decision. Operational knowledge should be able to evolve without requiring
a source-code change for every new observation.

## Local fallback

A small local LLM shall provide a fallback that is independent of external free offers. Approximately 1--4 GB of RAM
should be sufficient. It need not run continuously, and it need not be a strong coding model.

Its current purpose is to provide independently available, modest inference when external resources are unusable. It may
support low-complexity diagnosis or other bounded work, but it is not responsible for discovering or acquiring provider
accounts.

## Trusted system and autonomous laboratory

During early and mid-stage development, `ai-cluster` may develop itself but may not promote its own changes into the
trusted system.

The project therefore distinguishes self-development from self-promotion:

- A trusted line consists of the canonical repository and owner-approved running versions.
- An autonomous laboratory may clone or fork the repository, modify it, run candidate versions in containment, compare
  them, discard failures, and continue development from unreviewed candidates.
- Candidate versions may become parents of further experiments without first receiving human approval.
- The system may submit coherent, evidenced pull requests to the canonical repository.
- Only the owner may approve, merge, and promote changes to the trusted line during these phases.

This prevents human review from becoming a global execution barrier. A pending review blocks promotion of a candidate,
not continued contained experimentation.

The likely account arrangement is a separate GitHub identity that can write to its own fork but has no write permission
to the canonical repository.

## Initial authority boundary

The early system may:

- browse the internet and call explicitly configured free services;
- use designated accounts;
- persist observations and experimental results;
- write to its own fork and propose pull requests to `ai-cluster`;
- run arbitrary experiments inside its assigned containment.

It may not:

- spend money;
- merge or write into the canonical repository;
- replace the trusted running supervisor;
- contribute to unrelated projects;
- publish or communicate publicly as the owner;
- escape its assigned containment.

External contributions may be considered later, with suitable review and a clear independent identity. They are not an
early-stage activity.

## Human interaction and work in progress

LLMs may finish tasks in minutes, while human attention is intermittent. The system must therefore not model itself as a
single worker whose entire progress stops after every request for review.

A human-blocked item should block only its own promotion or decision path. The system may continue other useful work,
strengthen the evidence for a pending proposal, test alternatives, or continue contained experimentation.

At the same time, free inference must not be converted into unlimited review debt. The system should eventually:

- keep only a bounded number of active experimental lines;
- prefer work that reduces later human review effort;
- aggregate non-urgent questions and decisions;
- offer a small number of prioritized, coherent review packages;
- update or replace superseded proposals rather than accumulate them;
- stop speculative work when it is unlikely to add decision value.

More frequent owner interaction is expected during early development, when changes are larger and quality matters most.

## Useful work and waiting

Free inference capacity should generally not be wasted. Spare capacity may be used for productive exploration,
evaluation, research, validation, or self-improvement.

However, inference may have zero monetary cost while its output creates review debt, confusing state, security risk, and
maintenance work. Constant activity is therefore not itself a success criterion.

The system shall have an explicit state equivalent to **cannot currently do useful work**. It may wait when no available
action has positive expected value or when the available intelligence is not trustworthy enough for suitable work.

A tentative priority is:

1. valuable work with a clear path forward;
2. work that unblocks or strengthens pending proposals;
3. experiments that produce durable information;
4. bounded and reversible exploration;
5. waiting rather than creating noise.

## Initial development ordering

The first development phase shall focus on making the resource loop usable. Autonomous coding cannot be meaningfully
attempted without resources to perform it.

The initial proof should establish that heterogeneous zero-cost model access can be observed, classified, switched, and
reused sufficiently well to supply later agentic work. The workload used to prove this may initially be simpler than
autonomous software development.

Detailed milestones and an implementation plan will be written separately after this concept has been reviewed.

## Deliberately unresolved questions

The following questions should not be answered prematurely:

- Which initial free resources and access mechanisms should be supported?
- What deterministic software and which LLM should perform resource triage?
- How should quality and task suitability be evaluated?
- How should undocumented limits, exhaustion, cooldowns, and recovery be detected?
- How much concurrency is useful?
- What precise tasks should the initial fallback model perform?
- How should operational knowledge be represented and stored?
- What containment mechanism should separate trusted and experimental versions?
- How should useful work be valued when no owner-supplied task exists?
- When, if ever, may the system promote its own changes?
- When, if ever, may it interact with or contribute to external projects?
