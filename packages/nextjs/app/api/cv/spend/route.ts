import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "~~/app/api/_lib/auth";

const LARV_AI_SPEND_URL = "https://larv.ai/api/cv/spend";
const CV_SPEND_SECRET = process.env.CV_SPEND_SECRET;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { wallet, signature, amount } = await req.json();

    if (!wallet || !signature || !amount) {
      return NextResponse.json({ success: false, error: "missing required fields" }, { status: 400 });
    }

    if (typeof amount !== "number" || amount <= 0 || !Number.isInteger(amount)) {
      return NextResponse.json({ success: false, error: "amount must be a positive integer" }, { status: 400 });
    }

    if (!CV_SPEND_SECRET) {
      console.error("CV_SPEND_SECRET not configured");
      return NextResponse.json({ success: false, error: "CV spending not configured" }, { status: 503 });
    }

    const res = await fetch(LARV_AI_SPEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet,
        signature,
        secret: CV_SPEND_SECRET,
        amount,
      }),
    });

    const data = await res.json();

    // Pass through the status from larv.ai (402 = insufficient, 404 = not found, etc.)
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("CV spend proxy error:", err);
    return NextResponse.json({ success: false, error: "internal server error" }, { status: 500 });
  }
}
