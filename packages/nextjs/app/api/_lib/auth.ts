import { NextRequest, NextResponse } from "next/server";
import { getPublicClient } from "./chainConfig";

const CV_SPEND_MESSAGE = "larv.ai CV Spend";

export async function requireAuth(
  request: NextRequest,
): Promise<{ address: string; cvWallet: string; cvSignature: string } | NextResponse> {
  // New auth: CV wallet + CV sig — one signature covers everything
  const cvWallet = request.headers.get("x-denarai-cv-wallet");
  const cvSig = request.headers.get("x-denarai-cv-sig");
  // Operating wallet (may differ from cv wallet)
  const address = request.headers.get("x-denarai-address") || cvWallet;

  if (!cvWallet || !cvSig) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify CV signature — proves ownership of cvWallet.
  // publicClient.verifyMessage handles both EOAs and ERC-1271 smart wallets.
  try {
    const valid = await getPublicClient().verifyMessage({
      address: cvWallet as `0x${string}`,
      message: CV_SPEND_MESSAGE,
      signature: cvSig as `0x${string}`,
    });
    if (!valid) {
      return NextResponse.json({ error: "Invalid CV signature" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid CV signature" }, { status: 401 });
  }

  return { address: address as string, cvWallet, cvSignature: cvSig };
}
