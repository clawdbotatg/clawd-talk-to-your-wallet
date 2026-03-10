import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";

const CHAIN_CONFIG: Record<string, { rpcUrl: string; chainId: number; explorerUrl: string }> = {
  ethereum: {
    rpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    chainId: 1,
    explorerUrl: "https://etherscan.io",
  },
  base: {
    rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    chainId: 8453,
    explorerUrl: "https://basescan.org",
  },
  arbitrum: {
    rpcUrl: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    chainId: 42161,
    explorerUrl: "https://arbiscan.io",
  },
  optimism: {
    rpcUrl: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    chainId: 10,
    explorerUrl: "https://optimistic.etherscan.io",
  },
  polygon: {
    rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    chainId: 137,
    explorerUrl: "https://polygonscan.com",
  },
};

async function rpcCall(rpcUrl: string, method: string, params: unknown[] = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  return data.result;
}

export async function GET(req: NextRequest) {
  const chain = req.nextUrl.searchParams.get("chain");
  if (!chain) {
    return NextResponse.json({ error: "chain query param required" }, { status: 400 });
  }

  const config = CHAIN_CONFIG[chain.toLowerCase()];
  if (!config) {
    return NextResponse.json(
      { error: `Unsupported chain: ${chain}. Supported: ${Object.keys(CHAIN_CONFIG).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const [gasPriceHex, blockNumberHex] = await Promise.all([
      rpcCall(config.rpcUrl, "eth_gasPrice"),
      rpcCall(config.rpcUrl, "eth_blockNumber"),
    ]);

    const gasPriceWei = parseInt(gasPriceHex || "0x0", 16);
    const gasGwei = (gasPriceWei / 1e9).toFixed(2);
    const blockNumber = parseInt(blockNumberHex || "0x0", 16);

    return NextResponse.json({
      gasGwei,
      blockNumber,
      chainId: config.chainId,
      explorerUrl: config.explorerUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
