# denarai bridge — claude-p-agent engine for talk-to-your-wallet

Runs denar.ai chat turns as a real Claude Code agent (`claude -p`, Opus,
**subscription-billed**) instead of the per-token Bankr gateway. The Vercel
`/api/intent` route tries this bridge first and falls back to Bankr when the
bridge is down, saturated, or the subscription lacks headroom — so shipping or
stopping the bridge is always safe.

```
browser → Vercel /api/intent ──(CV charge, auth, context)──► bridge /intent
                              │                                 │ claude -p --model opus
                              │  503 / timeout / error          │ brain/CLAUDE.md persona
                              ▼                                 │ brain/tools/wallet.mjs
                         Bankr gateway (fallback)               ▼
                                                       {type: chat|transaction|…, engine:"claude-p"}
```

## Layout

- `server.py` — stdlib HTTP service (default port **8790**). `POST /intent`
  (auth: `X-Bridge-Secret`), `GET /health`.
- `brain/CLAUDE.md` — the Denarai persona (system prompt ported from route.ts,
  plus JSON-only output + prompt-injection rules).
- `brain/tools/wallet.mjs` — all 19 wallet tools as one Node CLI
  (`node tools/wallet.mjs <tool> '<json>'`), ported 1:1 from route.ts.
  Resolves `viem` from `packages/nextjs/node_modules` — run `yarn install` first.
- `.bridge-secret` — auto-generated shared secret (gitignored). Must match
  `DENARAI_BRIDGE_SECRET` on the Vercel side.
- `.memory/` — per-wallet conversation keys (`wallet:<address>` → claude
  session id). The agent *remembers each wallet* across requests; delete a
  file to reset that wallet's conversation.

## Run

```bash
python3 bridge/server.py
```

Needs: `claude` CLI signed into a subscription, the sibling
`claude-p-agent` checkout (`CLAUDE_P_AGENT_HOME` to override), and tool API
keys — loaded from `bridge/.env` or `packages/nextjs/.env.local`
(ZERION_API_KEY, LIFI_API_KEY, NEXT_PUBLIC_ALCHEMY_API_KEY, gist vars).

Knobs (env): `BRIDGE_PORT` 8790 · `BRIDGE_MODEL` opus · `BRIDGE_SUB_MAX_PCT` 90
(refuse above this % of the best plan's usage) · `BRIDGE_MAX_CONCURRENT` 4 ·
`BRIDGE_TURN_TIMEOUT` 240s.

Subscription routing: claude-p-agent's **router module**
(`modules/router/env` in `CLAUDE_P_AGENT_HOME`) picks the plan with the most
headroom per turn (all `~/.clawd-accounts/*` logins + default `~/.claude`);
the bridge's headroom gate reads the same module's query surface
(`env --status` → `best.pct`, `endpoint.retry_after`), so "would the router
find a usable plan?" and "do we accept the request?" always agree.

## Vercel side

Env vars on the Next.js app:

- `DENARAI_BRIDGE_URL` — e.g. `http://127.0.0.1:8790` locally, or the tunnel
  URL in prod. Unset = pure Bankr (today's behavior).
- `DENARAI_BRIDGE_SECRET` — contents of `.bridge-secret`.
- `DENARAI_BRIDGE_TIMEOUT_MS` — default 240000.
- `CV_DEV_BYPASS=1` — dev only: skip the 25k CV charge (hard-disabled when
  `NODE_ENV=production`).

Responses carry `engine: "claude-p" | "bankr"` so you can watch the split.
