import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ZERION_KEY = process.env.ZERION_API_KEY || "";
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address query param required" }, { status: 400 });
  }

  const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, accept: "application/json" };
  const alchemyUrl = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

  try {
    const [portfolioRes, positionsRes, txCountRes] = await Promise.all([
      ZERION_KEY
        ? fetch(`https://api.zerion.io/v1/wallets/${address}/portfolio?currency=usd`, {
            headers,
            cache: "no-store",
          })
        : null,
      ZERION_KEY
        ? fetch(
            `https://api.zerion.io/v1/wallets/${address}/positions/?filter[position_types]=wallet&currency=usd&sort=-value&page[size]=5`,
            { headers, cache: "no-store" },
          )
        : null,
      fetch(alchemyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionCount",
          params: [address, "latest"],
        }),
      }),
    ]);

    let portfolioUsd = "0";
    let ethBalance = "0";

    if (portfolioRes && portfolioRes.ok) {
      const portfolioData = await portfolioRes.json();
      const attrs = portfolioData?.data?.attributes || {};
      portfolioUsd = (attrs.total?.positions || 0).toFixed(2);
    }

    // Get ETH balance via Alchemy
    const ethBalRes = await fetch(alchemyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });
    const ethBalData = await ethBalRes.json();
    const ethWei = BigInt(ethBalData.result || "0x0");
    ethBalance = (Number(ethWei) / 1e18).toFixed(4);

    // Top tokens from positions
    interface ZerionPositionItem {
      attributes: {
        value: number | null;
        quantity: { float: number };
        fungible_info: {
          symbol: string;
          icon?: { url: string };
        };
      };
    }

    let topTokens: { symbol: string; balanceUsd: string; icon: string }[] = [];
    if (positionsRes && positionsRes.ok) {
      const posData = await positionsRes.json();
      const positions: ZerionPositionItem[] = posData.data || [];
      topTokens = positions
        .filter((p: ZerionPositionItem) => (p.attributes.value || 0) > 0.01)
        .map((p: ZerionPositionItem) => ({
          symbol: p.attributes.fungible_info.symbol,
          balanceUsd: (p.attributes.value || 0).toFixed(2),
          icon: p.attributes.fungible_info.icon?.url || "",
        }));
    }

    // Tx count
    let txCount = 0;
    if (txCountRes.ok) {
      const txData = await txCountRes.json();
      txCount = parseInt(txData.result || "0x0", 16);
    }

    return NextResponse.json({
      portfolioUsd,
      ethBalance,
      topTokens,
      txCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
