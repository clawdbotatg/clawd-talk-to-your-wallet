import { NextRequest, NextResponse } from "next/server";

interface AnkrAsset {
  blockchain: string;
  tokenName: string;
  tokenSymbol: string;
  balance: string;
  balanceUsd: string;
  tokenDecimals: number;
  contractAddress: string;
  thumbnail: string;
}

export async function GET(req: NextRequest) {
  try {
    const walletAddress = req.nextUrl.searchParams.get("address");
    if (!walletAddress) {
      return NextResponse.json({ error: "address query param required" }, { status: 400 });
    }

    const response = await fetch("https://rpc.ankr.com/multichain/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "ankr_getAccountBalance",
        params: {
          walletAddress,
          onlyWhitelisted: false,
        },
        id: 1,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Ankr API returned ${response.status}` }, { status: 502 });
    }

    const data = await response.json();

    if (data.error) {
      return NextResponse.json({ error: data.error.message || "Ankr RPC error" }, { status: 502 });
    }

    const result = data.result;
    const totalBalanceUsd: string = result.totalBalanceUsd || "0";

    const assets: AnkrAsset[] = (result.assets || [])
      .map((a: Record<string, unknown>) => ({
        blockchain: a.blockchain as string,
        tokenName: a.tokenName as string,
        tokenSymbol: a.tokenSymbol as string,
        balance: a.balance as string,
        balanceUsd: String(a.balanceUsd ?? "0"),
        tokenDecimals: a.tokenDecimals as number,
        contractAddress: (a.contractAddress as string) || "",
        thumbnail: (a.thumbnail as string) || "",
      }))
      .filter((a: AnkrAsset) => parseFloat(a.balanceUsd) >= 0.01)
      .sort((a: AnkrAsset, b: AnkrAsset) => parseFloat(b.balanceUsd) - parseFloat(a.balanceUsd));

    return NextResponse.json({ totalBalanceUsd, assets });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
