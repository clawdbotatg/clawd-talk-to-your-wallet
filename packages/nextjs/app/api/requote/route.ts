import { NextResponse } from "next/server";

// Refresh a swap quote built by the agent. The transaction card POSTs the
// `requote` descriptor the build tool emitted; the bridge re-runs that one
// tool deterministically (pool pinned — no discovery, no agent turn) and
// returns fresh {data, value, quote, simulation} in ~2s. No CV charge: this
// re-prices a transaction the user already paid a chat turn to build.
export async function POST(req: Request) {
  const bridgeUrl = process.env.DENARAI_BRIDGE_URL;
  if (!bridgeUrl) {
    return NextResponse.json({ error: "requote unavailable" }, { status: 503 });
  }

  let requote: { tool?: string; args?: unknown } | undefined;
  try {
    requote = (await req.json())?.requote;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (requote?.tool !== "buildUniV4Swap" || typeof requote.args !== "object" || requote.args === null) {
    return NextResponse.json({ error: "unsupported requote" }, { status: 400 });
  }

  try {
    const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/requote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Secret": process.env.DENARAI_BRIDGE_SECRET || "",
      },
      body: JSON.stringify({ tool: requote.tool, args: requote.args }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.warn(`[requote] bridge unreachable (${e instanceof Error ? e.message : String(e)})`);
    return NextResponse.json({ error: "bridge unreachable" }, { status: 503 });
  }
}
