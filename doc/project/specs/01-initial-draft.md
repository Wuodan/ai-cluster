# ai-cluster

(working title)

## Project idea

I use coding agents and have written software to support coding agents. And by now there are capable LLMs that one can
use for free. So I want to take it a step further and create an autonomous AI coding engine.

### Rough ideas

#### LLMs

Not all of those may be realistic, these are just ideas floating around in my head.

- Capable of running autonomous for medium or long periods of time (overnight, days, weeks).
- Self-deciding for free LLMs – these may change over time. Uses LLMs for the research and decision/rating/grouping of
  LLMs.
- Failsafe backbone when all free LLMs are unavailable (limit exhausted, LLMs no longer free, etc.) of code and a small
  local LLM, which can at least find a new free LLM to kick off the "find LLMs and classify them" process.
- Capable of working alone - deciding what to do next with "free" time.

So in other words, it shall normally use the most powerful LLMs it can use for free. It shall be able to react when
preferred LLMs are unavailable – chose another one from its register. It must periodically start an analysis to
update the register. And if all things go wrong, it must have a fallback to research for LLMs for the register.

#### Coding agent

I'm used to having an interactive session with LLMs. I'm not sure how this shall work here, though. Basically, I imagine a
decision-making and planning part which delegates work. At some point there likely should be existing coding agent
software in the loop, potentially several (but small list as my code must interact with them, and we don't want to use
many different APIs). Existing coding agents may be useful to reduce the code we write – those already bring a lot of
functionality that we might want.
