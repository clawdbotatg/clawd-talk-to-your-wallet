---
name: uniswap-v4
description: Trading Uniswap V4 pools directly (including hooked pools LI.FI can't route), and diagnosing hook-gated swaps
verified: 2026-07-29 — pool discovery, quoting, and calldata all confirmed against mainnet; ETH→USDC swap simulated successfully; FWA hook gate confirmed by reading verified source + ethCall
---

## What this is

Uniswap V4 keeps every pool inside one **PoolManager** singleton, identified by a
`PoolKey{currency0, currency1, fee, tickSpacing, hooks}`. Aggregators (LI.FI
included) often **cannot route V4 pools**, especially hooked ones — so a token can
be genuinely liquid and still return "no quote". That is not a dead end.

Swaps execute through the **Universal Router** `execute(commands, inputs, deadline)`
with command `V4_SWAP (0x10)`, whose payload is `abi.encode(actions, params)` where
actions = `SWAP_EXACT_IN_SINGLE(0x06) SETTLE_ALL(0x0c) TAKE_ALL(0x0f)`.

## How to do it with our tools

`buildUniV4Swap` handles all of it — **never ask the user for pool parameters**:

```bash
# buy: ETH in → single transaction
node tools/wallet.mjs buildUniV4Swap '{"tokenIn":"ETH","tokenOut":"0x<token>","amountIn":"<wei>","chainId":1,"fromAddress":"0x<user>"}'
# sell: ERC-20 in → multistep (Approve → Permit2 → Swap), because the
# Universal Router pulls tokens through Permit2
node tools/wallet.mjs buildUniV4Swap '{"tokenIn":"0x<token>","tokenOut":"ETH","amountIn":"<raw>","chainId":1,"fromAddress":"0x<user>"}'
```

It discovers pools from PoolManager `Initialize` logs (ground truth, hooked pools
included), quotes each live one, prefers the best **hookless** pool, falls back to
hooked pools with a `hookWarning` you must relay, and returns `quote.quoteSource`
(`quoter` or `simulation`). Always `simulateAssetChanges` the swap step before
returning it; for a multistep, only step 1 is simulatable until approvals exist —
say so rather than refusing.

## Gotchas / failure modes

- **A hook can reject swaps.** If the quote fails, the error names `rejectedBy`.
  Read that contract (`getContractSource` with `grep:"afterSwap|beforeSwap|revert"`)
  to find the gate, then `ethCall` the gate's getter for current state.
- **Some hooks revert the official Quoter** even though real swaps work. The tool
  then quotes by simulation and widens default slippage to 2%.
- **`fee: 0` is legal** for hooked pools (the hook charges its own fee), and
  `tickSpacing` is arbitrary — never assume the standard tiers.
- **Direction matters.** A hook may allow sells but block buys (see below), so
  "can't trade this token" is usually wrong — test the direction the user asked for.
- Alchemy's simulation reports raw `from`/`to`; compute direction relative to the
  user's wallet or a wrap looks like two outflows.

### Worked example: FWA (`0xa0Df17B5aC76ABaBA36E1450E2cbCd18A620C845`, mainnet)

Liquid ($938K, $1.58M 24h volume) in a **hooked** ETH/FWA pool
(`fee 0`, `tickSpacing 60`, hooks `0x2C67ebA8A50AF0dB5Fba55F725247a75CbDA6444`,
poolId `0x230ecd3c25b44af30db59c15f70df7794eb13f67a200f230b7400daa96fe804d`).
LI.FI can't route it. Buys revert in the hook's `_afterSwap`:

```bash
node tools/wallet.mjs ethCall '{"to":"0x2C67ebA8A50AF0dB5Fba55F725247a75CbDA6444","signature":"externalBuysEnabled() view returns (bool)","chainId":1}'
# → false  ⇒ NOBODY can buy on-chain right now (not a tool limitation)
```

**Sells work** and `buildUniV4Swap` builds them. So the honest answer is: "buying is
disabled by the token's own hook until the team flips `externalBuysEnabled`; selling
works and here's the transaction." Re-check the flag before repeating this — it can
be turned on.

## Addresses / constants

Source: https://developers.uniswap.org/docs/protocols/v4/deployments (verified 2026-07-29)

| | Ethereum (1) | Base (8453) |
|---|---|---|
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `0x498581ff718922c3f8e6a244956af099b2652b2b` |
| V4Quoter | `0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203` | `0x0d5e0f971ed27fbff6c2837bf31316121532048d` |
| StateView | `0x7ffe42c4a5deea5b0fec41c94c136cf115597227` | `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71` |
| Universal Router | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` | `0x6ff5693b99212da76ad316178a184ab56d299b43` |

Permit2 (all chains): `0x000000000022D473030F116dDEE9F6B43aC78BA3`
