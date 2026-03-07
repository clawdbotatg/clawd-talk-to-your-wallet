import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ALCHEMY_URL = "https://eth-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839";

// Cache building-blocks skill in module scope
let cachedBuildingBlocksSkill: string | null = null;
async function getBuildingBlocksSkill(): Promise<string> {
  if (cachedBuildingBlocksSkill) return cachedBuildingBlocksSkill;
  try {
    const res = await fetch("https://ethskills.com/building-blocks/SKILL.md");
    if (res.ok) {
      cachedBuildingBlocksSkill = await res.text();
      return cachedBuildingBlocksSkill;
    }
  } catch {
    // ignore fetch errors
  }
  return "";
}

function toWei(amount: string, decimals = 18): bigint {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  let fraction = parts[1] || "";
  if (fraction.length > decimals) {
    fraction = fraction.slice(0, decimals);
  }
  while (fraction.length < decimals) {
    fraction += "0";
  }
  return BigInt(whole + fraction);
}

function toHex(value: bigint): string {
  return "0x" + value.toString(16);
}

function padUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

const PORTFOLIO_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

// Tool definitions for the AI agent using v6 API (inputSchema instead of parameters)
const intentTools = {
  getPortfolio: tool({
    description:
      "Get all token balances for the user's wallet address. Use this to answer questions about what tokens they hold, their ETH balance, or any balance-related question.",
    inputSchema: z.object({
      address: z.string().describe("The wallet address to look up"),
    }),
    execute: async ({ address }) => {
      try {
        const res = await fetch(`${PORTFOLIO_URL}/api/portfolio?address=${address}`);
        const data = await res.json();
        return data;
      } catch (e) {
        return { error: `Failed to fetch portfolio: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  wrapEth: tool({
    description: "Wraps ETH to WETH on Ethereum mainnet. Returns transaction calldata for WETH deposit().",
    inputSchema: z.object({
      amount: z.string().describe("ETH amount as a decimal string, e.g. '0.5'"),
    }),
    execute: async ({ amount }) => {
      const weiAmount = toWei(amount);
      return {
        transactions: [
          {
            to: WETH_ADDRESS,
            data: "0xd0e30db0",
            value: toHex(weiAmount),
            chainId: 1,
          },
        ],
        description: `Wrap ${amount} ETH into WETH`,
        effects: {
          send: `${amount} ETH`,
          receive: `${amount} WETH`,
        },
      };
    },
  }),

  unwrapWeth: tool({
    description: "Unwraps WETH to ETH on Ethereum mainnet. Returns transaction calldata for WETH withdraw().",
    inputSchema: z.object({
      amount: z.string().describe("WETH amount as a decimal string, e.g. '0.5'"),
    }),
    execute: async ({ amount }) => {
      const weiAmount = toWei(amount);
      return {
        transactions: [
          {
            to: WETH_ADDRESS,
            data: "0x2e1a7d4d" + padUint256(weiAmount),
            value: "0x0",
            chainId: 1,
          },
        ],
        description: `Unwrap ${amount} WETH into ETH`,
        effects: {
          send: `${amount} WETH`,
          receive: `${amount} ETH`,
        },
      };
    },
  }),

  buildTransfer: tool({
    description:
      "Build a transaction to send ETH or an ERC-20 token to an address. For ETH, uses a simple value transfer. For ERC-20, encodes transfer(address,uint256).",
    inputSchema: z.object({
      to: z.string().describe("Recipient address (0x...)"),
      amount: z.string().describe("Amount as a decimal string"),
      token: z.string().describe("'ETH' for native ETH, or the ERC-20 contract address"),
      decimals: z.number().optional().describe("Token decimals (default 18)"),
    }),
    execute: async ({ to, amount, token, decimals }) => {
      const tokenDecimals = decimals ?? 18;
      if (token.toUpperCase() === "ETH") {
        const weiAmount = toWei(amount);
        return {
          transactions: [
            {
              to,
              data: "0x",
              value: toHex(weiAmount),
              chainId: 1,
            },
          ],
          description: `Send ${amount} ETH to ${to}`,
          effects: {
            send: `${amount} ETH`,
            receive: `${to} receives ${amount} ETH`,
          },
        };
      }

      const weiAmount = toWei(amount, tokenDecimals);
      const data = "0xa9059cbb" + padAddress(to) + padUint256(weiAmount);
      return {
        transactions: [
          {
            to: token,
            data,
            value: "0x0",
            chainId: 1,
          },
        ],
        description: `Send ${amount} tokens to ${to}`,
        effects: {
          send: `${amount} tokens`,
          receive: `${to} receives the tokens`,
        },
      };
    },
  }),

  buildSwap: tool({
    description:
      "Build a swap transaction via Enso Finance routing. Swaps one token for another on the specified chain.",
    inputSchema: z.object({
      fromToken: z
        .string()
        .describe("Input token address (use 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee for native ETH)"),
      toToken: z.string().describe("Output token address"),
      amount: z.string().describe("Amount as a decimal string"),
      chainId: z.number().describe("Chain ID (1 for mainnet, 8453 for Base, etc.)"),
      fromAddress: z.string().describe("The sender/user wallet address"),
      decimals: z.number().optional().describe("Input token decimals (default 18)"),
    }),
    execute: async ({ fromToken, toToken, amount, chainId, fromAddress, decimals }) => {
      const tokenDecimals = decimals ?? 18;
      const amountInWei = toWei(amount, tokenDecimals).toString();
      const url = `https://api.enso.finance/api/v1/shortcuts/route?chainId=${chainId}&fromAddress=${fromAddress}&receiver=${fromAddress}&spender=${fromAddress}&amountIn=${amountInWei}&tokenIn=${fromToken}&tokenOut=${toToken}&routingStrategy=router`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          const errText = await res.text();
          return { error: `Enso API error (${res.status}): ${errText}` };
        }
        const data = await res.json();
        if (data.tx) {
          return {
            transactions: [
              {
                to: data.tx.to as string,
                data: data.tx.data as string,
                value: (data.tx.value as string) || "0x0",
                chainId,
              },
            ],
            description: `Swap ${amount} tokens via Enso`,
            effects: {
              send: `${amount} input tokens`,
              receive: `output tokens`,
            },
          };
        }
        return { error: "No transaction returned from Enso", rawResponse: JSON.stringify(data) };
      } catch (e) {
        return { error: `Failed to fetch Enso route: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  buildBridge: tool({
    description: "Bridge tokens cross-chain via LI.FI. Moves tokens from one chain to another.",
    inputSchema: z.object({
      fromChain: z.number().describe("Source chain ID"),
      toChain: z.number().describe("Destination chain ID"),
      fromToken: z.string().describe("Source token address"),
      toToken: z.string().describe("Destination token address"),
      amount: z.string().describe("Amount as a decimal string"),
      fromAddress: z.string().describe("Sender wallet address"),
      decimals: z.number().optional().describe("Token decimals (default 18)"),
    }),
    execute: async ({ fromChain, toChain, fromToken, toToken, amount, fromAddress, decimals }) => {
      const tokenDecimals = decimals ?? 18;
      const amountInWei = toWei(amount, tokenDecimals).toString();
      const url = `https://li.quest/v1/quote?fromChain=${fromChain}&toChain=${toChain}&fromToken=${fromToken}&toToken=${toToken}&fromAmount=${amountInWei}&fromAddress=${fromAddress}`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          const errText = await res.text();
          return { error: `LI.FI API error (${res.status}): ${errText}` };
        }
        const data = await res.json();
        if (data.transactionRequest) {
          return {
            transactions: [
              {
                to: data.transactionRequest.to as string,
                data: data.transactionRequest.data as string,
                value: (data.transactionRequest.value as string) || "0x0",
                chainId: fromChain,
              },
            ],
            description: `Bridge ${amount} tokens from chain ${fromChain} to chain ${toChain}`,
            effects: {
              send: `${amount} tokens on chain ${fromChain}`,
              receive: `tokens on chain ${toChain}`,
            },
          };
        }
        return { error: "No transactionRequest in LI.FI response", rawResponse: JSON.stringify(data) };
      } catch (e) {
        return { error: `Failed to fetch LI.FI quote: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  resolveEns: tool({
    description: "Resolve an ENS name to an Ethereum address.",
    inputSchema: z.object({
      name: z.string().describe("ENS name to resolve, e.g. 'vitalik.eth'"),
    }),
    execute: async ({ name }) => {
      try {
        const res = await fetch(`https://api.ensideas.com/ens/resolve/${name}`);
        if (!res.ok) {
          // Fallback to Alchemy
          const alchemyRes = await fetch(ALCHEMY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "eth_call",
              params: [
                {
                  to: "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41",
                  data: "0x3b3b57de" + padUint256(BigInt("0x" + Buffer.from(name).toString("hex"))),
                },
                "latest",
              ],
              id: 1,
            }),
          });
          const alchemyData = await alchemyRes.json();
          return { address: alchemyData.result as string, name };
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
};

const BASE_SYSTEM_PROMPT = `You are an Ethereum transaction intent engine. You help users execute DeFi operations by understanding their plain English requests and building the correct transaction calldata.

You have access to tools to look up data and build transactions. Always use tools to get current data — never guess balances, prices, or addresses.

CRITICAL RULES:
- Never return a transaction you are not confident is correct
- Always verify the target contract address
- For swaps/bridges, always use the tools — never construct swap calldata manually
- If a user mentions an ENS name, resolve it first using the resolveEns tool
- For native ETH in swap/bridge tools, use address 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
- USDC on mainnet: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (6 decimals!)
- WETH on mainnet: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2

When you have built the transaction(s) using tools, respond with a final summary of what the transaction does. The tool results contain the structured transaction data that will be returned to the user.

If the user's request is unclear, ask for clarification. If you cannot build the transaction safely, explain why.`;

export async function POST(req: NextRequest) {
  try {
    const { message, address, portfolio } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    // Load building-blocks skill for context
    const buildingBlocksSkill = await getBuildingBlocksSkill();

    const systemPrompt = [
      BASE_SYSTEM_PROMPT,
      buildingBlocksSkill ? `\n\n--- DeFi Reference ---\n${buildingBlocksSkill}` : "",
    ].join("");

    const portfolioSummary = portfolio?.length
      ? `\n\nUser's portfolio:\n${(
          portfolio as { tokenSymbol: string; balance: string; balanceUsd: string; blockchain: string }[]
        )
          .slice(0, 20)
          .map(a => `- ${a.tokenSymbol}: ${a.balance} (~$${parseFloat(a.balanceUsd).toFixed(2)}) on ${a.blockchain}`)
          .join("\n")}`
      : "";

    const userPrompt = `User wallet: ${address}${portfolioSummary}\n\nUser says: "${message}"`;

    const result = await generateText({
      model: anthropic("claude-opus-4-5"),
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: intentTools,
      stopWhen: stepCountIs(5),
    });

    // Extract the last tool result that contains transaction data
    type TxResult = {
      transactions?: { to: string; data: string; value: string; chainId: number }[];
      description?: string;
      effects?: { send: string; receive: string };
      error?: string;
    };

    let txResult: TxResult | null = null;
    for (const step of result.steps) {
      for (const toolResult of step.toolResults) {
        // AI SDK v6 uses 'output' instead of 'result'
        const r = (toolResult as unknown as { output: TxResult }).output;
        if (r && r.transactions) {
          txResult = r;
        }
      }
    }

    if (txResult) {
      return NextResponse.json({
        ...txResult,
        aiMessage: result.text,
      });
    }

    // No tool was called — AI responded with text only (clarification or refusal)
    return NextResponse.json({
      error: result.text || "Could not build a transaction for this request.",
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Intent API error:", error);
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
