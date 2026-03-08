import { NextRequest, NextResponse } from "next/server";

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";

// Chain ID → Alchemy RPC base URL
function alchemyUrl(chainId: number): string {
  const urls: Record<number, string> = {
    1: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    8453: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    42161: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    10: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    137: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  };
  return urls[chainId] || urls[1];
}

function formatAmount(raw: string, decimals: number): string {
  const val = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = val / divisor;
  const frac = val % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export async function POST(req: NextRequest) {
  try {
    const { calldata, address, chainId = 1 } = await req.json();

    if (!calldata?.to || !address) {
      return NextResponse.json({ error: "calldata.to and address required" }, { status: 400 });
    }

    if (!ALCHEMY_KEY) {
      return NextResponse.json({ error: "ALCHEMY_API_KEY not configured" }, { status: 500 });
    }

    const rpcUrl = alchemyUrl(chainId);

    // Build the transaction object for simulation
    const txParams: Record<string, string> = {
      from: address,
      to: calldata.to,
      data: calldata.data || "0x",
    };
    if (calldata.value && calldata.value !== "0x0" && calldata.value !== "0x") {
      txParams.value = calldata.value;
    }

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_simulateAssetChanges",
        params: [txParams],
      }),
    });

    const data = await res.json();

    if (data.error) {
      // Simulation failed — return a warning but don't block
      return NextResponse.json({
        safe: false,
        explanation: "Could not simulate transaction",
        warnings: [data.error.message || "Simulation failed"],
        changes: [],
      });
    }

    const result = data.result;
    const changes: { type: string; symbol: string; amount: string; logo: string; direction: "in" | "out" }[] = [];

    for (const change of result.changes || []) {
      const direction = change.changeType === "RECEIVE" ? "in" : "out";
      let amount = "?";

      if (change.rawAmount && change.decimals != null) {
        try {
          amount = formatAmount(change.rawAmount, change.decimals);
        } catch {
          amount = change.amount || "?";
        }
      } else {
        amount = change.amount || "?";
      }

      changes.push({
        type: change.assetType, // "NATIVE" | "ERC20" | "ERC721" | "ERC1155"
        symbol: change.symbol || change.name || "???",
        amount,
        logo: change.logo || "",
        direction,
      });
    }

    // Determine safety: if simulation succeeded and no errors, it's safe
    const safe = !result.error;
    const warnings: string[] = result.error ? [result.error] : [];

    // Build human-readable explanation from changes
    const outChanges = changes.filter(c => c.direction === "out");
    const inChanges = changes.filter(c => c.direction === "in");

    let explanation = "";
    if (outChanges.length && inChanges.length) {
      explanation = `${outChanges.map(c => `-${c.amount} ${c.symbol}`).join(", ")} → ${inChanges.map(c => `+${c.amount} ${c.symbol}`).join(", ")}`;
    } else if (outChanges.length) {
      explanation = outChanges.map(c => `Send ${c.amount} ${c.symbol}`).join(", ");
    } else if (inChanges.length) {
      explanation = inChanges.map(c => `Receive ${c.amount} ${c.symbol}`).join(", ");
    } else {
      explanation = "No asset changes detected";
    }

    return NextResponse.json({ safe, explanation, warnings, changes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
