import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase();
const DEPOSIT_SELECTOR = "0xd0e30db0";
const WITHDRAW_SELECTOR = "0x2e1a7d4d";

const SYSTEM_PROMPT = `You are an Ethereum transaction security reviewer.

Return ONLY valid JSON (no markdown):
{
  "safe": true/false,
  "explanation": "<one short sentence, plain English, no tech jargon — e.g. 'Wraps 0.01 ETH into 0.01 WETH'>",
  "warnings": ["<only include if something is actually wrong, empty array if safe>"]
}

Rules for explanation: max 10 words, describe the real-world effect only. No mention of selectors, contracts, addresses, or functions.`;

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

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    // Strip markdown code fences if model wraps output in ```json ... ```
    const text = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
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
