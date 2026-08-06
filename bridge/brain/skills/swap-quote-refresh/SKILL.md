---
name: swap-quote-refresh
description: The swap card already has a live price refresh (↻ button + auto-requote) and can re-price to a new amount — how it works, and how to answer users who ask for a refresh button, editable amounts, or complain a quote is stale/slow
verified: 2026-08-05 — read TransactionCard.tsx + /api/requote/route.ts + server.py; ran buildUniV4Swap ETH→USDC on mainnet, replayed its requote descriptor (fresh calldata, verified sim), and re-priced by overriding amountIn (0.01→0.02 ETH → 18.72→37.43 USDC, verified sim)
---

## What this is

**The swap card you emit already refreshes its own price. Do not tell a user "I
can't add a refresh button" or "that's the frontend team's job" — it's already
there.** This is the fix for a real miss where a user asked for "a lil refresh
button… maybe something that lets me edit the values" and the agent deflected as
out-of-scope.

How it works, end to end:
- Every swap tool that supports it returns a **`requote`** descriptor:
  `{ tool, args }` — a deterministic re-build recipe with the pool **pinned**
  (fee/tickSpacing/hooks) and the `amountIn` baked in.
- You copy that `requote` **verbatim** into your response (`transaction.requote`
  for a single tx; top-level `requote` next to `steps` for a multistep). This is
  already required by the response format — this skill explains *why it matters*.
- The chat card (`TransactionCard`) then, on its own:
  - shows a **↻ refresh button** and a "Live quote · updated Ns ago" line,
  - **auto-requotes every 30s** while the card sits unsigned (stops when the tab
    is hidden, a tx is in flight, or the card is >15 min old),
  - each refresh POSTs the descriptor to `/api/requote`, which re-runs that one
    pinned tool (**~2s, no pool discovery, no agent turn, no CV charge**) and
    swaps in fresh calldata + a fresh onchain simulation.

So the "refresh button" the user is asking for **ships automatically** whenever
your transaction carries `requote`. If it's missing, it's because you dropped the
field or the swap went through a tool that doesn't emit one (see Gotchas).

## How to answer the user

- **"I need a refresh button / the price moved":** for a Uniswap-V4 swap card,
  tell them it's already there — the card shows a ↻ button and auto-updates the
  price every ~30s; they can tap ↻ any time before signing. Don't apologize for a
  missing feature that exists.
- **"let me edit the values" / "change the amount":** the same live-quote engine
  re-prices to any amount — the `requote.args` carries `amountIn`, so a new amount
  is a one-call re-build (proven below). Today the fastest path for the user is to
  just say the new size ("make it 0.02 ETH" / "buy $200 instead") and you rebuild
  from a fresh quote. An inline editable field is a small frontend add on top of
  the exact same `/api/requote` path — not a new capability. Be honest about which
  exists today, but don't frame re-pricing as impossible.
- **"why did that take so long?":** be straight. The **first** V4 build is a few
  sequential onchain stages — discover every pool for the pair from PoolManager
  `Initialize` logs, then quote, then a mandatory simulation — and only the stages
  are sequential (within each, the tool already fans out in parallel). That's the
  price of trading a hooked pool safely with no aggregator. **Refreshes are fast
  (~2s)** precisely because the pool is already pinned. So: first build slow,
  re-prices cheap.
- **Never** claim you "filed a ticket" or "logged a bug to the frontend team." You
  can only `logMiss` to an internal note. Prefer telling the user what already
  works over logging a non-gap.

## How to do it with our tools (and the proof)

The requote descriptor is exactly the args you'd pass to rebuild the swap. A
refresh is "run the same tool with those args again"; an edit is "run it again with
a changed `amountIn`". Verified on mainnet 2026-08-05:

```bash
# 1) Build — ETH→USDC V4 swap. Returns a `requote` + a verified `simulation`.
node tools/wallet.mjs buildUniV4Swap '{"tokenIn":"ETH","tokenOut":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","amountIn":"10000000000000000","chainId":1,"fromAddress":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}'
#   → simulation: out 0.01 ETH → in 18.71669 USDC ✓
#   → requote.args pins fee 100 / tickSpacing 1 / hooks 0x0 and amountIn 1e16

# 2) Refresh — replay requote.args verbatim (what the ↻ button / 30s timer does).
#   Same pool, freshly re-quoted, fresh calldata (the encoded deadline advances),
#   verified sim. ~2s because discovery is skipped.
node tools/wallet.mjs buildUniV4Swap '{"tokenIn":"0x0000000000000000000000000000000000000000","tokenOut":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","amountIn":"10000000000000000","chainId":1,"fromAddress":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","slippagePct":1,"fee":100,"tickSpacing":1,"hooks":"0x0000000000000000000000000000000000000000"}'

# 3) Edit the amount — same descriptor, amountIn 1e16 → 2e16 (0.01 → 0.02 ETH).
#   Re-prices to out 0.02 ETH → in 37.433313 USDC, verified sim, new requote. This
#   is the whole of an "editable amount" — override amountIn, nothing else.
node tools/wallet.mjs buildUniV4Swap '{"tokenIn":"0x0000000000000000000000000000000000000000","tokenOut":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","amountIn":"20000000000000000","chainId":1,"fromAddress":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","slippagePct":1,"fee":100,"tickSpacing":1,"hooks":"0x0000000000000000000000000000000000000000"}'
```

## Gotchas / failure modes

- **Only `buildUniV4Swap` swaps get the ↻ button today.** The requote endpoint
  whitelists exactly that tool. `buildRoute` (LI.FI — the common ETH↔USDC and
  cross-chain swaps) returns **no** `requote`, so those cards have no refresh
  button and don't auto-update. So if the user was frustrated by a *plain* swap
  going stale, that's a genuine current gap — see below. Don't over-promise the ↻
  button on a LI.FI swap.
- **Multistep cards don't refresh.** An ERC-20-in V4 swap (Approve → Permit2 →
  Swap) and any approve+swap flow render as a `multistep_transaction`, which has no
  requote UI — only the single-tx card (native-ETH-in swaps) shows ↻. Its
  `requote` is still worth including (a reload/rebuild uses it), but no live timer.
- **Drop the field and the button vanishes.** If you summarize, edit, or omit
  `requote`, the card silently loses its refresh. Copy it byte-for-byte.
- The card keeps its identity (description, chain, "You send"/"You receive"
  layout) across a refresh; only calldata/value/amounts/simulation change.

## Reviewer note — extend the ↻ button to LI.FI swaps (out of researcher scope)

To give ordinary `buildRoute` swaps the same live refresh (this is what the user
who logged the miss actually had — USDC↔ETH, not a V4 token), three coordinated
changes are needed, **outside the researcher's allowed files** (`server.py` and
`packages/` are off-limits here), so capturing them for a human:
1. `bridge/brain/tools/wallet.mjs` `buildRoute`: on the single-tx path, return
   `requote: { tool: "buildRoute", args: {fromToken,toToken,amountIn,fromChainId,toChainId,fromAddress} }`
   plus a normalized `quote` (`amountOut`/`amountOutMinimum` from `estimate`) and a
   `simulation` (call `simulateAssetChanges` when `fromAddress` is known) so the
   card has fresh amounts to show — mirroring the V4 ETH-input path.
2. `bridge/server.py`: add `"buildRoute"` to `REQUOTE_TOOLS`.
3. `packages/nextjs/app/api/requote/route.ts`: allow `requote.tool === "buildRoute"`
   (it currently hardcodes `buildUniV4Swap`).
Only the single-tx path is refreshable — token→ETH LI.FI swaps that need an approval
render as a multistep and are out of scope for the ↻ card either way.
An inline editable "You send" field is then a pure `TransactionCard` change:
override `live.requote.args.amountIn` and re-POST to `/api/requote` — the same call
proven in step 3 above.
