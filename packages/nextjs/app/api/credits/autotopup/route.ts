import { NextRequest, NextResponse } from "next/server";
import { erc20Abi } from "viem";
import { requireAuth } from "~~/app/api/_lib/auth";
import { LARV_AI_BASE_URL, OPERATOR_ADDRESS, USDC_ADDRESS, getPublicClient } from "~~/app/api/_lib/chainConfig";

/** Enable/disable auto top-up. On enable, checks the on-chain USDC allowance the
 * funding wallet has granted the operator so a broken setup fails loudly here
 * rather than silently at charge time. */

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { enabled, amountMicro, fromWallet } = await req.json();

    if (typeof enabled !== "boolean") {
      return NextResponse.json({ success: false, error: "enabled must be boolean" }, { status: 400 });
    }

    if (enabled) {
      if (!OPERATOR_ADDRESS) {
        return NextResponse.json({ success: false, error: "auto top-up not configured" }, { status: 503 });
      }
      if (typeof amountMicro !== "number" || amountMicro <= 0 || !Number.isInteger(amountMicro)) {
        return NextResponse.json({ success: false, error: "amountMicro must be a positive integer" }, { status: 400 });
      }
      if (typeof fromWallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(fromWallet)) {
        return NextResponse.json({ success: false, error: "invalid fromWallet" }, { status: 400 });
      }

      const allowance = await getPublicClient().readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [fromWallet as `0x${string}`, OPERATOR_ADDRESS],
      });
      if (allowance < BigInt(amountMicro)) {
        return NextResponse.json(
          {
            success: false,
            error: "USDC allowance to the operator is below the top-up amount — approve first",
            allowanceMicro: Number(allowance),
          },
          { status: 400 },
        );
      }
    }

    const res = await fetch(`${LARV_AI_BASE_URL}/api/usdc/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: auth.cvWallet,
        signature: auth.cvSignature,
        secret: process.env.CV_SPEND_SECRET,
        enabled,
        amountMicro: enabled ? amountMicro : 0,
        fromWallet: enabled ? fromWallet : null,
      }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("autotopup error:", err);
    return NextResponse.json({ success: false, error: "internal server error" }, { status: 500 });
  }
}
