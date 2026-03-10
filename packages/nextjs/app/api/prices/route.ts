import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ZERION_KEY = process.env.ZERION_API_KEY || "";

// Zerion fungible IDs for known tokens
const TOKEN_IDS: Record<string, string> = {
  ETH: "eth",
  BTC: "ee9702a0-c587-4c69-ac0c-ce820a50c95b",
  CLAWD: "b07ec41c-2b1c-4ad9-8cfb-a71896b180e2",
};

export async function GET() {
  const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, accept: "application/json" };

  try {
    const results = await Promise.all(
      Object.entries(TOKEN_IDS).map(async ([symbol, id]) => {
        const res = await fetch(`https://api.zerion.io/v1/fungibles/${id}?currency=usd`, {
          headers,
          cache: "no-store",
        });
        if (!res.ok) return { symbol, price: null, change24h: null };
        const data = await res.json();
        const market = data?.data?.attributes?.market_data;
        return {
          symbol,
          price: market?.price ?? null,
          change24h: market?.changes?.percent_1d ?? null,
        };
      }),
    );

    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
