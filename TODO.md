# TODO — deferred work

Things we've explicitly decided to do *eventually*, with enough context to pick
them up cold. Remove an item when it ships.

## Auto top-up operator (deferred 2026-08-06)

USDC payments are live end-to-end (x402 top-ups settle on Base mainnet into the
SwapAndBurn sink), but **auto top-up is disabled**: `OPERATOR_ADDRESS` /
`OPERATOR_PRIVATE_KEY` are unset in the Vercel project
(`buidlguidldao/clawd-talk-to-your-wallet`), so `/api/credits/config` returns
`operator: null` and the /pay page greys the option out. Deliberately deferred —
manual $1/$5/$20 top-ups work today, and enabling this means minting a hot key.

What it is: a server-held EOA that, when a user has enabled auto top-up and
granted it a USDC allowance, calls `transferFrom(user, treasury, amount)` the
moment a charge finds their credit balance empty
(`pullAutoTopup` in `packages/nextjs/app/api/_lib/credits.ts`).

To enable:

1. Generate a **fresh** EOA (never reuse an existing key — this one lives in
   Vercel env as plaintext and only ever needs gas).
2. Fund it with a little ETH on Base (~0.005 is many months of `transferFrom`s).
3. Set `OPERATOR_ADDRESS` + `OPERATOR_PRIVATE_KEY` in Vercel (Production) and
   redeploy.
4. Verify: `GET /api/credits/config` returns the operator address; on /pay the
   auto top-up section un-greys; enable it from a test wallet with a small
   allowance, drain the wallet's credits, and watch a charge trigger the pull
   (`[autoTopup]` lines in Vercel logs) and credit the larv.ai ledger.

Risk note: the key can only move USDC *from wallets that approved it* and only
*to the treasury* (the burn sink) — worst case on key theft is burning
approvers' allowances, not stealing them. Still, keep allowances small and the
operator gas-only.

## Facilitator signer gas (watch item)

The self-hosted x402 facilitator (`clawd-facilitator.vercel.app`) settles with
signer `0x876Dba305deE9535fd747a69B6cED94517d74B25`, which pays gas for every
top-up settlement. Balance was ~0.0099 ETH on Base (2026-08-05). Top it up when
it runs low, or top-ups start failing at settlement.
