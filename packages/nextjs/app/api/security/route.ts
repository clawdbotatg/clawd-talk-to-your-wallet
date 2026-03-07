import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase();
const DEPOSIT_SELECTOR = "0xd0e30db0";
const WITHDRAW_SELECTOR = "0x2e1a7d4d";

const SYSTEM_PROMPT = `You are an Ethereum transaction security reviewer. You analyze proposed transaction calldata and explain what it does in plain English.

Known safe contract:
- WETH (Wrapped Ether): 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
  - deposit() selector: 0xd0e30db0 — wraps ETH into WETH
  - withdraw(uint256) selector: 0x2e1a7d4d — unwraps WETH back to ETH

Return ONLY valid JSON (no markdown):
{
  "safe": true/false,
  "explanation": "<plain English explanation of what this transaction does>",
  "warnings": ["<any warnings, empty array if none>"]
}

Check:
1. Is the "to" address the real WETH contract?
2. Is the function selector correct for the stated action?
3. Does the amount in the calldata match what was requested?
4. Are there any red flags?`;

export async function POST(req: NextRequest) {
  try {
    const { calldata, action, amount } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    // Quick local checks first
    const warnings: string[] = [];
    let safe = true;

    if (calldata.to.toLowerCase() !== WETH_ADDRESS) {
      safe = false;
      warnings.push(`Target address ${calldata.to} is NOT the WETH contract!`);
    }

    if (action === "wrap" && !calldata.data.startsWith(DEPOSIT_SELECTOR)) {
      safe = false;
      warnings.push(`Function selector does not match deposit() for wrap action`);
    }

    if (action === "unwrap" && !calldata.data.startsWith(WITHDRAW_SELECTOR)) {
      safe = false;
      warnings.push(`Function selector does not match withdraw() for unwrap action`);
    }

    // Also get AI explanation
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Proposed transaction:
- to: ${calldata.to}
- data: ${calldata.data}
- value: ${calldata.value}
- Stated action: ${action}
- Stated amount: ${amount} ${action === "wrap" ? "ETH" : "WETH"}

Analyze this transaction for safety.`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const aiResult = JSON.parse(text);

    // Merge local checks with AI analysis
    return NextResponse.json({
      safe: safe && aiResult.safe,
      explanation: aiResult.explanation,
      warnings: [...warnings, ...aiResult.warnings],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
