import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";

const CHAIN_RPC: Record<string, string> = {
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  optimism: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  xdai: "https://rpc.gnosischain.com",
  gnosis: "https://rpc.gnosischain.com",
};

const CHAIN_EXPLORERS: Record<string, string> = {
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  xdai: "https://gnosisscan.io/tx/",
  gnosis: "https://gnosisscan.io/tx/",
};

async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  return data.result;
}

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash");
  const chain = req.nextUrl.searchParams.get("chain") || "ethereum";

  if (!hash) {
    return NextResponse.json({ error: "hash query param required" }, { status: 400 });
  }

  const rpcUrl = CHAIN_RPC[chain.toLowerCase()];
  if (!rpcUrl) {
    return NextResponse.json({ error: `Unsupported chain: ${chain}` }, { status: 400 });
  }

  try {
    const [tx, receipt] = await Promise.all([
      rpcCall(rpcUrl, "eth_getTransactionByHash", [hash]),
      rpcCall(rpcUrl, "eth_getTransactionReceipt", [hash]),
    ]);

    if (!tx) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // Get block timestamp
    let timestamp: string | null = null;
    if (tx.blockNumber) {
      const block = await rpcCall(rpcUrl, "eth_getBlockByNumber", [tx.blockNumber, false]);
      if (block && block.timestamp) {
        const ts = parseInt(block.timestamp, 16);
        timestamp = new Date(ts * 1000).toISOString();
      }
    }

    const valueWei = BigInt(tx.value || "0x0");
    const valueEth = (Number(valueWei) / 1e18).toFixed(6);

    const gasUsed = receipt ? parseInt(receipt.gasUsed || "0x0", 16) : 0;
    const effectiveGasPrice = receipt
      ? parseInt(receipt.effectiveGasPrice || tx.gasPrice || "0x0", 16)
      : parseInt(tx.gasPrice || "0x0", 16);
    const gasCostWei = BigInt(gasUsed) * BigInt(effectiveGasPrice);
    const gasCostEth = (Number(gasCostWei) / 1e18).toFixed(6);

    const blockNumber = tx.blockNumber ? parseInt(tx.blockNumber, 16) : null;
    const status = receipt ? (receipt.status === "0x1" ? "success" : "failed") : "pending";

    const explorerBase = CHAIN_EXPLORERS[chain.toLowerCase()] || "https://etherscan.io/tx/";
    const explorerUrl = `${explorerBase}${hash}`;

    return NextResponse.json({
      from: tx.from,
      to: tx.to,
      valueEth,
      gasUsed,
      gasCostEth,
      blockNumber,
      timestamp,
      status,
      explorerUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
