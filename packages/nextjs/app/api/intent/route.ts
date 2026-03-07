import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const SYSTEM_PROMPT = `You are an Ethereum transaction intent parser. You ONLY handle WETH wrap/unwrap operations on mainnet.

WETH Contract: ${WETH_ADDRESS}
- deposit() — payable function, selector 0xd0e30db0. Send ETH as msg.value to wrap into WETH.
- withdraw(uint256 wad) — selector 0x2e1a7d4d. Burns WETH and returns ETH.

Given a user message, their wallet address, ETH balance, and WETH balance, return ONLY valid JSON (no markdown, no explanation outside JSON):

{
  "action": "wrap" | "unwrap",
  "amount": "<amount in ETH as decimal string, e.g. '0.5'>",
  "calldata": {
    "to": "${WETH_ADDRESS}",
    "data": "<hex encoded calldata>",
    "value": "<wei value as hex string, '0x0' for unwrap>"
  },
  "explanation": "<one sentence describing what this does>"
}

For wrap: data = "0xd0e30db0" (deposit selector), value = amount in wei as hex
For unwrap: data = "0x2e1a7d4d" + uint256 amount in wei (padded to 32 bytes), value = "0x0"

Convert ETH amounts to wei: 1 ETH = 1000000000000000000 wei (1e18).
Express wei as hex for the value field.

If the user's request is unclear or not a wrap/unwrap, return:
{"error": "I can only help with wrapping ETH to WETH or unwrapping WETH to ETH."}`;

export async function POST(req: NextRequest) {
  try {
    const { message, address, ethBalance, wethBalance } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const userPrompt = `User wallet: ${address}
ETH Balance: ${ethBalance} ETH
WETH Balance: ${wethBalance} WETH

User says: "${message}"`;

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(text);

    return NextResponse.json(parsed);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
