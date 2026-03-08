import { NextRequest, NextResponse } from "next/server";

interface ActivityItem {
  id: string;
  hash: string;
  chain: string;
  type: string;
  status: string;
  minedAt: string;
  valueUsd: number | null;
  out: { symbol: string; amount: string; icon: string } | null;
  in: { symbol: string; amount: string; icon: string } | null;
  explorerUrl: string;
}

const CHAIN_EXPLORERS: Record<string, string> = {
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  xdai: "https://gnosisscan.io/tx/",
  gnosis: "https://gnosisscan.io/tx/",
  monad: "https://testnet.monadexplorer.com/tx/",
};

function formatAmount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toPrecision(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toPrecision(3)}K`;
  // Up to 4 significant figures
  if (num === 0) return "0";
  return num.toPrecision(4).replace(/\.?0+$/, "");
}

function getExplorerUrl(chain: string, hash: string): string {
  const base = CHAIN_EXPLORERS[chain] || "https://etherscan.io/tx/";
  return `${base}${hash}`;
}

function mapTxType(rawType: string): string {
  const typeMap: Record<string, string> = {
    send: "send",
    receive: "receive",
    trade: "trade",
    approve: "approve",
    borrow: "deposit",
    deposit: "deposit",
    withdraw: "withdraw",
    mint: "mint",
    burn: "withdraw",
    bridge: "bridge",
    stake: "deposit",
    unstake: "withdraw",
    claim: "receive",
  };
  return typeMap[rawType] || rawType;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const page = searchParams.get("page") || "1";

  if (!address) {
    return NextResponse.json({ error: "address parameter required" }, { status: 400 });
  }

  const ZERION_KEY = process.env.ZERION_API_KEY;
  if (!ZERION_KEY) {
    return NextResponse.json({ error: "ZERION_API_KEY not configured" }, { status: 500 });
  }

  try {
    const pageNum = parseInt(page);
    const url = `https://api.zerion.io/v1/wallets/${address}/transactions/?currency=usd&page[size]=20${pageNum > 1 ? `&page[after]=${(pageNum - 1) * 20}` : ""}&sort=-mined_at`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(ZERION_KEY + ":").toString("base64")}`,
        Accept: "application/json",
      },
      next: { revalidate: 15 },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Zerion API error:", res.status, text);
      return NextResponse.json({ error: "Failed to fetch activity from Zerion" }, { status: res.status });
    }

    const data = await res.json();
    const items: ActivityItem[] = (data.data || []).map((tx: any) => {
      const attrs = tx.attributes || {};
      const hash = attrs.hash || "";
      const chain = attrs.chain || "ethereum";
      const transfers = attrs.transfers || [];

      const outTransfer = transfers.find((t: any) => t.direction === "out");
      const inTransfer = transfers.find((t: any) => t.direction === "in");

      let outItem: ActivityItem["out"] = null;
      if (outTransfer) {
        const info = outTransfer.fungible_info || {};
        outItem = {
          symbol: info.symbol || "???",
          amount: formatAmount(outTransfer.quantity?.float || 0),
          icon: info.icon?.url || "",
        };
      }

      let inItem: ActivityItem["in"] = null;
      if (inTransfer) {
        const info = inTransfer.fungible_info || {};
        inItem = {
          symbol: info.symbol || "???",
          amount: formatAmount(inTransfer.quantity?.float || 0),
          icon: info.icon?.url || "",
        };
      }

      // Sum up USD values from transfers
      let valueUsd: number | null = null;
      for (const t of transfers) {
        const val = t.value;
        if (val != null) {
          valueUsd = (valueUsd || 0) + Math.abs(typeof val === "number" ? val : parseFloat(val) || 0);
        }
      }
      // Also check fee
      if (attrs.fee?.value != null) {
        // fee is separate, don't add to valueUsd
      }

      return {
        id: tx.id || hash,
        hash,
        chain,
        type: mapTxType(attrs.operation_type || "unknown"),
        status:
          attrs.status === "confirmed"
            ? "confirmed"
            : attrs.status === "pending"
              ? "pending"
              : attrs.status === "failed"
                ? "failed"
                : attrs.status || "confirmed",
        minedAt: attrs.mined_at || new Date().toISOString(),
        valueUsd,
        out: outItem,
        in: inItem,
        explorerUrl: getExplorerUrl(chain, hash),
      };
    });

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("Activity fetch error:", e);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}
