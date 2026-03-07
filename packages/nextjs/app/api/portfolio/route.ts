import { NextRequest, NextResponse } from "next/server";

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "8GVG8WjDs-sGFRr6Rm839";
const ALCHEMY_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

async function alchemyRpc(method: string, params: unknown[]) {
  const res = await fetch(ALCHEMY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const data = await res.json();
  return data.result;
}

export async function GET(req: NextRequest) {
  try {
    const walletAddress = req.nextUrl.searchParams.get("address");
    if (!walletAddress) {
      return NextResponse.json({ error: "address query param required" }, { status: 400 });
    }

    // Fetch ETH balance + ERC-20 balances in parallel
    const [ethBalanceHex, tokenBalancesResult] = await Promise.all([
      alchemyRpc("eth_getBalance", [walletAddress, "latest"]),
      alchemyRpc("alchemy_getTokenBalances", [walletAddress, "erc20"]),
    ]);

    // Get ETH price from a simple free API
    let ethPriceUsd = 0;
    try {
      const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
        next: { revalidate: 60 },
      });
      const priceData = await priceRes.json();
      ethPriceUsd = priceData?.ethereum?.usd || 0;
    } catch {
      // fallback — use a rough estimate
      ethPriceUsd = 2000;
    }

    const ethBalance = parseInt(ethBalanceHex, 16) / 1e18;
    const ethBalanceUsd = ethBalance * ethPriceUsd;

    // Filter out zero balances
    const nonZeroTokens: { contractAddress: string; tokenBalance: string }[] = (
      tokenBalancesResult?.tokenBalances || []
    ).filter(
      (t: { tokenBalance: string }) =>
        t.tokenBalance !== "0x0000000000000000000000000000000000000000000000000000000000000000",
    );

    // Take top 20 by raw balance count (we'll sort by USD after metadata)
    const topTokens = nonZeroTokens.slice(0, 20);

    // Fetch metadata for all tokens in parallel
    const metadataResults = await Promise.all(
      topTokens.map(t => alchemyRpc("alchemy_getTokenMetadata", [t.contractAddress])),
    );

    interface Asset {
      blockchain: string;
      tokenName: string;
      tokenSymbol: string;
      balance: string;
      balanceUsd: string;
      tokenDecimals: number;
      contractAddress: string;
      thumbnail: string;
    }

    const assets: Asset[] = [];

    // Add ETH first
    assets.push({
      blockchain: "eth",
      tokenName: "Ethereum",
      tokenSymbol: "ETH",
      balance: ethBalance.toFixed(6),
      balanceUsd: ethBalanceUsd.toFixed(2),
      tokenDecimals: 18,
      contractAddress: "",
      thumbnail: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    });

    // Add ERC-20 tokens
    for (let i = 0; i < topTokens.length; i++) {
      const token = topTokens[i];
      const meta = metadataResults[i];
      if (!meta || !meta.decimals) continue;

      const decimals = meta.decimals || 18;
      const rawBalance = BigInt(token.tokenBalance);
      const balance = Number(rawBalance) / Math.pow(10, decimals);

      if (balance < 0.000001) continue;

      assets.push({
        blockchain: "eth",
        tokenName: meta.name || "Unknown",
        tokenSymbol: meta.symbol || "???",
        balance: balance.toFixed(6),
        balanceUsd: "0", // we don't fetch individual token prices — show balance only
        tokenDecimals: decimals,
        contractAddress: token.contractAddress,
        thumbnail: meta.logo || "",
      });
    }

    // Sort: ETH first (already there), then by name
    const ethAsset = assets[0];
    const otherAssets = assets.slice(1).sort((a, b) => a.tokenSymbol.localeCompare(b.tokenSymbol));
    const sorted = [ethAsset, ...otherAssets].filter(a => parseFloat(a.balance) > 0);

    const totalBalanceUsd = ethBalanceUsd.toFixed(2); // approximate — only ETH priced

    return NextResponse.json({ totalBalanceUsd, assets: sorted });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
