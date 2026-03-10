import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ZERION_KEY = process.env.ZERION_API_KEY || "";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol query param required" }, { status: 400 });
  }

  const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, accept: "application/json" };

  try {
    const searchRes = await fetch(
      `https://api.zerion.io/v1/fungibles/?filter[search_query]=${encodeURIComponent(symbol)}&currency=usd`,
      { headers, cache: "no-store" },
    );

    if (!searchRes.ok) {
      return NextResponse.json({ error: `Zerion API error: ${searchRes.status}` }, { status: 502 });
    }

    const searchData = await searchRes.json();
    interface ZerionFungible {
      id: string;
      attributes: {
        symbol: string;
        name: string;
        description: string | null;
        icon?: { url: string };
        market_data: {
          price: number | null;
          changes: { percent_1d: number | null };
          market_cap: number | null;
          total_volume: number | null;
        } | null;
        external_links: { type: string; url: string; name: string }[] | null;
        implementations: { chain_id: string; address: string | null; decimals: number }[] | null;
      };
    }

    const fungibles: ZerionFungible[] = searchData.data || [];

    // Find exact symbol match first, then fall back to first result
    const exactMatch = fungibles.find(
      (f: ZerionFungible) => f.attributes.symbol.toLowerCase() === symbol.toLowerCase(),
    );
    const fungible = exactMatch || fungibles[0];

    if (!fungible) {
      return NextResponse.json({ error: `Token '${symbol}' not found` }, { status: 404 });
    }

    const attrs = fungible.attributes;
    const market = attrs.market_data;

    return NextResponse.json({
      symbol: attrs.symbol,
      name: attrs.name,
      price: market?.price ?? null,
      priceChange24h: market?.changes?.percent_1d ?? null,
      marketCap: market?.market_cap ?? null,
      volume24h: market?.total_volume ?? null,
      description: attrs.description || null,
      icon: attrs.icon?.url || null,
      links: (attrs.external_links || []).slice(0, 5).map((l: { type: string; url: string; name: string }) => ({
        type: l.type,
        url: l.url,
        name: l.name,
      })),
      implementations: (attrs.implementations || [])
        .slice(0, 5)
        .map((i: { chain_id: string; address: string | null; decimals: number }) => ({
          chain: i.chain_id,
          address: i.address,
          decimals: i.decimals,
        })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
