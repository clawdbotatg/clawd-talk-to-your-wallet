import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ success: false, error: "missing address" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://larv.ai/api/cv/balance?address=${address}`, {
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("CV balance proxy error:", err);
    return NextResponse.json({ success: false, error: "failed to fetch CV balance" }, { status: 502 });
  }
}
