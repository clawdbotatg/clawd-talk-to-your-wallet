import { NextRequest, NextResponse } from "next/server";
import { LARV_AI_BASE_URL, TREASURY_ADDRESS } from "~~/app/api/_lib/chainConfig";

/** Combined balances for the header chip and /pay page.
 * usdcMicro is null when the USDC ledger isn't reachable (endpoints not live yet). */

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ success: false, error: "invalid address" }, { status: 400 });
  }

  const [cv, usdc] = await Promise.all([
    fetch(`${LARV_AI_BASE_URL}/api/cv/balance?address=${address}`)
      .then(r => r.json())
      .catch(() => null),
    fetch(`${LARV_AI_BASE_URL}/api/usdc/balance?address=${address}`)
      .then(r => r.json())
      .catch(() => null),
  ]);

  return NextResponse.json({
    success: true,
    cv: cv?.success && typeof cv.balance === "number" ? cv.balance : null,
    usdcMicro: usdc?.success && typeof usdc.balanceMicro === "number" ? usdc.balanceMicro : null,
    autoTopup: usdc?.success ? (usdc.autoTopup ?? null) : null,
    // Clients hide top-up UI unless a payment can actually settle: we need both a
    // payTo (DENARAI_TREASURY_ADDRESS) and a facilitator to submit the EIP-3009
    // authorization (CDP keys on mainnet, or an explicit X402_FACILITATOR_URL).
    // Without the facilitator the button would render and then fail at settlement.
    topupsEnabled: !!TREASURY_ADDRESS && (!!process.env.CDP_API_KEY_ID || !!process.env.X402_FACILITATOR_URL),
  });
}
