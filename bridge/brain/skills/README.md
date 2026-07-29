# skills/ — Denarai's learned knowledge

Each subdirectory is one topic with a `SKILL.md`. The live agent is told (in
`../CLAUDE.md`) to consult this directory **before** concluding it can't do
something. Files here are written either by a human or by the **researcher**
agent (`bridge/researcher/`), which turns a logged miss into permanent knowledge.

## Format

```markdown
---
name: <kebab-case-topic>
description: <one line — this is what the live agent matches against>
verified: <YYYY-MM-DD, and HOW it was verified>
---

## What this is
## How to do it with our tools   ← concrete wallet.mjs invocations
## Gotchas / failure modes       ← what reverts, and why
## Addresses / constants         ← chain-keyed, with a source link
```

Rules that keep this corpus trustworthy:

- **Verified facts only.** Anything on-chain must be confirmed by an actual call
  (`ethCall`/`getLogs`/`getContractSource`) or a simulation, and the entry says so.
- **Cite the source** for addresses and protocol claims (docs URL or the on-chain
  read that produced them).
- **Prefer our tool names.** A skill that says "call `buildUniV4Swap` with X" is
  actionable; prose about a protocol is not.
- **Correct, don't append.** If a skill is wrong, fix it — a corpus of
  contradictions is worse than no corpus.
