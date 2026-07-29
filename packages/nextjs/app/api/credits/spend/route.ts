import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "~~/app/api/_lib/auth";
import {
  CV_COST_CHAT,
  CV_COST_PAGE_LOAD,
  USDC_COST_CHAT_MICRO,
  USDC_COST_PAGE_LOAD_MICRO,
} from "~~/app/api/_lib/chainConfig";
import { chargeCredits } from "~~/app/api/_lib/credits";

/** Usage charge: CV first, USDC credits as fallback. The server maps `kind` to
 * amounts — clients never pick their own price. Response shape matches the old
 * /api/cv/spend so the frontend's 402-hard/other-soft semantics carry over. */

const COSTS = {
  page_load: { cv: CV_COST_PAGE_LOAD, usdcMicro: USDC_COST_PAGE_LOAD_MICRO },
  chat: { cv: CV_COST_CHAT, usdcMicro: USDC_COST_CHAT_MICRO },
} as const;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { kind } = await req.json();
    const cost = COSTS[kind as keyof typeof COSTS];
    if (!cost) {
      return NextResponse.json({ success: false, error: "invalid kind" }, { status: 400 });
    }

    const result = await chargeCredits({
      cvWallet: auth.cvWallet,
      signature: auth.cvSignature,
      amountCv: cost.cv,
      amountUsdcMicro: cost.usdcMicro,
    });

    if (result.ok) {
      return NextResponse.json({
        success: true,
        source: result.source,
        ...(typeof result.cvBalance === "number" ? { newBalance: result.cvBalance } : {}),
        ...(typeof result.usdcBalanceMicro === "number" ? { newBalanceMicro: result.usdcBalanceMicro } : {}),
      });
    }

    if (result.kind === "insufficient") {
      return NextResponse.json(
        {
          success: false,
          error: "insufficient balance",
          cvBalance: result.cvBalance,
          usdcBalanceMicro: result.usdcBalanceMicro,
        },
        { status: 402 },
      );
    }

    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status >= 400 ? result.status : 500 },
    );
  } catch (err) {
    console.error("credits spend error:", err);
    return NextResponse.json({ success: false, error: "internal server error" }, { status: 500 });
  }
}
