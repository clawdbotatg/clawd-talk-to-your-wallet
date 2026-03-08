import { NextRequest, NextResponse } from "next/server";

const ZERION_KEY = process.env.ZERION_API_KEY || "";

export async function GET(req: NextRequest) {
  try {
    const walletAddress = req.nextUrl.searchParams.get("address");
    if (!walletAddress) {
      return NextResponse.json({ error: "address query param required" }, { status: 400 });
    }

    if (!ZERION_KEY) {
      return NextResponse.json({ error: "ZERION_API_KEY not configured" }, { status: 500 });
    }

    const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");

    // Fetch all wallet positions sorted by USD value
    const res = await fetch(
      `https://api.zerion.io/v1/wallets/${walletAddress}/positions/?filter[position_types]=wallet&currency=usd&sort=-value&page[size]=100`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          accept: "application/json",
        },
      },
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Zerion API error (${res.status}): ${err}` }, { status: 502 });
    }

    const data = await res.json();

    interface ZerionPosition {
      attributes: {
        value: number | null;
        quantity: { float: number };
        fungible_info: {
          name: string;
          symbol: string;
          icon?: { url: string };
          implementations?: { chain_id: string; address: string | null; decimals: number }[];
        };
        flags: { displayable: boolean };
      };
      relationships: {
        chain: { data: { id: string } };
      };
    }

    const positions: ZerionPosition[] = data.data || [];

    // Filter: only displayable, non-zero value
    const assets = positions
      .filter(p => p.attributes.flags.displayable && (p.attributes.value || 0) > 0.01)
      .map(p => {
        const chain = p.relationships.chain.data.id;
        const info = p.attributes.fungible_info;
        const impl = info.implementations?.find(i => i.chain_id === chain);
        return {
          blockchain: chain,
          tokenName: info.name,
          tokenSymbol: info.symbol,
          balance: p.attributes.quantity.float.toString(),
          balanceUsd: (p.attributes.value || 0).toFixed(2),
          tokenDecimals: impl?.decimals ?? 18,
          contractAddress: impl?.address || "",
          thumbnail: info.icon?.url || "",
        };
      });

    const totalBalanceUsd = assets.reduce((sum, a) => sum + parseFloat(a.balanceUsd), 0).toFixed(2);

    return NextResponse.json({ totalBalanceUsd, assets });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
