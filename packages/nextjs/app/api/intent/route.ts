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
      "Simulate a transaction via Alchemy to see exactly what assets leave/enter the wallet. ALWAYS use this to verify every transaction before returning it.",
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
      "Full EVM execution trace via debug_traceCall. Use when simulateAssetChanges shows unexpected results or the user asks why something failed.",
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

        const internalCalls: { to: string; input: string; value: string }[] = [];
        let hasUnlimitedApproval = false;
        const MAX_UINT256 = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

        function walkCalls(calls: { to?: string; input?: string; value?: string; calls?: unknown[] }[]) {
          for (const call of calls) {
            if (call.to) {
              internalCalls.push({
                to: call.to,
                input: (call.input || "0x").slice(0, 74),
                value: call.value || "0x0",
              });
            }
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
          internalCalls: internalCalls.slice(0, 20),
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
      "Get all token balances for the user's wallet across all chains, including chain breakdown and total USD value. Use this to answer balance questions and to find token addresses the user holds.",
    inputSchema: z.object({
      address: z.string().describe("The wallet address to look up"),
    }),
    execute: async ({ address }) => {
      try {
        const res = await fetch(`${BASE_URL}/api/portfolio?address=${address}`);
        const data = await res.json();
        return {
          assets: data.assets || [],
          totalBalanceUsd: data.totalBalanceUsd || "0",
          totalPortfolioUsd: data.totalPortfolioUsd || "0",
          chainBreakdown: data.chainBreakdown || {},
          change1dUsd: data.change1dUsd || "0",
          change1dPct: data.change1dPct || "0",
        };
      } catch (e) {
        return { error: `Failed to fetch portfolio: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  getTokenActivity: tool({
    description:
      "Get all transactions involving a specific token symbol or contract address for the user's wallet. Use this when user asks where a token came from, when they got it, or details about a specific token's history.",
    inputSchema: z.object({
      address: z.string(),
      tokenSymbol: z.string().optional().describe("Token symbol to filter by, e.g. 'GNO', 'ETH'"),
      chainId: z.string().optional().describe("e.g. 'xdai', 'base', 'ethereum'"),
    }),
    execute: async ({ address, tokenSymbol, chainId }) => {
      const ZERION_KEY = process.env.ZERION_API_KEY || "";
      const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");

      let url = `https://api.zerion.io/v1/wallets/${address}/transactions/?currency=usd&page[size]=100&sort=-mined_at`;
      if (chainId) url += `&filter[chain_ids]=${chainId}`;

      try {
        const res = await fetch(url, {
          headers: { Authorization: `Basic ${auth}`, accept: "application/json" },
        });
        const data = await res.json();

        const items = (data.data || [])
          .filter((tx: any) => {
            if (!tokenSymbol) return true;
            const transfers = tx.attributes?.transfers || [];
            return transfers.some((t: any) => t.fungible_info?.symbol?.toLowerCase() === tokenSymbol.toLowerCase());
          })
          .slice(0, 20)
          .map((tx: any) => {
            const attrs = tx.attributes;
            const transfers = attrs.transfers || [];
            return {
              date: attrs.mined_at?.slice(0, 10),
              type: attrs.operation_type,
              chain: tx.relationships?.chain?.data?.id,
              transfers: transfers.map((t: any) => ({
                direction: t.direction,
                symbol: t.fungible_info?.symbol,
                amount: t.quantity?.float,
                valueUsd: t.value,
              })),
              hash: attrs.hash,
            };
          });

        return { transactions: items, total: items.length };
      } catch (e) {
        return { error: `Failed to fetch token activity: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  getTransactionDetails: tool({
    description:
      "Look up full details of a specific transaction by hash. Returns sender address, receiver address, value, block number, timestamp, and decoded transfer info. Use this when the user asks WHO sent something, WHERE it came from, or wants any specific transaction detail.",
    inputSchema: z.object({
      hash: z.string().describe("Transaction hash (0x...)"),
      chain: z
        .string()
        .describe(
          "Chain name: 'ethereum', 'base', 'xdai', 'arbitrum', 'optimism', 'polygon', 'binance-smart-chain', 'monad', 'abstract'",
        ),
    }),
    execute: async ({ hash, chain }) => {
      // Map chain name to Zerion transaction endpoint
      const ZERION_KEY = process.env.ZERION_API_KEY || "";
      const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");

      try {
        // Use Zerion transaction endpoint to get full details
        const res = await fetch(`https://api.zerion.io/v1/transactions/${hash}?currency=usd`, {
          headers: { Authorization: `Basic ${auth}`, accept: "application/json" },
        });

        if (res.ok) {
          const data = await res.json();
          const attrs = data.data?.attributes || {};
          const transfers = attrs.transfers || [];
          return {
            hash,
            chain: data.data?.relationships?.chain?.data?.id || chain,
            from: attrs.sent_from,
            to: attrs.sent_to,
            status: attrs.status,
            minedAt: attrs.mined_at,
            fee: attrs.fee,
            transfers: transfers.map((t: any) => ({
              direction: t.direction,
              symbol: t.fungible_info?.symbol,
              name: t.fungible_info?.name,
              amount: t.quantity?.float,
              valueUsd: t.value,
              from: t.sender,
              to: t.recipient,
            })),
            type: attrs.operation_type,
          };
        }

        // Fallback: use Alchemy eth_getTransactionByHash for supported chains
        const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";
        const rpcUrls: Record<string, string> = {
          ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
          base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
          arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
          optimism: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
          polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
        };
        const rpcUrl = rpcUrls[chain];
        if (!rpcUrl) return { error: `Chain ${chain} not supported for direct lookup` };

        const rpcRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getTransactionByHash", params: [hash], id: 1 }),
        });
        const rpcData = await rpcRes.json();
        const tx = rpcData.result;
        if (!tx) return { error: "Transaction not found" };

        return {
          hash,
          chain,
          from: tx.from,
          to: tx.to,
          value: tx.value,
          blockNumber: parseInt(tx.blockNumber, 16),
          gas: parseInt(tx.gas, 16),
        };
      } catch (e) {
        return { error: String(e) };
      }
    },
  }),

  getTokenPrice: tool({
    description: "Get the current USD price and 24h change for a token by symbol.",
    inputSchema: z.object({
      symbol: z.string().describe("Token symbol like ETH, USDC, GNO, etc."),
    }),
    execute: async ({ symbol }) => {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`,
          { headers: { accept: "application/json" } },
        );
        const data = await res.json();
        // Try direct match
        if (data[symbol.toLowerCase()]) {
          return {
            symbol,
            priceUsd: data[symbol.toLowerCase()].usd,
            change24h: data[symbol.toLowerCase()].usd_24h_change,
          };
        }
        // Fallback: search by symbol
        const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${symbol}`);
        const searchData = await searchRes.json();
        const coin = searchData.coins?.[0];
        if (coin) {
          const priceRes = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd&include_24hr_change=true`,
          );
          const priceData = await priceRes.json();
          return {
            symbol,
            name: coin.name,
            priceUsd: priceData[coin.id]?.usd,
            change24h: priceData[coin.id]?.usd_24h_change,
          };
        }
        return { error: "Token not found" };
      } catch (e) {
        return { error: String(e) };
      }
    },
  }),

  getWalletActivity: tool({
    description:
      "Get the user's recent cross-chain transaction history. Use when asked about recent activity, what they've been doing, or to find specific past transactions.",
    inputSchema: z.object({
      address: z.string(),
      limit: z.number().optional().default(20),
    }),
    execute: async ({ address, limit }) => {
      const fetchLimit = limit ?? 20;
      const ZERION_KEY = process.env.ZERION_API_KEY || "";
      const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");
      try {
        const res = await fetch(
          `https://api.zerion.io/v1/wallets/${address}/transactions/?currency=usd&page[size]=${fetchLimit}&sort=-mined_at`,
          { headers: { Authorization: `Basic ${auth}`, accept: "application/json" } },
        );
        const data = await res.json();
        return {
          transactions: (data.data || []).slice(0, fetchLimit).map((tx: any) => {
            const attrs = tx.attributes;
            const transfers = (attrs.transfers || []).map((t: any) => ({
              direction: t.direction,
              symbol: t.fungible_info?.symbol,
              amount: t.quantity?.float?.toFixed(4),
              valueUsd: t.value?.toFixed(2),
            }));
            return {
              date: attrs.mined_at?.slice(0, 10),
              type: attrs.operation_type,
              chain: tx.relationships?.chain?.data?.id,
              status: attrs.status,
              transfers,
              hash: attrs.hash,
            };
          }),
        };
      } catch (e) {
        return { error: `Failed to fetch activity: ${e instanceof Error ? e.message : String(e)}` };
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

      try {
        const url = `https://api.enso.finance/api/v1/tokens?chainId=${chainId}&search=${encodeURIComponent(symbol)}&limit=5`;
        const res = await fetch(url);
        if (!res.ok) {
          return { error: `Token search failed (${res.status})` };
        }
        const tokens = await res.json();
        if (Array.isArray(tokens) && tokens.length > 0) {
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

const SYSTEM_PROMPT = `You are a smart wallet assistant with full visibility into the user's portfolio and transaction history.

YOU ALWAYS HAVE:
- The user's current portfolio (all tokens, all chains, USD values) — injected in context below
- The user's recent 20 transactions — injected in context below
- Tools to look up more detailed history, prices, and to build transactions

WHEN ANSWERING QUESTIONS:
- Use the portfolio/activity context injected below FIRST before calling tools
- For "where did X come from?" → check the activity context for receives of that token. If not visible, call getTokenActivity. Once you have a tx hash, call getTransactionDetails to get the sender address — NEVER say "check a block explorer" when you have a hash
- For "what address sent it?" or "who sent me X?" → call getTransactionDetails with the hash and chain
- For "how is X doing?" → use portfolio data for balance, call getTokenPrice for current price/change
- For "what have I been doing?" → summarize from the activity context
- Be specific: give dates, amounts, chains. Never say "I don't have access to your history"
- Keep answers concise — 2-4 sentences unless they ask for more detail

WHEN TO BUILD A TRANSACTION:
Only when the user clearly wants to execute: "swap", "send", "bridge", "wrap", "buy", "sell"

Chat (just respond in plain English) when the user:
- Asks questions about their portfolio ("how is my GNO doing?", "what's my biggest position?")
- Asks about prices, protocols, or market info
- Wants to understand something ("what is WETH?", "explain Gnosis chain")
- Asks about their transaction history or where a token came from
- Says something ambiguous
- Greets you or makes small talk

RESPONSE RULES:
- For chat: respond in plain English, 2-4 sentences max, conversational tone. Use the portfolio + activity data in context to give specific answers.
- For transactions: use your tools to build + simulate it, then respond with the JSON transaction format
- NEVER show error-like output for simple questions
- NEVER suggest the user "check block explorers" for info you can answer from context or tools
- NEVER say "I don't have access to your transaction history" — you DO

AVAILABLE TOOLS:
- simulateAssetChanges: Simulate a tx to see exact asset changes. USE THIS to verify every transaction.
- traceCall: Full EVM trace for debugging.
- getPortfolio: Get user's current balances across all chains (with chain breakdown and totals).
- getTokenActivity: Get all transactions involving a specific token. Use for "where did X come from?" questions.
- getTransactionDetails: Look up full tx details by hash — sender, receiver, value. Use when you have a hash and need to answer "who sent this?" or "what address?"
- getTokenPrice: Get current USD price and 24h change for any token.
- getWalletActivity: Get recent cross-chain transaction history with full details.
- buildSwap: Build swap calldata via Enso Finance.
- buildBridge: Build bridge calldata via LI.FI (cross-chain).
- buildTransfer: Build ETH or ERC-20 transfer calldata.
- resolveENS: Resolve ENS name to address.
- getTokenAddress: Look up token contract address by symbol.
- wrapEth: Wrap ETH to WETH.
- unwrapWeth: Unwrap WETH to ETH.

MANDATORY WORKFLOW (for transactions only):
1. If you need balance info → call getPortfolio first
2. Resolve any ENS names → call resolveENS
3. Look up unknown token addresses → call getTokenAddress
4. Build the transaction calldata (buildSwap / buildBridge / buildTransfer / wrapEth / unwrapWeth)
5. ALWAYS call simulateAssetChanges on the built calldata before returning
6. If simulation shows unexpected results → call traceCall to diagnose
7. Only return the transaction if simulation confirms the expected asset changes

RESPONSE FORMAT:

For chat responses, return ONLY this JSON:
{
  "type": "chat",
  "message": "your conversational response here"
}

For transaction responses, return ONLY this JSON (after all tool calls complete):
{
  "type": "transaction",
  "message": "I'll swap 0.1 ETH for USDC — here are the details:",
  "transaction": {
    "to": "0x...",
    "data": "0x...",
    "value": "0x...",
    "chainId": 1,
    "description": "Swap 0.1 ETH → ~198 USDC",
    "simulation": { "verified": true, "changes": [{ "direction": "out", "symbol": "ETH", "amount": "0.1" }, { "direction": "in", "symbol": "USDC", "amount": "198.5" }] }
  }
}

RULES:
- Never invent token addresses — always look them up or use hardcoded well-known ones
- Never return a transaction that failed simulation
- Amount conversions: always work in wei internally, display in human units
- For ETH: use address 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE in DEX contexts
- WETH on mainnet: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
- WETH on Base: 0x4200000000000000000000000000000000000006
- USDC on mainnet: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (6 decimals!)
- All amount parameters expect wei (raw units). Convert from human-readable first.
- If the user's request is unclear, respond with a chat message asking for clarification
- If simulation fails, respond with a chat message explaining why`;

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { message, address, portfolio, chainId, recentMessages, recentActivity } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { type: "chat", message: "API key not configured. Please set ANTHROPIC_API_KEY." },
        { status: 500 },
      );
    }

    const userChainId = chainId ?? 1;

    // Build portfolio context
    const portfolioAssets =
      (portfolio as {
        tokenSymbol: string;
        balance: string;
        balanceUsd: string;
        blockchain: string;
        contractAddress?: string;
      }[]) || [];

    const totalUsd = portfolioAssets.reduce((sum, a) => sum + (parseFloat(a.balanceUsd) || 0), 0);
    const portfolioSummary = portfolioAssets.length
      ? `\n\nPortfolio (${portfolioAssets.length} assets, total $${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}):\n${portfolioAssets
          .slice(0, 10)
          .map(
            a =>
              `- ${parseFloat(a.balance).toFixed(4)} ${a.tokenSymbol} ($${parseFloat(a.balanceUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}) on ${a.blockchain}`,
          )
          .join("\n")}`
      : "";

    // Build activity context
    const activityItems =
      (recentActivity as {
        type: string;
        chain: string;
        minedAt: string;
        out: { symbol: string; amount: string } | null;
        in: { symbol: string; amount: string } | null;
        valueUsd: number | null;
      }[]) || [];

    const activitySummary = activityItems.length
      ? `\n\nRecent activity (last ${activityItems.length} transactions):\n${activityItems
          .map(a => {
            const date = a.minedAt?.slice(0, 10) || "unknown";
            const chain = a.chain || "unknown";
            const outStr = a.out ? `-${a.out.amount} ${a.out.symbol}` : "";
            const inStr = a.in ? `+${a.in.amount} ${a.in.symbol}` : "";
            const valueStr =
              a.valueUsd != null ? ` ($${a.valueUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })})` : "";
            if (a.type === "trade" || a.type === "bridge") {
              return `- ${date} on ${chain}: ${a.type === "trade" ? "Swap" : "Bridge"} ${outStr} → ${inStr}${valueStr}`;
            }
            if (a.type === "send" && outStr) return `- ${date} on ${chain}: Send ${outStr}${valueStr}`;
            if (a.type === "receive" && inStr) return `- ${date} on ${chain}: Receive ${inStr}${valueStr}`;
            const transferStr = outStr && inStr ? `${outStr} → ${inStr}` : outStr || inStr || "";
            return `- ${date} on ${chain}: ${a.type} ${transferStr}${valueStr}`;
          })
          .join("\n")}`
      : "";

    // Build conversation context from recent messages
    const recentContext = recentMessages?.length
      ? `\n\nRecent conversation:\n${(recentMessages as { role: string; content: string }[])
          .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n")}`
      : "";

    const userPrompt = `User's wallet address: ${address}\nConnected chain ID: ${userChainId}${portfolioSummary}${activitySummary}${recentContext}\n\nUser: ${message}`;

    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: intentTools,
      stopWhen: stepCountIs(10),
    });

    // Try to parse the AI's final text as JSON
    let parsed: Record<string, unknown> | null = null;
    if (result.text) {
      const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/) || result.text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          // not valid JSON, fall through
        }
      }
    }

    // Handle parsed JSON response
    if (parsed) {
      if (parsed.type === "chat") {
        return NextResponse.json({
          type: "chat",
          message: parsed.message as string,
        });
      }

      if (parsed.type === "transaction" && parsed.transaction) {
        return NextResponse.json({
          type: "transaction",
          message: parsed.message as string,
          transaction: parsed.transaction,
        });
      }

      // Legacy format: has transactions array
      if (parsed.transactions) {
        const txs = parsed.transactions as { to: string; data: string; value: string; chainId: number }[];
        const sim = parsed.simulation as
          | { verified: boolean; changes: { direction: string; symbol: string; amount: string }[] }
          | undefined;
        return NextResponse.json({
          type: "transaction",
          message: (parsed.description as string) || result.text || "Transaction ready",
          transaction: {
            ...txs[0],
            description: (parsed.description as string) || "",
            simulation: sim ? { verified: sim.verified, changes: sim.changes } : undefined,
          },
        });
      }
    }

    // Fallback: scan tool results for transaction data
    type TxData = { to: string; data: string; value: string; chainId: number };
    type SimResult = {
      success: boolean;
      changes: { direction: string; symbol: string; amount: string }[];
      error?: string;
    };

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
      const simChanges = lastSim?.changes || [];
      return NextResponse.json({
        type: "transaction",
        message: result.text || "Transaction ready",
        transaction: {
          ...lastTx,
          description: result.text || "",
          simulation: lastSim ? { verified: !!lastSim.success, changes: simChanges } : undefined,
        },
      });
    }

    // No transaction built — treat as chat response
    // Clean up the text (remove JSON wrapper if the AI wrapped it weirdly)
    let chatMessage = result.text || "I'm not sure how to help with that. Could you rephrase?";
    // If the text looks like raw JSON that wasn't parsed, extract the message
    try {
      const maybeJson = JSON.parse(chatMessage);
      if (maybeJson.message) chatMessage = maybeJson.message;
    } catch {
      // not JSON, use as-is
    }

    return NextResponse.json({
      type: "chat",
      message: chatMessage,
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Intent API error:", error);
    return NextResponse.json(
      {
        type: "chat",
        message: "Sorry, something went wrong. Please try again.",
        error: errMessage,
      },
      { status: 500 },
    );
  }
}
