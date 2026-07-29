import { NextResponse } from "next/server";
import {
  CHAIN,
  OPERATOR_ADDRESS,
  TREASURY_ADDRESS,
  USDC_ADDRESS,
  USDC_COST_CHAT_MICRO,
  USDC_COST_PAGE_LOAD_MICRO,
  X402_TIERS,
} from "~~/app/api/_lib/chainConfig";

/** Client-side payment config (avoids duplicating addresses into NEXT_PUBLIC_ envs). */

export async function GET() {
  return NextResponse.json({
    chainId: CHAIN.id,
    usdcAddress: USDC_ADDRESS,
    treasury: TREASURY_ADDRESS || null,
    operator: OPERATOR_ADDRESS || null,
    costs: { pageLoadMicro: USDC_COST_PAGE_LOAD_MICRO, chatMicro: USDC_COST_CHAT_MICRO },
    tiers: X402_TIERS.map(t => ({ tier: t.tier, price: t.price, amountMicro: t.amountMicro })),
  });
}
