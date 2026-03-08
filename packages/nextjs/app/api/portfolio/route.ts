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
    const headers = {
      Authorization: `Basic ${auth}`,
      accept: "application/json",
    };

    // Fetch wallet positions AND portfolio summary in parallel
    const [positionsRes, portfolioRes] = await Promise.all([
      fetch(
        `https://api.zerion.io/v1/wallets/${walletAddress}/positions/?filter[position_types]=wallet&currency=usd&sort=-value&page[size]=100`,
        { headers, next: { revalidate: 120 } },
      ),
      fetch(`https://api.zerion.io/v1/wallets/${walletAddress}/portfolio?currency=usd`, {
        headers,
        next: { revalidate: 120 },
      }),
    ]);

    if (!positionsRes.ok) {
      const err = await positionsRes.text();
      return NextResponse.json(
        { error: `Zerion positions API error (${positionsRes.status}): ${err}` },
        { status: 502 },
      );
    }

    const positionsData = await positionsRes.json();

    // Parse portfolio summary (best-effort — don't fail if this one errors)
    let totalPortfolioUsd = "0";
    let change1dUsd = "0";
    let change1dPct = "0";
    let chainBreakdown: { chain: string; valueUsd: string }[] = [];

    if (portfolioRes.ok) {
      try {
        const portfolioData = await portfolioRes.json();
        const attrs = portfolioData?.data?.attributes || {};

        // DeFi total = deposited + staked + locked (exclude "wallet" which is token holdings)
        const dist = attrs.positions_distribution_by_type || {};
        const defiTotal = (dist.deposited || 0) + (dist.staked || 0) + (dist.locked || 0);
        totalPortfolioUsd = defiTotal.toFixed(2);

        // 1-day change
        const changes = attrs.changes || {};
        change1dUsd = (changes.absolute_1d || 0).toFixed(2);
        change1dPct = (changes.percent_1d || 0).toFixed(2);

        // Chain breakdown
        const chainDist = attrs.positions_distribution_by_chain || {};
        chainBreakdown = Object.entries(chainDist)
          .map(([chain, value]) => ({ chain, valueUsd: (value as number).toFixed(2) }))
          .filter(c => parseFloat(c.valueUsd) > 1)
          .sort((a, b) => parseFloat(b.valueUsd) - parseFloat(a.valueUsd));
      } catch {
        // Portfolio parsing failed — continue with defaults
      }
    }

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

    const positions: ZerionPosition[] = positionsData.data || [];

    // Filter: only displayable, meaningful value (>$1 to cut dust)
    const assets = positions
      .filter(p => p.attributes.flags.displayable && (p.attributes.value || 0) > 1)
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

    // Sort by USD value descending
    assets.sort((a, b) => parseFloat(b.balanceUsd) - parseFloat(a.balanceUsd));

    const totalBalanceUsd = assets.reduce((sum, a) => sum + parseFloat(a.balanceUsd), 0).toFixed(2);

    return NextResponse.json({
      totalBalanceUsd,
      assets,
      totalPortfolioUsd,
      change1dUsd,
      change1dPct,
      chainBreakdown,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
