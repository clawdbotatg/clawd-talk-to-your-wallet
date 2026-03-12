import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../_lib/auth";

const ZERION_KEY = process.env.ZERION_API_KEY || "";

export const dynamic = "force-dynamic";

interface ZerionPosition {
  attributes: {
    value: number | null;
    quantity: { float: number };
    position_type: string;
    fungible_info: {
      name: string;
      symbol: string;
      icon?: { url: string };
      implementations?: { chain_id: string; address: string | null; decimals: number }[];
    };
    flags: { displayable: boolean };
    protocol?: string;
  };
  relationships: {
    chain: { data: { id: string } };
  };
}

function mapPosition(p: ZerionPosition) {
  const chain = p.relationships.chain.data.id;
  const info = p.attributes.fungible_info;
  const impl = info.implementations?.find(i => i.chain_id === chain);
  return {
    blockchain: chain,
    tokenName: info.name,
    tokenSymbol: info.symbol,
    positionType: p.attributes.position_type, // wallet | deposit | staked | loan | locked | reward | investment
    protocol: p.attributes.protocol || null,
    balance: p.attributes.quantity.float.toString(),
    balanceUsd: (p.attributes.value || 0).toFixed(2),
    tokenDecimals: impl?.decimals ?? 18,
    contractAddress: impl?.address || "",
    thumbnail: info.icon?.url || "",
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

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

    // Fetch all three in parallel
    const [walletRes, defiRes, portfolioRes] = await Promise.all([
      // Simple wallet token holdings
      fetch(
        `https://api.zerion.io/v1/wallets/${walletAddress}/positions/?filter[positions]=only_simple&currency=usd&sort=-value&page[size]=100`,
        { headers, cache: "no-store" },
      ),
      // DeFi: deposits, staked, LP, loans, etc
      fetch(
        `https://api.zerion.io/v1/wallets/${walletAddress}/positions/?filter[positions]=only_complex&currency=usd&sort=-value&page[size]=100`,
        { headers, cache: "no-store" },
      ),
      // Portfolio summary (total, 1d change, chain breakdown)
      fetch(`https://api.zerion.io/v1/wallets/${walletAddress}/portfolio?currency=usd`, {
        headers,
        cache: "no-store",
      }),
    ]);

    if (!walletRes.ok) {
      const err = await walletRes.text();
      return NextResponse.json(
        { error: `Zerion wallet positions error (${walletRes.status}): ${err}` },
        { status: 502 },
      );
    }

    const walletData = await walletRes.json();
    const walletPositions: ZerionPosition[] = walletData.data || [];

    const assets = walletPositions
      .filter(p => p.attributes.flags.displayable && (p.attributes.value || 0) > 1)
      .map(mapPosition)
      .sort((a, b) => parseFloat(b.balanceUsd) - parseFloat(a.balanceUsd));

    const totalBalanceUsd = assets.reduce((sum, a) => sum + parseFloat(a.balanceUsd), 0).toFixed(2);

    // DeFi positions (best-effort — don't fail page if this errors)
    let defiPositions: ReturnType<typeof mapPosition>[] = [];
    let totalPortfolioUsd = "0";

    if (defiRes.ok) {
      try {
        const defiData = await defiRes.json();
        const raw: ZerionPosition[] = defiData.data || [];
        defiPositions = raw
          .filter(p => p.attributes.flags.displayable && (p.attributes.value || 0) > 1)
          .map(mapPosition)
          .sort((a, b) => parseFloat(b.balanceUsd) - parseFloat(a.balanceUsd));
        totalPortfolioUsd = defiPositions.reduce((sum, p) => sum + parseFloat(p.balanceUsd), 0).toFixed(2);
      } catch {
        // continue
      }
    }

    // Portfolio summary (1d change, chain breakdown)
    let change1dUsd = "0";
    let change1dPct = "0";
    let chainBreakdown: { chain: string; valueUsd: string }[] = [];

    if (portfolioRes.ok) {
      try {
        const portfolioData = await portfolioRes.json();
        const attrs = portfolioData?.data?.attributes || {};
        const changes = attrs.changes || {};
        change1dUsd = (changes.absolute_1d || 0).toFixed(2);
        change1dPct = (changes.percent_1d || 0).toFixed(2);
        const chainDist = attrs.positions_distribution_by_chain || {};
        chainBreakdown = Object.entries(chainDist)
          .map(([chain, value]) => ({ chain, valueUsd: (value as number).toFixed(2) }))
          .filter(c => parseFloat(c.valueUsd) > 1)
          .sort((a, b) => parseFloat(b.valueUsd) - parseFloat(a.valueUsd));
      } catch {
        // continue
      }
    }

    return NextResponse.json({
      totalBalanceUsd,
      assets,
      defiPositions,
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
