import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "8GVG8WjDs-sGFRr6Rm839";
const WETH_MAINNET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const ETH_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const NETWORK_MAP: Record<number, string> = {
  1: "eth-mainnet",
  8453: "base-mainnet",
  42161: "arb-mainnet",
  10: "opt-mainnet",
  137: "polygon-mainnet",
};

function alchemyUrl(chainId: number): string {
  const network = NETWORK_MAP[chainId] || "eth-mainnet";
  return `https://${network}.g.alchemy.com/v2/${ALCHEMY_KEY}`;
}

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toHex(value: bigint): string {
  return "0x" + value.toString(16);
}

function padUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

const intentTools = {
  simulateAssetChanges: tool({
    description:
      "Simulate a transaction via Alchemy to see exactly what assets leave/enter the wallet. ALWAYS use this to verify every transaction before returning it to the user.",
    inputSchema: z.object({
      from: z.string().describe("Sender address"),
      to: z.string().describe("Target contract address"),
      data: z.string().describe("Calldata hex string"),
      value: z.string().optional().describe("ETH value in hex (e.g. '0x0')"),
      chainId: z.number().optional().describe("Chain ID (default 1)"),
    }),
    execute: async ({ from, to, data, value, chainId }) => {
      const chain = chainId ?? 1;
      try {
        const res = await fetch(alchemyUrl(chain), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "alchemy_simulateAssetChanges",
            params: [{ from, to, data, value: value || "0x0" }],
          }),
        });
        const json = await res.json();
        if (json.error) {
          return { success: false, error: json.error.message || JSON.stringify(json.error), changes: [] };
        }
        const result = json.result;
        if (!result) {
          return { success: false, error: "No result from simulation", changes: [] };
        }
        if (result.error) {
          return { success: false, error: result.error.message || result.error, changes: result.changes || [] };
        }
        const changes = (result.changes || []).map(
          (c: {
            changeType: string;
            symbol: string;
            amount: string;
            rawAmount: string;
            decimals: number;
            assetType: string;
            contractAddress?: string;
          }) => ({
            direction: c.changeType === "TRANSFER" ? "out" : c.changeType,
            symbol: c.symbol,
            amount: c.amount,
            rawAmount: c.rawAmount,
            decimals: c.decimals,
            assetType: c.assetType,
            contractAddress: c.contractAddress,
          }),
        );
        return { success: true, changes };
      } catch (e) {
        return {
          success: false,
          error: `Simulation failed: ${e instanceof Error ? e.message : String(e)}`,
          changes: [],
        };
      }
    },
  }),

  traceCall: tool({
    description:
      "Full EVM execution trace via debug_traceCall. Use when simulateAssetChanges shows unexpected results or the user asks why something failed. Detects unexpected contract calls, revert reasons, and unlimited approvals.",
    inputSchema: z.object({
      from: z.string().describe("Sender address"),
      to: z.string().describe("Target contract address"),
      data: z.string().describe("Calldata hex string"),
      value: z.string().optional().describe("ETH value in hex"),
      chainId: z.number().optional().describe("Chain ID (default 1)"),
    }),
    execute: async ({ from, to, data, value, chainId }) => {
      const chain = chainId ?? 1;
      try {
        const res = await fetch(alchemyUrl(chain), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "debug_traceCall",
            params: [{ from, to, data, value: value || "0x0" }, "latest", { tracer: "callTracer" }],
          }),
        });
        const json = await res.json();
        if (json.error) {
          return {
            success: false,
            revertReason: json.error.message || JSON.stringify(json.error),
            gasUsed: "0x0",
            internalCalls: [],
            hasUnlimitedApproval: false,
          };
        }
        const result = json.result;
        const success = !result.error;
        const revertReason = result.error || undefined;
        const gasUsed = result.gasUsed || "0x0";

        // Parse internal calls from callTracer result
        const internalCalls: { to: string; input: string; value: string }[] = [];
        let hasUnlimitedApproval = false;

        const MAX_UINT256 = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

        function walkCalls(calls: { to?: string; input?: string; value?: string; calls?: unknown[] }[]) {
          for (const call of calls) {
            if (call.to) {
              internalCalls.push({
                to: call.to,
                input: (call.input || "0x").slice(0, 74), // first 10 chars = selector + first param
                value: call.value || "0x0",
              });
            }
            // Check for unlimited approval (approve with max uint256)
            if (call.input && call.input.startsWith("0x095ea7b3") && call.input.includes(MAX_UINT256)) {
              hasUnlimitedApproval = true;
            }
            if (call.calls && Array.isArray(call.calls)) {
              walkCalls(call.calls as { to?: string; input?: string; value?: string; calls?: unknown[] }[]);
            }
          }
        }

        if (result.calls && Array.isArray(result.calls)) {
          walkCalls(result.calls);
        }

        return {
          success,
          revertReason,
          gasUsed,
          internalCalls: internalCalls.slice(0, 20), // cap to keep response manageable
          hasUnlimitedApproval,
        };
      } catch (e) {
        return {
          success: false,
          revertReason: `Trace failed: ${e instanceof Error ? e.message : String(e)}`,
          gasUsed: "0x0",
          internalCalls: [],
          hasUnlimitedApproval: false,
        };
      }
    },
  }),

  getPortfolio: tool({
    description:
      "Get all token balances for the user's wallet across all chains. Use this to answer balance questions and to find token addresses the user holds.",
    inputSchema: z.object({
      address: z.string().describe("The wallet address to look up"),
    }),
    execute: async ({ address }) => {
      try {
        const res = await fetch(`${BASE_URL}/api/portfolio?address=${address}`);
        const data = await res.json();
        return data;
      } catch (e) {
        return { error: `Failed to fetch portfolio: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  buildSwap: tool({
    description:
      "Build swap calldata via Enso Finance. Works on most EVM chains. After getting calldata, the AI MUST call simulateAssetChanges to verify before returning.",
    inputSchema: z.object({
      fromToken: z
        .string()
        .describe("Input token address (use 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for native ETH)"),
      toToken: z.string().describe("Output token address"),
      amountIn: z.string().describe("Amount in wei (raw units, not decimal)"),
      chainId: z.number().describe("Chain ID (1=mainnet, 8453=Base, etc.)"),
      fromAddress: z.string().describe("The sender/user wallet address"),
    }),
    execute: async ({ fromToken, toToken, amountIn, chainId, fromAddress }) => {
      const url = `https://api.enso.finance/api/v1/shortcuts/route?chainId=${chainId}&fromAddress=${fromAddress}&receiver=${fromAddress}&spender=${fromAddress}&amountIn=${amountIn}&tokenIn=${fromToken}&tokenOut=${toToken}&routingStrategy=router`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const errText = await res.text();
          return { error: `Enso API error (${res.status}): ${errText}` };
        }
        const data = await res.json();
        if (data.tx) {
          return {
            to: data.tx.to as string,
            data: data.tx.data as string,
            value: (data.tx.value as string) || "0x0",
            chainId,
          };
        }
        return { error: "No transaction returned from Enso", rawResponse: JSON.stringify(data).slice(0, 500) };
      } catch (e) {
        return { error: `Failed to fetch Enso route: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  buildBridge: tool({
    description:
      "Build bridge calldata via LI.FI for cross-chain transfers. After getting calldata, the AI MUST call simulateAssetChanges to verify before returning.",
    inputSchema: z.object({
      fromChain: z.number().describe("Source chain ID"),
      toChain: z.number().describe("Destination chain ID"),
      fromToken: z.string().describe("Source token address"),
      toToken: z.string().describe("Destination token address"),
      fromAmount: z.string().describe("Amount in wei (raw units)"),
      fromAddress: z.string().describe("Sender wallet address"),
    }),
    execute: async ({ fromChain, toChain, fromToken, toToken, fromAmount, fromAddress }) => {
      const url = `https://li.quest/v1/quote?fromChain=${fromChain}&toChain=${toChain}&fromToken=${fromToken}&toToken=${toToken}&fromAmount=${fromAmount}&fromAddress=${fromAddress}&slippage=0.005`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const errText = await res.text();
          return { error: `LI.FI API error (${res.status}): ${errText}` };
        }
        const data = await res.json();
        if (data.transactionRequest) {
          return {
            to: data.transactionRequest.to as string,
            data: data.transactionRequest.data as string,
            value: (data.transactionRequest.value as string) || "0x0",
            chainId: fromChain,
          };
        }
        return { error: "No transactionRequest in LI.FI response", rawResponse: JSON.stringify(data).slice(0, 500) };
      } catch (e) {
        return { error: `Failed to fetch LI.FI quote: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  buildTransfer: tool({
    description:
      "Build ETH or ERC-20 transfer calldata. For ETH: simple value transfer. For ERC-20: encodes transfer(address,uint256). Returns raw tx object.",
    inputSchema: z.object({
      to: z.string().describe("Recipient address (0x...)"),
      amount: z.string().describe("Amount in wei (raw units)"),
      token: z.string().describe("'ETH' for native ETH, or the ERC-20 contract address"),
      fromAddress: z.string().describe("Sender wallet address"),
      chainId: z.number().optional().describe("Chain ID (default 1)"),
    }),
    execute: async ({ to, amount, token, chainId }) => {
      const chain = chainId ?? 1;
      if (token.toUpperCase() === "ETH") {
        return {
          to,
          data: "0x",
          value: toHex(BigInt(amount)),
          chainId: chain,
        };
      }
      // ERC-20 transfer(address,uint256) = 0xa9059cbb
      const data = "0xa9059cbb" + padAddress(to) + padUint256(BigInt(amount));
      return {
        to: token,
        data,
        value: "0x0",
        chainId: chain,
      };
    },
  }),

  resolveENS: tool({
    description: "Resolve an ENS name to an Ethereum address.",
    inputSchema: z.object({
      name: z.string().describe("ENS name to resolve, e.g. 'vitalik.eth'"),
    }),
    execute: async ({ name }) => {
      try {
        const res = await fetch(`https://api.ensideas.com/ens/resolve/${name}`);
        if (!res.ok) {
          return { error: `ENS resolution failed (${res.status})` };
        }
        const data = await res.json();
        return {
          address: data.address as string,
          name: data.name as string,
          displayName: data.displayName as string,
          avatar: data.avatar as string,
        };
      } catch (e) {
        return { error: `Failed to resolve ENS: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  getTokenAddress: tool({
    description:
      "Look up a token's contract address by symbol on a given chain. Checks well-known addresses first, then searches Enso Finance token list.",
    inputSchema: z.object({
      symbol: z.string().describe("Token symbol, e.g. 'USDC', 'WETH'"),
      chainId: z.number().describe("Chain ID to search on"),
    }),
    execute: async ({ symbol, chainId }) => {
      const upper = symbol.toUpperCase();

      // Well-known hardcoded addresses
      if (upper === "ETH") {
        return { address: ETH_PLACEHOLDER, decimals: 18, name: "Ether" };
      }
      if (upper === "WETH") {
        if (chainId === 1) return { address: WETH_MAINNET, decimals: 18, name: "Wrapped Ether" };
        if (chainId === 8453) return { address: WETH_BASE, decimals: 18, name: "Wrapped Ether" };
      }
      if (upper === "USDC" && chainId === 1) {
        return { address: USDC_MAINNET, decimals: 6, name: "USD Coin" };
      }

      // Search Enso Finance token list
      try {
        const url = `https://api.enso.finance/api/v1/tokens?chainId=${chainId}&search=${encodeURIComponent(symbol)}&limit=5`;
        const res = await fetch(url);
        if (!res.ok) {
          return { error: `Token search failed (${res.status})` };
        }
        const tokens = await res.json();
        if (Array.isArray(tokens) && tokens.length > 0) {
          // Find exact symbol match first, then fall back to first result
          const exact = tokens.find((t: { symbol: string }) => t.symbol.toUpperCase() === upper);
          const token = exact || tokens[0];
          return {
            address: token.address as string,
            decimals: token.decimals as number,
            name: token.name as string,
          };
        }
        return { error: `Token '${symbol}' not found on chain ${chainId}` };
      } catch (e) {
        return { error: `Token search failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  wrapEth: tool({
    description: "Wrap ETH to WETH. Returns transaction calldata for WETH deposit().",
    inputSchema: z.object({
      amount: z.string().describe("Amount in wei"),
      chainId: z.number().optional().describe("Chain ID (default 1)"),
    }),
    execute: async ({ amount, chainId }) => {
      const chain = chainId ?? 1;
      const wethAddr = chain === 8453 ? WETH_BASE : WETH_MAINNET;
      return {
        to: wethAddr,
        data: "0xd0e30db0",
        value: toHex(BigInt(amount)),
        chainId: chain,
      };
    },
  }),

  unwrapWeth: tool({
    description: "Unwrap WETH to ETH. Returns transaction calldata for WETH withdraw().",
    inputSchema: z.object({
      amount: z.string().describe("Amount in wei"),
      chainId: z.number().optional().describe("Chain ID (default 1)"),
    }),
    execute: async ({ amount, chainId }) => {
      const chain = chainId ?? 1;
      const wethAddr = chain === 8453 ? WETH_BASE : WETH_MAINNET;
      return {
        to: wethAddr,
        data: "0x2e1a7d4d" + padUint256(BigInt(amount)),
        value: "0x0",
        chainId: chain,
      };
    },
  }),
};

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an Ethereum transaction intent engine. You translate plain English requests into verified, ready-to-sign transactions.

AVAILABLE TOOLS:
- simulateAssetChanges: Simulate a tx to see exact asset changes. USE THIS to verify every transaction before returning it.
- traceCall: Full EVM trace. Use when simulateAssetChanges shows unexpected results or the user asks why something failed.
- getPortfolio: Get user's current balances across all chains.
- buildSwap: Build swap calldata via Enso Finance (works on most EVM chains).
- buildBridge: Build bridge calldata via LI.FI (cross-chain).
- buildTransfer: Build ETH or ERC-20 transfer calldata.
- resolveENS: Resolve ENS name to address.
- getTokenAddress: Look up token contract address by symbol.
- wrapEth: Wrap ETH to WETH.
- unwrapWeth: Unwrap WETH to ETH.

MANDATORY WORKFLOW:
1. If you need balance info → call getPortfolio first
2. Resolve any ENS names → call resolveENS
3. Look up unknown token addresses → call getTokenAddress
4. Build the transaction calldata (buildSwap / buildBridge / buildTransfer / wrapEth / unwrapWeth)
5. ALWAYS call simulateAssetChanges on the built calldata before returning
6. If simulation shows unexpected results → call traceCall to diagnose
7. Only return the transaction if simulation confirms the expected asset changes

RESPONSE FORMAT (after all tool calls complete):
Return JSON with this exact structure:
{
  "transactions": [{ "to": "0x...", "data": "0x...", "value": "0x...", "chainId": 1 }],
  "description": "One plain English sentence",
  "effects": { "send": "0.1 ETH", "receive": "198 USDC" },
  "simulation": { "verified": true, "changes": [...] }
}

RULES:
- Never invent token addresses — always look them up or use hardcoded well-known ones
- Never return a transaction that failed simulation
- Amount conversions: always work in wei internally, display in human units
- For ETH: use address 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE in DEX contexts
- WETH on mainnet: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
- WETH on Base: 0x4200000000000000000000000000000000000006
- USDC on mainnet: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (6 decimals!)
- All amountIn/fromAmount/amount parameters for buildSwap, buildBridge, buildTransfer, wrapEth, unwrapWeth expect wei (raw units). Convert from human-readable first.
- If the user's request is unclear, ask for clarification
- If simulation fails, explain why and do NOT return the transaction`;

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { message, address, portfolio, chainId } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const userChainId = chainId ?? 1;

    const portfolioSummary = portfolio?.length
      ? `\n\nUser's current portfolio:\n${(
          portfolio as {
            tokenSymbol: string;
            balance: string;
            balanceUsd: string;
            blockchain: string;
            contractAddress?: string;
          }[]
        )
          .slice(0, 30)
          .map(
            a =>
              `- ${a.tokenSymbol}: ${a.balance} (~$${parseFloat(a.balanceUsd).toFixed(2)}) on ${a.blockchain}${a.contractAddress ? ` [${a.contractAddress}]` : ""}`,
          )
          .join("\n")}`
      : "";

    const userPrompt = `User wallet: ${address}\nConnected chain ID: ${userChainId}${portfolioSummary}\n\nUser says: "${message}"`;

    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: intentTools,
      stopWhen: stepCountIs(10),
    });

    // Try to parse the AI's final text as JSON (the structured response)
    let parsed: Record<string, unknown> | null = null;
    if (result.text) {
      // Extract JSON from the response (may be wrapped in markdown code block)
      const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/) || result.text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          // not valid JSON, fall through
        }
      }
    }

    if (parsed && parsed.transactions) {
      return NextResponse.json({
        ...parsed,
        aiMessage: result.text,
      });
    }

    // Fallback: scan tool results for transaction data and simulation data
    type TxData = { to: string; data: string; value: string; chainId: number };
    type SimResult = { success: boolean; changes: unknown[]; error?: string };

    let lastTx: TxData | null = null;
    let lastSim: SimResult | null = null;

    for (const step of result.steps) {
      for (const toolResult of step.toolResults) {
        const r = (toolResult as unknown as { output: Record<string, unknown> }).output;
        if (r && typeof r.to === "string" && typeof r.data === "string") {
          lastTx = r as unknown as TxData;
        }
        if (r && typeof r.success === "boolean" && Array.isArray(r.changes)) {
          lastSim = r as unknown as SimResult;
        }
      }
    }

    if (lastTx) {
      // Build effects from simulation changes
      interface SimChange {
        direction: string;
        amount: string;
        symbol: string;
      }
      const simChanges = (lastSim?.changes || []) as SimChange[];
      const outChange = simChanges.find(c => c.direction === "out");
      const inChange = simChanges.find(c => c.direction === "in");
      const effects = {
        send: outChange ? `${outChange.amount} ${outChange.symbol}` : "",
        receive: inChange ? `${inChange.amount} ${inChange.symbol}` : "",
      };

      return NextResponse.json({
        transactions: [lastTx],
        description: result.text || "Transaction ready",
        effects,
        simulation: { verified: !!lastSim?.success, changes: lastSim?.changes || [] },
        aiMessage: result.text,
      });
    }

    // No transaction built — AI responded with text only
    return NextResponse.json({
      error: result.text || "Could not build a transaction for this request.",
      aiMessage: result.text,
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Intent API error:", error);
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
