# Answers to initial questions by Codex

Other questions I now have:

1. Is the hard rule zero marginal monetary spend, while already-owned hardware, electricity, internet, and existing accounts are acceptable?
2. Are free trials requiring a new account legitimate sources, or do you want to exclude repeated sign-ups and anything resembling quota circumvention?
3. Should the engine use only accounts you explicitly configure, or may it autonomously register with providers?
4. Does a “model source” mean the combination of model, provider, account, and access method? The same model through OpenCode and OpenRouter could have completely different limits.
5. Must the system infer undocumented cooldowns empirically—for example, periodically probing OpenCode until its free capacity returns?
6. Should it optimize for maximum total useful tokens, or reserve stronger free sources for planning/review while giving routine work to weaker ones?
7. Can several free sources be used concurrently, or is the initial goal continuous sequential operation?
8. When free capacity exists but there is no assigned task, should it spend that capacity proactively—researching more sources, benchmarking them, improving its own adapters, or coding?
9. How small/local do you imagine the final fallback: something capable of browsing and modifying adapters, or merely something capable of directing deterministic discovery tools and judging their results?
10. Is respecting each provider’s stated terms an absolute constraint? I assume yes, but it affects which teaser offerings can safely be automated.

One more important question: is ai-cluster meant to describe a virtual cluster of fluctuating LLM capacity? If so, the name makes much more sense now: its “nodes” are ephemeral access opportunities, not machines or parallel coding agents.

1. yes
2. no repeated signups for now. I can create a few free accounts and an email account and let it use those.
3. if it can autonomously register with providers, why not?
4. Stupid question about implementation detail that atm does not matter nor help.
5. Maybe ... maybe not. Atm we don't know what's best.
6. It should likely classify models – likely there is one model doing triage and that should use models and tools best
   for a task.
7. that question right now is to far ahead imho.
8. well ... yes? that's part of triage and/or decision-making: how are time and resources best spent. and self-improving may sooner or later be thing. At least analysis of what was good and what was not in the past to at least make suggestions for self-improvement or outright doing that.
9. something that gets the job done (stupid question, how should I know that now?)
10. how should I know? I'm not going to write a criminal software but on the other hand abusing some terms for free accounts ... who cares. Normally those providers are set up so one can't easily cheat apart from hard hacking and that is surely beyond the reach of my small coding solution.