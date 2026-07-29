---
name: erc20-approvals
description: Listing which contracts can spend the user's ERC-20 tokens (approvals/allowances) and revoking risky/unlimited ones
verified: 2026-07-29 — getTokenApprovals scoped scan confirmed against mainnet (vitalik.eth: real DAI/USDT/WETH/USDC allowances, unlimited flagged, finite amounts formatted); buildRevoke calldata simulated → APPROVE change of amount 0
---

## What this is

ERC-20 `approve(spender, amount)` lets another contract pull your tokens up to
`amount`. A **spending approval** is one live `allowance(owner, spender) > 0`. An
**unlimited approval** (`allowance == 2^256-1`, or any value ≥ 2^255) lets that
spender move *all* of that token, forever, until revoked — the standard "risky
approval" users worry about. **Revoking** is just `approve(spender, 0)`.

There is no on-chain function that enumerates a wallet's approvals, so you
reconstruct the list from the token's `Approval(owner indexed, spender indexed,
value)` event logs, then read the *current* `allowance()` for each spender (the
logs are history — the allowance may have been spent down or already revoked).

## How to do it with our tools

Two tools, no need to send anyone to revoke.cash or a block explorer:

```bash
# 1) List who can spend the user's tokens. ALWAYS scope with `tokens` = the
#    contract addresses the user actually holds (from the portfolio context).
node tools/wallet.mjs getTokenApprovals '{"owner":"0x<user>","tokens":["0x<tokenA>","0x<tokenB>"],"chainId":1}'
#    → { activeApprovals, unlimitedApprovals, approvals:[{token,tokenSymbol,
#        spender,allowance,allowanceRaw,isUnlimited,lastApprovalTx}], note }
#      sorted riskiest-first (unlimited, then largest remaining allowance).

# 2) Revoke one. approve(spender,0). Simulate, then return as a transaction.
node tools/wallet.mjs buildRevoke '{"tokenAddress":"0x<token>","spender":"0x<spender>","chainId":1,"tokenSymbol":"USDC"}'
node tools/wallet.mjs simulateAssetChanges '{"from":"0x<user>","to":"0x<token>","data":"0x095ea7b3…","chainId":1}'
#    → a correct revoke shows exactly one change: {direction:"APPROVE", amount:"0"} — no funds move.
```

To revoke several at once, return them as a `multistep_transaction` (delay 0).

## Gotchas / failure modes

- **Scam tokens fake approvals.** Any contract can emit `Approval(yourWallet,
  attacker, max)` you never signed, and make its own `allowance()` return `max`.
  An **unscoped** scan of a busy wallet is mostly these phantom approvals on
  worthless tokens (e.g. vitalik.eth shows ~2,200, nearly all junk). So **always
  pass `tokens`** = the user's real holdings; only trust approvals on tokens they
  actually own. The unscoped scan is a fallback and its `note` says so.
- **A revoke moves no funds**, so `simulateAssetChanges` returns a single
  `APPROVE` change of amount `0`, not an `in`/`out` transfer. That IS the success
  signal — don't treat "no transfer" as a failed simulation.
- **The allowance, not the log, is truth.** Report `getTokenApprovals`'s current
  `allowance` — a spender in the log history whose current allowance is 0 has
  already been revoked/spent and is omitted (unless `includeZero:true`).
- **ERC-721 shares the `Approval` topic0 hash.** The tool keys off the indexed
  spender topic and drops any entry whose `allowance(owner,spender)` has no return
  (NFTs), so single-NFT approvals don't pollute the list. (NFT operator approvals
  are a *different* event, `ApprovalForAll` — not covered here.)
- **`allowanceRaw` is the exact integer;** `allowance` is human-readable, or the
  string `"unlimited"` when `isUnlimited`. Quote the unlimited ones to the user
  first — they're the real exposure.
- Unscoped history can exceed an RPC's log cap; the tool then returns a `hint` to
  pass `tokens` or `fromBlock`. Scoping to holdings avoids it entirely.

## Verified example (mainnet, 2026-07-29)

`getTokenApprovals` for `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` scoped to
DAI/USDT/WETH/USDC → 11 active approvals, 9 unlimited, e.g. unlimited DAI to
`0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45` (Uniswap V3 router) and a finite
317,204.93 DAI to `0x1fd862…`. `buildRevoke` on a USDC approval produced
`0x095ea7b3` + spender + 32 zero bytes, and `simulateAssetChanges` returned
`{direction:"APPROVE", symbol:"USDC", amount:"0"}` — the revoke, confirmed.

## Selectors (for reference / ethCall)

`allowance(address,address)` = `0xdd62ed3e` · `approve(address,uint256)` =
`0x095ea7b3` · `symbol()` = `0x95d89b41` · `decimals()` = `0x313ce567`. Permit2
(the shared allowance router many dapps use) = `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
