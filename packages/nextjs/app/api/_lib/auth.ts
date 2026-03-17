import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";

const CLAWD_ASSET_ID = "b07ec41c-2b1c-4ad9-8cfb-a71896b180e2";
const CLAWD_MIN_USD = 1000;
const CV_SPEND_MESSAGE = "larv.ai CV Spend";

export async function requireAuth(request: NextRequest): Promise<{ address: string } | NextResponse> {
  // New auth: CV wallet + CV sig — one signature covers everything
  const cvWallet = request.headers.get("x-denarai-cv-wallet");
  const cvSig = request.headers.get("x-denarai-cv-sig");
  // Operating wallet (may differ from cv wallet)
  const address = request.headers.get("x-denarai-address") || cvWallet;

  if (!cvWallet || !cvSig) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify CV signature — proves ownership of cvWallet
  try {
    const valid = await verifyMessage({
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

  // Check CLAWD balance on the CV wallet via Zerion
  const ZERION_KEY = process.env.ZERION_API_KEY;
  if (!ZERION_KEY) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  try {
    const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");
    const res = await fetch(
      `https://api.zerion.io/v1/wallets/${cvWallet}/positions/?filter[positions]=only_simple&filter[asset_ids]=${CLAWD_ASSET_ID}&currency=usd`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      console.error("Zerion CLAWD balance check failed:", res.status);
      return NextResponse.json({ error: "Failed to verify CLAWD balance" }, { status: 502 });
    }

    const data = await res.json();
    const positions = data.data || [];
    const totalValue = positions.reduce(
      (sum: number, p: { attributes?: { value?: number | null } }) => sum + (p.attributes?.value || 0),
      0,
    );

    if (totalValue < CLAWD_MIN_USD) {
      return NextResponse.json(
        { error: "Insufficient CLAWD balance. Must hold at least $1000 worth of CLAWD." },
        { status: 403 },
      );
    }
  } catch (err) {
    console.error("CLAWD balance check error:", err);
    return NextResponse.json({ error: "Failed to verify CLAWD balance" }, { status: 502 });
  }

  return { address: address as string };
}
