# How to make Denarai better — start here

**You are a coding agent handed this repo. This file is the loop: read the logs of
what the live agent actually did, find where it fell short, fix it, deploy, verify.**
Do this whenever the ask is "make it smarter" / "why did it say that?" / "it couldn't
do X".

Production runs on **zkllmapi** (`ssh zkllmapi`, an AWS box; `h.atg.link`), NOT on a
laptop. Everything below assumes that box.

---

## 1. Read what actually happened

Two sources, both on the box. **`turns.jsonl` is the what; the session transcripts are
the how** — you usually need both.

### a. `~/clawd-talk-to-your-wallet/bridge/turns.jsonl` — every turn, every user

One JSON record per turn: `ts, wallet, message, context, raw_reply, response,
contract` (did it emit valid JSON?), `duration_s`, `engine`. This is also the
**training corpus** the owner wants to fine-tune on. It is gitignored — it lives only
on the box, so pull it down to analyze:

```bash
scp zkllmapi:'~/clawd-talk-to-your-wallet/bridge/turns.jsonl' /tmp/
```

Triage query — the turns most likely to hide a defect:

```python
import json
for l in open("/tmp/turns.jsonl"):
    d = json.loads(l); r = d.get("response") or {}
    msg = (r.get("message") or "")
    bad = (not d["contract"]) or d["duration_s"] > 60 or any(
        p in msg.lower() for p in ("i can't", "cannot", "sorry", "unable", "don't have"))
    if bad: print(d["ts"], d["duration_s"], repr(d["message"][:80]), "→", repr(msg[:120]))
```

### b. Session transcripts — the agent's tool calls and reasoning

Each wallet's conversation is a resumed `claude -p` session. Map wallet → session id,
then read the transcript to see **every tool call, its arguments, and its result**:

```bash
ssh zkllmapi 'cat ~/clawd-talk-to-your-wallet/bridge/.memory/wallet_<lowercased-address>.session'
scp zkllmapi:'~/.claude/projects/-home-ubuntu-clawd-talk-to-your-wallet-bridge-brain/<session-id>.jsonl' /tmp/
```

Walk it for `tool_use` / `tool_result` / assistant `text` blocks. This is where you see
*why* it answered as it did — which tool it reached for, what error came back, and
what it concluded from that error.

---

## 2. Classify the failure — the fix differs

| Symptom in the logs | Root cause | Fix |
|---|---|---|
| Said "I can't" but never called the relevant tool | It didn't know/remember the tool | Sharpen `brain/CLAUDE.md` — tool description + a MANDATORY WORKFLOW rule |
| Called the right tool, got an error, gave up | Error was a dead end, not a lead | Make the tool return a **diagnosis** (what rejected it, what to do next), and add a persona rule to investigate |
| Tool returned wrong/misleading data | Tool bug | Fix `brain/tools/wallet.mjs`, prove it with a real on-chain test |
| Right answer, wrong shape (`contract: false`) | Output-contract drift | Tighten the RESPONSE FORMAT section of the persona |
| Correct but slow (`duration_s` high) | Serial tool calls | Parallelize inside the tool, or tell the persona to batch calls |

**The meta-lesson from the first real investigation** (see below): an agent that
accepts a tool error as a verdict is the most common and most fixable defect. Tools
should hand back *leads*, and the persona should require chasing them.

---

## 3. Worked example — the FWA case (read this, it's the template)

A user bet the agent it couldn't buy a token called FWA. Logs showed the agent:
1. found the liquidity (a Uniswap V4 pool) ✅
2. tried LI.FI, got "no quote", concluded "I can't", told the user to go to the Uniswap app ❌
3. later claimed it had no V4 tool — **when it did** ❌
4. once it used the V4 tool, hit an error and asked the *user* to supply the pool's
   fee/tickSpacing/hooks — data that is public on-chain ❌

Fixes that followed, in order of leverage:
- **Pool discovery from `Initialize` event logs** — never ask a user for on-chain facts.
- **Generic research primitives** (`ethCall`, `getLogs`, `getCode`, `getContractSource`)
  so any protocol can be understood without a bespoke tool.
- **`rejectedBy` diagnosis** — a failed swap now traces itself and names the contract
  that rejected it, with a `nextStep`.
- **Persona rule 14 + "BEFORE YOU SAY YOU CAN'T"** — investigate, then answer.

And the actual answer, found by reading the hook's verified source and calling one
getter: `externalBuysEnabled() == false` — that token's hook **blocks all external
buys**, so nobody can buy it on-chain; selling works (and the tool builds it). That is
the standard to aim for: *a precise on-chain reason beats an apology.*

---

## 4. Change it

- **Persona / knowledge** → `bridge/brain/CLAUDE.md` (system prompt: tools, workflows,
  response contract). Cheapest, highest-leverage fixes live here.
- **Capability** → `bridge/brain/tools/wallet.mjs` (one CLI, one function per tool;
  add the tool AND describe it in CLAUDE.md — the description is the registration).
- **Plumbing** → `bridge/server.py` (HTTP adapter, headroom gate, turn logging).

Local test loop (no deploy, real APIs — keys come from `packages/nextjs/.env.local`):

```bash
set -a; source packages/nextjs/.env.local; set +a
node bridge/brain/tools/wallet.mjs <toolName> '<json-args>'
```

**Anything that builds calldata must be proven by simulation before you ship it** —
`simulateAssetChanges` on the generated transaction, checking the asset directions are
what a user would expect. Never ship transaction-building code on "it compiles".

---

## 5. Deploy + verify

```bash
git add bridge/ && git commit && git push            # scan the diff for secrets first
ssh zkllmapi 'cd ~/clawd-talk-to-your-wallet && git pull \
  && (cd bridge/brain/tools && npm install) \
  && sudo systemctl restart denarai-bridge'
curl -s https://agent.denar.ai/health                 # wouldServe + headroom
```

Then re-run the failing case end-to-end and confirm the fix in `journalctl -u
denarai-bridge -f`. Secrets live in `bridge/.env` on the box (never in git); the
Vercel route authenticates with `X-Bridge-Secret`.

If the subscription is out of headroom the bridge answers 503 and Vercel silently
falls back to the Bankr gateway — so a broken or stopped bridge degrades, it doesn't
outage. `engine` in every response tells you which one served.

---

## 6. The self-research loop (it runs itself)

The agent is wired to grow its own capability. You mostly **review** this rather than
drive it:

```
live agent can't do something
   └→ logMiss  →  bridge/misses.jsonl  (local queue)
                        │
        researcher (cron 05:37 daily, or run it by hand)
        bridge/researcher/run.py — a second `claude -p` agent, persona in
        bridge/researcher/CLAUDE.md, reads the miss + the real turns that hit it,
        researches docs + on-chain (using the live agent's own tools), then:
             ├→ writes brain/skills/<topic>/SKILL.md   → LIVE IMMEDIATELY
             │    (the agent reads skills from disk via listSkills/readSkill;
             │     untracked files don't block deploy pulls)
             └→ code changes → bridge/research-patches/*.patch, tree restored clean
                  (transaction-building code gets human review; it is NOT live)
```

Run it yourself:

```bash
ssh zkllmapi 'cd ~/clawd-talk-to-your-wallet && python3 bridge/researcher/run.py --dry-run'
ssh zkllmapi 'cd ~/clawd-talk-to-your-wallet && python3 bridge/researcher/run.py --gap "describe the gap"'
ssh zkllmapi 'cd ~/clawd-talk-to-your-wallet && python3 bridge/researcher/run.py --harvest'   # what's pending
```

**Your job as a coding agent: harvest.** New skills live only on the box until someone
commits them; patches need review. `--harvest` lists both. Read
`bridge/research-log.jsonl` for what each run concluded. Review a patch as you would a
PR — especially that any calldata path is simulated — then apply, commit, push, deploy.

The box has **no git push credentials** (deliberately: nothing autonomous pushes to
main). That's why skills land on disk and code lands as patches.

## 7. Operations

Installed on the box via cron:

| Job | Schedule | What |
|---|---|---|
| `bridge/ops/healthcheck.sh` | every 10 min | alerts if the bridge is down, refusing for lack of subscription headroom, or the box's `claude` login died. Set `ALERT_WEBHOOK` in `bridge/.env` for push alerts; always appends to `bridge/ops-alerts.log`. |
| `bridge/ops/rotate-turns.sh` | 04:17 daily | daily compressed snapshot + size rotation of `turns.jsonl` into `bridge/turns-archive/` (the corpus exists only on this box) |
| `bridge/researcher/run.py` | 05:37 daily | processes queued misses (see above) |

Security boundary worth knowing before you touch it: the live agent's Bash is limited
to **one** `node tools/wallet.mjs …` call by `brain/hooks/bash_guard.py` (a PreToolUse
hook), because `--allowedTools` only prefix-matches and `; cat .env` defeated it —
verified. Read/Glob/Grep are disallowed, which is why the skills corpus is exposed as
`listSkills`/`readSkill` tools rather than file reads. Don't "simplify" that away.

## 8. Known gaps / next

- **Etherscan ABI fallback** — `getContractSource` uses Blockscout only; unverified
  contracts remain opaque.
- **Nothing mines `turns.jsonl` for quality**, only misses. A nightly pass that finds
  turns which *succeeded badly* (wrong answer, `contract: false`) and queues them as
  gaps would close the loop the rest of the way.
- **No eval set.** There's no regression suite of "questions that used to be answered
  wrong"; each fix is verified once, by hand.
