import { NextRequest, NextResponse } from "next/server";
import { TREASURY_ADDRESS, X402_NETWORK } from "./chainConfig";
import { creditLedger } from "./credits";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import type { FacilitatorConfig } from "@x402/core/server";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402 } from "@x402/next";
import { AsyncLocalStorage } from "node:async_hooks";

/** x402 top-up endpoints: the payer signs an EIP-3009 transferWithAuthorization
 * (gasless — the facilitator submits it), USDC lands in the treasury, and
 * onAfterSettle credits the larv.ai ledger.
 *
 * The wallet to credit rides in as ?creditWallet= (defaults to the payer).
 * Settlement runs AFTER the route handler returns, so the value is threaded
 * through AsyncLocalStorage wrapped around the withX402-wrapped handler —
 * wrapping the inner handler would not cover the settle hook. */

const topupAls = new AsyncLocalStorage<{ creditWallet?: string }>();

function facilitatorConfig(): FacilitatorConfig {
  // Testnet (or any custom facilitator): no auth needed
  if (process.env.X402_FACILITATOR_URL) {
    return { url: process.env.X402_FACILITATOR_URL as `${string}://${string}` };
  }
  // Mainnet: Coinbase CDP facilitator, reads CDP_API_KEY_ID / CDP_API_KEY_SECRET
  return cdpFacilitator;
}

const server = new x402ResourceServer(new HTTPFacilitatorClient(facilitatorConfig()));
server.register(X402_NETWORK as never, new ExactEvmScheme());

server.onAfterSettle(async ctx => {
  const result = ctx.result;
  if (!result?.success) return;

  const payer = result.payer ? String(result.payer).toLowerCase() : null;
  const wallet = topupAls.getStore()?.creditWallet || payer;
  if (!wallet) {
    console.error("[x402 topup] settled but no wallet to credit", result.transaction);
    return;
  }

  // "exact" scheme: result.amount may be absent — the authorized amount in
  // requirements.amount (atomic units = micro-USDC) is what settled.
  const amountMicro = Number(result.amount ?? ctx.requirements.amount);
  if (!Number.isInteger(amountMicro) || amountMicro <= 0) {
    console.error("[x402 topup] unparseable settle amount", result.amount, ctx.requirements.amount);
    return;
  }

  // Idempotency: the EIP-3009 nonce uniquely identifies the authorization even
  // if the settle response is replayed; fall back to the tx hash.
  const payload = ctx.paymentPayload as { payload?: { authorization?: { nonce?: string } } } | undefined;
  const nonce = payload?.payload?.authorization?.nonce;
  const depositKey = `x402:${nonce || result.transaction}`;

  const credit = await creditLedger({ wallet, amountMicro, depositKey, source: "x402" });
  if (!credit.success) {
    // Payment settled but the ledger call failed — loud log so it can be replayed
    // manually via /api/usdc/credit with this exact depositKey.
    console.error("[x402 topup] SETTLED BUT NOT CREDITED", { wallet, amountMicro, depositKey, tx: result.transaction });
  } else {
    console.log("[x402 topup] credited", { wallet, amountMicro, depositKey, duplicate: credit.duplicate });
  }
});

export function makeTopupRoute(price: string) {
  if (!TREASURY_ADDRESS) {
    return async () =>
      NextResponse.json({ error: "USDC top-ups not configured (DENARAI_TREASURY_ADDRESS unset)" }, { status: 503 });
  }

  const wrapped = withX402(
    async () => NextResponse.json({ ok: true }),
    {
      accepts: [{ scheme: "exact", price, network: X402_NETWORK as never, payTo: TREASURY_ADDRESS }],
      description: `denar.ai USDC credit top-up (${price})`,
      mimeType: "application/json",
    },
    server,
  );

  return async (req: NextRequest) => {
    const raw = req.nextUrl.searchParams.get("creditWallet");
    const creditWallet = raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : undefined;
    return topupAls.run({ creditWallet }, () => wrapped(req));
  };
}
