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
    // false while DENARAI_TREASURY_ADDRESS is unset — clients hide top-up UI
    topupsEnabled: !!TREASURY_ADDRESS,
  });
}
