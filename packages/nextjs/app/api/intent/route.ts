import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "8GVG8WjDs-sGFRr6Rm839";
const WETH_MAINNET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const ETH_PLACEHOLDER = "0x0000000000000000000000000000000000000000"; // LI.FI native ETH address
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

// ─── ENS Constants ───────────────────────────────────────────────────────────

const ENS_REGISTRAR = "0x253553366Da8546fC250F225fe3d25d0C782303b";
const ENS_PUBLIC_RESOLVER = "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63";

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

// ─── ABI Encoding Helpers ────────────────────────────────────────────────────

function encodeString(s: string): string {
  const bytes = Buffer.from(s, "utf8");
  const len = padUint256(BigInt(bytes.length));
  const padded = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  // If the string is empty, still pad to 32 bytes
  const finalPadded = padded.length === 0 ? "" : padded;
  return len + finalPadded;
}

function encodeBytes32(hex: string): string {
  return hex.replace("0x", "").padStart(64, "0");
}

function encodeBool(val: boolean): string {
  return padUint256(val ? 1n : 0n);
}

function encodeUint16(val: number): string {
  return padUint256(BigInt(val));
}

/**
 * ABI-encode the full parameter tuple for makeCommitment / register:
 * (string name, address owner, uint256 duration, bytes32 secret,
 *  address resolver, bytes[] data, bool reverseRecord, uint16 fuses)
 *
 * Returns the encoded params WITHOUT function selector.
 */
function encodeENSParams(
  name: string,
  owner: string,
  duration: bigint,
  secret: string,
  resolver: string,
  reverseRecord: boolean,
  fuses: number,
): string {
  // Head: 8 params × 32 bytes each = 256 bytes of head
  // Param 0: name (string) — dynamic, pointer
  // Param 1: owner (address) — static
  // Param 2: duration (uint256) — static
  // Param 3: secret (bytes32) — static
  // Param 4: resolver (address) — static
  // Param 5: data (bytes[]) — dynamic, pointer
  // Param 6: reverseRecord (bool) — static
  // Param 7: fuses (uint16) — static

  const headSize = 8 * 32; // 256 bytes

  // Encode the string (name) — this goes in tail
  const nameEncoded = encodeString(name);

  // Encode bytes[] data — empty array: just length = 0
  const emptyBytesArray = padUint256(0n); // length 0

  // Calculate offsets (in bytes from start of params)
  const nameOffset = headSize; // string starts after head
  const nameTailSize = nameEncoded.length / 2; // bytes
  const dataOffset = nameOffset + nameTailSize;

  // Build head
  let head = "";
  head += padUint256(BigInt(nameOffset)); // param 0: offset to name
  head += padAddress(owner); // param 1: owner
  head += padUint256(duration); // param 2: duration
  head += encodeBytes32(secret); // param 3: secret
  head += padAddress(resolver); // param 4: resolver
  head += padUint256(BigInt(dataOffset)); // param 5: offset to data
  head += encodeBool(reverseRecord); // param 6: reverseRecord
  head += encodeUint16(fuses); // param 7: fuses

  // Build tail
  const tail = nameEncoded + emptyBytesArray;

  return head + tail;
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

  searchTransactions: tool({
    description: `Search the wallet's full on-chain transaction history. Use for ANY question about past activity:
- "where did X come from?" / "when did I buy X?" / "what did I pay for X?" → pass tokenSymbol
- "show my recent swaps/trades" → pass operationType="trade"
- "what did I do on Base?" → pass chainId="base"
- "what happened in January?" → pass afterDate / beforeDate
Always call this before saying you can't find something. It uses server-side token filtering so results are instant regardless of history depth.`,
    inputSchema: z.object({
      address: z.string().describe("Wallet address"),
      tokenSymbol: z.string().optional().describe("Token symbol to filter by, e.g. 'CLAWNCH', 'ETH', 'USDC'"),
      chainId: z
        .string()
        .optional()
        .describe("Chain to filter: 'ethereum', 'base', 'xdai', 'arbitrum', 'optimism', 'polygon'"),
      operationType: z
        .string()
        .optional()
        .describe(
          "Filter by type: 'trade', 'send', 'receive', 'deposit', 'withdraw', 'approve', 'mint', 'burn', 'execute'",
        ),
      afterDate: z.string().optional().describe("ISO date string, e.g. '2026-01-01' — only return txs after this date"),
      beforeDate: z
        .string()
        .optional()
        .describe("ISO date string, e.g. '2026-02-01' — only return txs before this date"),
      limit: z.number().optional().describe("Max results to return, default 20, max 100"),
    }),
    execute: async ({ address, tokenSymbol, chainId, operationType, afterDate, beforeDate, limit }) => {
      const ZERION_KEY = process.env.ZERION_API_KEY || "";
      const auth = Buffer.from(`${ZERION_KEY}:`).toString("base64");
      const headers = { Authorization: `Basic ${auth}`, accept: "application/json" };
      const maxResults = Math.min(limit || 20, 100);

      try {
        // Step 1: If filtering by token symbol, resolve to Zerion fungible ID first (enables server-side filter)
        let fungibleId: string | null = null;
        if (tokenSymbol) {
          const fRes = await fetch(
            `https://api.zerion.io/v1/fungibles/?filter[search_query]=${encodeURIComponent(tokenSymbol)}&currency=usd`,
            { headers },
          );
          if (fRes.ok) {
            const fData = await fRes.json();
            // Find exact symbol match
            const match = (fData.data || []).find(
              (f: any) => f.attributes?.symbol?.toLowerCase() === tokenSymbol.toLowerCase(),
            );
            fungibleId = match?.id || null;
          }
        }

        // Step 2: Build query URL with all available server-side filters
        const params = new URLSearchParams();
        params.set("currency", "usd");
        params.set("page[size]", "100");
        params.set("sort", "-mined_at");
        if (fungibleId) params.set("filter[fungible_ids]", fungibleId);
        if (chainId) params.set("filter[chain_ids]", chainId);
        if (operationType) params.set("filter[operation_types]", operationType);

        const url = `https://api.zerion.io/v1/wallets/${address}/transactions/?${params.toString()}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          return { error: `Zerion API error: ${res.status}` };
        }
        const data = await res.json();
        const allItems: any[] = data.data || [];

        // Step 3: Client-side date filter if requested
        const items = allItems.filter((tx: any) => {
          const minedAt = tx.attributes?.mined_at || "";
          if (afterDate && minedAt < afterDate) return false;
          if (beforeDate && minedAt > beforeDate) return false;
          return true;
        });

        const results = items.slice(0, maxResults).map((tx: any) => {
          const attrs = tx.attributes;
          const transfers = (attrs.transfers || []).map((t: any) => ({
            direction: t.direction,
            symbol: t.fungible_info?.symbol,
            name: t.fungible_info?.name,
            amount: t.quantity?.float,
            valueUsd: t.value,
            pricePerToken: t.price,
          }));
          return {
            date: attrs.mined_at,
            type: attrs.operation_type,
            chain: tx.relationships?.chain?.data?.id,
            hash: attrs.hash,
            from: attrs.sent_from,
            to: attrs.sent_to,
            transfers,
          };
        });

        if (results.length === 0) {
          return {
            found: false,
            tokenSymbol,
            fungibleIdResolved: fungibleId,
            message: fungibleId
              ? `No transactions found for ${tokenSymbol} (Zerion ID: ${fungibleId}). Token may have been received via airdrop, farming, or contract interaction not indexed as a transfer.`
              : `Token symbol '${tokenSymbol}' not found in Zerion's fungible index. Try a different symbol or contract address.`,
          };
        }

        return {
          found: true,
          totalFound: items.length,
          returned: results.length,
          tokenSymbol,
          fungibleIdResolved: fungibleId,
          transactions: results,
        };
      } catch (e) {
        return { error: `searchTransactions failed: ${e instanceof Error ? e.message : String(e)}` };
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
          // Public RPCs for chains not on Alchemy
          xdai: "https://rpc.gnosischain.com",
          gnosis: "https://rpc.gnosischain.com",
          monad: "https://testnet-rpc.monad.xyz",
          "binance-smart-chain": "https://bsc-dataseed.binance.org",
          zksync: "https://mainnet.era.zksync.io",
          "zksync-era": "https://mainnet.era.zksync.io",
          scroll: "https://rpc.scroll.io",
          linea: "https://rpc.linea.build",
          mantle: "https://rpc.mantle.xyz",
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

  getOnChainBalance: tool({
    description:
      "Get the LIVE on-chain balance of ETH or any ERC-20 token for a wallet address. Use this when the user asks specifically about a token balance on a specific chain — the injected portfolio snapshot can be stale. Also use to check allowances.",
    inputSchema: z.object({
      walletAddress: z.string().describe("The wallet address to check"),
      chain: z
        .string()
        .describe(
          "Chain: 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'xdai', 'zksync-era', 'scroll', 'linea', 'mantle', 'monad'",
        ),
      tokenAddress: z
        .string()
        .optional()
        .describe(
          "ERC-20 contract address. Omit for native ETH/chain token. Use 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for ETH.",
        ),
      tokenSymbol: z.string().optional().describe("Token symbol for display, e.g. 'USDC'"),
      tokenDecimals: z.number().optional().describe("Token decimals (default 18, USDC=6)"),
    }),
    execute: async ({ walletAddress, chain, tokenAddress, tokenSymbol, tokenDecimals }) => {
      const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";
      const rpcUrls: Record<string, string> = {
        ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
        base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
        arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
        optimism: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
        polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
        xdai: "https://rpc.gnosischain.com",
        gnosis: "https://rpc.gnosischain.com",
        "zksync-era": "https://mainnet.era.zksync.io",
        scroll: "https://rpc.scroll.io",
        linea: "https://rpc.linea.build",
        mantle: "https://rpc.mantle.xyz",
        monad: "https://testnet-rpc.monad.xyz",
      };

      const rpcUrl = rpcUrls[chain];
      if (!rpcUrl) return { error: `Chain '${chain}' not supported` };

      try {
        const isNative =
          !tokenAddress ||
          tokenAddress === "0x0000000000000000000000000000000000000000" ||
          tokenAddress === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ||
          tokenAddress === "";

        if (isNative) {
          // eth_getBalance
          const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "eth_getBalance",
              params: [walletAddress, "latest"],
              id: 1,
            }),
          });
          const data = await res.json();
          const balanceWei = BigInt(data.result || "0x0");
          const balance = Number(balanceWei) / 1e18;
          return { walletAddress, chain, token: tokenSymbol || "ETH", balance: balance.toFixed(6), raw: data.result };
        } else {
          // ERC-20 balanceOf
          const decimals = tokenDecimals ?? 18;
          // balanceOf(address) selector = 0x70a08231, padded to 32 bytes
          const paddedAddr = walletAddress.toLowerCase().replace("0x", "").padStart(64, "0");
          const data_hex = "0x70a08231" + paddedAddr;

          const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "eth_call",
              params: [{ to: tokenAddress, data: data_hex }, "latest"],
              id: 1,
            }),
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          const raw = BigInt(data.result || "0x0");
          const balance = Number(raw) / Math.pow(10, decimals);
          return {
            walletAddress,
            chain,
            token: tokenSymbol || tokenAddress,
            tokenAddress,
            balance: balance.toFixed(decimals > 6 ? 6 : decimals),
            raw: data.result,
          };
        }
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

  buildRoute: tool({
    description:
      "Build swap, bridge, or DeFi zap calldata via LI.FI. Handles same-chain swaps (fromChainId === toChainId), cross-chain bridges (fromChainId !== toChainId), AND DeFi deposits/staking (set toToken to a vault/staking token address). After getting calldata, the AI MUST call simulateAssetChanges to verify before returning.",
    inputSchema: z.object({
      fromToken: z
        .string()
        .describe(
          "Input token symbol (e.g. 'ETH', 'USDC') or address. For native ETH use 'ETH' or 0x0000000000000000000000000000000000000000",
        ),
      toToken: z
        .string()
        .describe(
          "Output token symbol (e.g. 'USDC', 'ETH') or address. For DeFi zaps, use the vault/staking token contract address",
        ),
      amountIn: z.string().describe("Amount in wei (raw units, not decimal)"),
      fromChainId: z
        .number()
        .describe("Source chain ID (1=mainnet, 8453=Base, 42161=Arbitrum, 10=Optimism, 137=Polygon)"),
      toChainId: z.number().describe("Destination chain ID. Same as fromChainId for same-chain swaps"),
      fromAddress: z.string().describe("The sender/user wallet address"),
    }),
    execute: async ({ fromToken, toToken, amountIn, fromChainId, toChainId, fromAddress }) => {
      const url = `https://li.quest/v1/quote?fromChain=${fromChainId}&toChain=${toChainId}&fromToken=${fromToken}&toToken=${toToken}&fromAmount=${amountIn}&fromAddress=${fromAddress}&slippage=0.005`;
      try {
        const res = await fetch(url, {
          headers: {
            "x-lifi-api-key": process.env.LIFI_API_KEY || "",
          },
        });
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
            chainId: fromChainId,
            estimate: data.estimate
              ? {
                  fromAmount: data.estimate.fromAmount,
                  toAmount: data.estimate.toAmount,
                  toAmountMin: data.estimate.toAmountMin,
                  approvalAddress: data.estimate.approvalAddress,
                  gasCosts: data.estimate.gasCosts,
                }
              : undefined,
          };
        }
        return { error: "No transactionRequest in LI.FI response", rawResponse: JSON.stringify(data).slice(0, 500) };
      } catch (e) {
        return { error: `Failed to fetch LI.FI quote: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  getRouteStatus: tool({
    description:
      "Check the status of a cross-chain LI.FI transfer after the user has submitted the transaction. Returns NOT_FOUND, PENDING, DONE, or FAILED with substatus details.",
    inputSchema: z.object({
      txHash: z.string().describe("The transaction hash from the source chain"),
      fromChain: z.number().describe("Source chain ID"),
      toChain: z.number().describe("Destination chain ID"),
    }),
    execute: async ({ txHash, fromChain, toChain }) => {
      const url = `https://li.quest/v1/status?txHash=${txHash}&fromChain=${fromChain}&toChain=${toChain}`;
      try {
        const res = await fetch(url, {
          headers: {
            "x-lifi-api-key": process.env.LIFI_API_KEY || "",
          },
        });
        if (!res.ok) {
          const errText = await res.text();
          return { error: `LI.FI status API error (${res.status}): ${errText}` };
        }
        const data = await res.json();
        return {
          status: data.status as string,
          substatus: data.substatus as string | undefined,
          substatusMessage: data.substatusMessage as string | undefined,
          sending: data.sending
            ? {
                txHash: data.sending.txHash,
                amount: data.sending.amount,
                token: data.sending.token?.symbol,
                chainId: data.sending.chainId,
              }
            : undefined,
          receiving: data.receiving
            ? {
                txHash: data.receiving.txHash,
                amount: data.receiving.amount,
                token: data.receiving.token?.symbol,
                chainId: data.receiving.chainId,
              }
            : undefined,
        };
      } catch (e) {
        return { error: `Failed to check route status: ${e instanceof Error ? e.message : String(e)}` };
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

  // ─── ENS Registration Tools ─────────────────────────────────────────────

  checkENSAvailability: tool({
    description: "Check if an ENS name is available for registration",
    inputSchema: z.object({
      name: z.string().describe("ENS label, e.g. 'cassiopeia' or 'cassiopeia.eth'"),
    }),
    execute: async ({ name }) => {
      const label = name.replace(/\.eth$/i, "").toLowerCase();
      try {
        // Use ENS BaseRegistrar available(uint256 id) where id = keccak256(label)
        // BaseRegistrar: 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85
        // available(uint256) selector: 0x96e494e8
        const BASE_REGISTRAR = "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85";

        // Compute keccak256 of label using Web Crypto API (available in Node 18+)
        const encoder = new TextEncoder();
        const labelBytes = encoder.encode(label);
        const hashBuffer = await crypto.subtle.digest("SHA-256", labelBytes);
        // Note: We need keccak256, not SHA-256, but we can use eth_call namehash trick instead
        // Alternative: use ENS offchain resolver API which is simpler

        // Use Alchemy's ENS resolution to check if name has an owner
        // If owner is zero address → available
        // We'll check via ENS registry owner(namehash)
        // ENS Registry: 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
        // But namehash requires keccak256... let's use a different approach:
        // Call the ETH Registrar Controller's available() via a workaround:
        // Use alchemy_resolveName which is a supported Alchemy method
        void hashBuffer; // suppress unused warning
        void BASE_REGISTRAR;

        const resolveRes = await fetch(alchemyUrl(1), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "alchemy_resolveName",
            params: [`${label}.eth`],
          }),
        });
        const resolveJson = await resolveRes.json();

        if (resolveJson.error) {
          // If resolution fails with "not found" type error, name is likely available
          // Fall through to subgraph check
        }

        const resolvedAddress = resolveJson?.result;

        if (!resolvedAddress || resolvedAddress === "0x0000000000000000000000000000000000000000") {
          // No resolver set = name likely available (or expired)
          // Double-check with ENS subgraph for expiry info
          const query = `{registrations(where:{labelName:"${label}"}){expiryDate registrant{id}}}`;
          try {
            const sgRes = await fetch("https://api.thegraph.com/subgraphs/name/ensdomains/ens", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query }),
              signal: AbortSignal.timeout(3000),
            });
            const sgJson = await sgRes.json();
            const regs = sgJson?.data?.registrations ?? [];
            if (regs.length > 0) {
              const nowSeconds = Math.floor(Date.now() / 1000);
              const expiry = parseInt(regs[0].expiryDate, 10);
              const gracePeriod = 90 * 24 * 60 * 60;
              const available = expiry + gracePeriod < nowSeconds;
              return {
                available,
                name: label,
                expiryDate: available ? null : new Date(expiry * 1000).toLocaleDateString(),
              };
            }
          } catch {
            // subgraph timeout/rate-limit — trust the resolver result
          }
          return { available: true, name: label };
        }

        // Name resolves to a real address = it's registered and active
        return { available: false, name: label, owner: resolvedAddress };
      } catch (e) {
        return { error: `Failed to check ENS availability: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  getENSRentPrice: tool({
    description: "Get the rent price for registering an ENS name for a given number of years",
    inputSchema: z.object({
      name: z.string().describe("ENS label, e.g. 'cassiopeia' or 'cassiopeia.eth'"),
      years: z.number().default(1).describe("Number of years to register for"),
    }),
    execute: async ({ name, years }) => {
      const label = name.replace(/\.eth$/i, "");
      const duration = BigInt(years * 365 * 24 * 60 * 60);
      try {
        // Encode rentPrice(string name, uint256 duration) — selector 0x83e7f6ff
        // Two params: string (dynamic, offset) + uint256 (static)
        // Head: offset_to_name (0x40 = 64) + duration
        // Tail: encoded string
        const encodedName = encodeString(label);
        const calldata = "0x83e7f6ff" + padUint256(64n) + padUint256(duration) + encodedName;

        const res = await fetch(alchemyUrl(1), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: ENS_REGISTRAR, data: calldata }, "latest"],
          }),
        });
        const json = await res.json();
        if (json.error) {
          return { error: json.error.message || JSON.stringify(json.error) };
        }
        // Returns (uint256 base, uint256 premium)
        const result = (json.result || "0x").replace("0x", "");
        const base = BigInt("0x" + (result.slice(0, 64) || "0"));
        const premium = BigInt("0x" + (result.slice(64, 128) || "0"));
        const total = base + premium;
        const priceEth = Number(total) / 1e18;

        return {
          priceWei: total.toString(),
          priceEth: priceEth.toFixed(6),
          baseWei: base.toString(),
          premiumWei: premium.toString(),
          years,
          name: label,
        };
      } catch (e) {
        return { error: `Failed to get ENS rent price: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),

  buildENSRegistration: tool({
    description:
      "Build the 2-step ENS registration transaction. Returns a multistep_transaction with commit + register steps. The user must execute step 1 (commit), wait 60+ seconds, then execute step 2 (register).",
    inputSchema: z.object({
      name: z.string().describe("ENS label e.g. 'cassiopeia'"),
      owner: z.string().describe("Owner address 0x..."),
      years: z.number().default(1).describe("Number of years to register for"),
    }),
    execute: async ({ name, years, owner }) => {
      const label = name.replace(/\.eth$/i, "");
      const duration = BigInt(years * 365 * 24 * 60 * 60);

      // Generate random secret (bytes32)
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const secretHex =
        "0x" +
        Array.from(secretBytes)
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");

      try {
        // 1. Get rent price
        const encodedNameForPrice = encodeString(label);
        const priceCalldata = "0x83e7f6ff" + padUint256(64n) + padUint256(duration) + encodedNameForPrice;

        const priceRes = await fetch(alchemyUrl(1), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: ENS_REGISTRAR, data: priceCalldata }, "latest"],
          }),
        });
        const priceJson = await priceRes.json();
        if (priceJson.error) {
          return { error: `Failed to get rent price: ${priceJson.error.message || JSON.stringify(priceJson.error)}` };
        }
        const priceResult = (priceJson.result || "0x").replace("0x", "");
        const base = BigInt("0x" + (priceResult.slice(0, 64) || "0"));
        const premium = BigInt("0x" + (priceResult.slice(64, 128) || "0"));
        const totalPrice = base + premium;
        // Add 10% buffer to cover gas price fluctuations
        const valueWithBuffer = (totalPrice * 110n) / 100n;
        const priceEth = Number(totalPrice) / 1e18;

        // 2. Build makeCommitment eth_call to get commitment hash
        const params = encodeENSParams(label, owner, duration, secretHex, ENS_PUBLIC_RESOLVER, true, 0);
        const makeCommitmentCalldata = "0x65a69dcf" + params;

        const commitmentRes = await fetch(alchemyUrl(1), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: ENS_REGISTRAR, data: makeCommitmentCalldata }, "latest"],
          }),
        });
        const commitmentJson = await commitmentRes.json();
        if (commitmentJson.error) {
          return {
            error: `Failed to compute commitment: ${commitmentJson.error.message || JSON.stringify(commitmentJson.error)}`,
          };
        }
        const commitment = commitmentJson.result as string; // bytes32

        // 3. Build commit() calldata: selector + commitment bytes32
        const commitCalldata = "0xf14fcbc8" + commitment.replace("0x", "").padStart(64, "0");

        // 4. Build register() calldata: selector + same params as makeCommitment
        const registerCalldata = "0x74694a2b" + params;

        return {
          type: "multistep_transaction",
          message: `I'll register **${label}.eth** for you. This is a 2-step process:\n1. **Commit** — locks in your registration intent (gas only)\n2. **Wait 60 seconds** — required by the ENS contract\n3. **Register** — completes registration (${priceEth.toFixed(4)} ETH + gas)`,
          steps: [
            {
              to: ENS_REGISTRAR,
              data: commitCalldata,
              value: "0x0",
              chainId: 1,
              description: `Step 1 of 2: Commit to register ${label}.eth`,
              label: "Commit",
            },
            {
              to: ENS_REGISTRAR,
              data: registerCalldata,
              value: toHex(valueWithBuffer),
              chainId: 1,
              description: `Step 2 of 2: Register ${label}.eth (${priceEth.toFixed(4)} ETH for ${years} year${years > 1 ? "s" : ""})`,
              label: "Register",
            },
          ],
          delay: 65000,
          priceEth: priceEth.toFixed(6),
          priceWei: totalPrice.toString(),
        };
      } catch (e) {
        return { error: `Failed to build ENS registration: ${e instanceof Error ? e.message : String(e)}` };
      }
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
- Injected portfolio = your starting point for overviews ("what do I have?", "show me my portfolio")
- For ANY specific question about a token/balance on a specific chain → call getOnChainBalance to get the LIVE on-chain value. Don't trust the snapshot for specific queries.
- For "how much X do I have on Y chain?" → ALWAYS call getOnChainBalance. The injected snapshot may be stale.
- For ANY question about past transactions — "where did X come from?", "when did I buy X?", "what did I pay?", "show my trades", "what did I do on Base?" → call searchTransactions. It resolves token symbols server-side and searches the full history instantly. NEVER say you can't find something without calling this first.
- For "what was X worth when I got it?" → call searchTransactions with tokenSymbol, find the acquisition tx, compute P&L vs current price from getTokenPrice.
- For "what have I been doing lately?" → call searchTransactions with a limit of 20 (no token filter).
- Once you have a tx hash, call getTransactionDetails for sender/receiver. NEVER say "check a block explorer".
- For "how is X doing?" or "what's the price of X?" → call getTokenPrice.
- Be specific: always give dates, amounts, chains, USD values. NEVER say "I don't have access to your history".
- If searchTransactions returns found=false with a resolved fungibleId, the token genuinely has no indexed transfer history (airdrop, farm reward, genesis allocation). Say so clearly.
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
- getOnChainBalance: LIVE on-chain balance via RPC for ETH or any ERC-20. Use for specific "how much X on Y chain?" questions — more accurate than the snapshot.
- searchTransactions: The primary history tool. Filters by token symbol (resolved server-side), chain, operation type, date range. Use for almost any "what happened / when / where did X come from" question.
- getTransactionDetails: Look up full tx details by hash — sender, receiver, value. Use when you have a hash and need to answer "who sent this?" or "what address?"
- getTokenPrice: Get current USD price and 24h change for any token.
- getWalletActivity: Get recent cross-chain transaction history with full details (use when no specific token/filter needed).
- buildRoute: Build swap, bridge, or DeFi zap calldata via LI.FI. This single tool handles:
  • Same-chain swaps: set fromChainId === toChainId (e.g. swap ETH→USDC on mainnet)
  • Cross-chain bridges: set fromChainId !== toChainId (e.g. bridge USDC from mainnet to Base)
  • DeFi zaps (Composer): set toToken to a vault/staking token address to auto-compose deposits into Morpho, Aave, Lido, EtherFi, Pendle, etc.
  Token symbols work directly (e.g. "ETH", "USDC") — no need to resolve addresses first.
  For native ETH, use symbol "ETH" or address 0x0000000000000000000000000000000000000000.
- getRouteStatus: Check the status of a cross-chain LI.FI transfer. Use AFTER the user submits a cross-chain tx to track delivery. Returns NOT_FOUND, PENDING, DONE, or FAILED.
- buildTransfer: Build ETH or ERC-20 transfer calldata.
- resolveENS: Resolve ENS name to address.
- getTokenAddress: Look up token contract address by symbol.
- wrapEth: Wrap ETH to WETH (simpler/cheaper than routing through LI.FI for WETH specifically).
- unwrapWeth: Unwrap WETH to ETH (simpler/cheaper than routing through LI.FI for WETH specifically).
- checkENSAvailability: Check if an ENS name is available for registration.
- getENSRentPrice: Get the rent price for registering an ENS name.
- buildENSRegistration: Build the 2-step ENS registration (commit + register). Returns a multistep_transaction.

DEFI ZAPS (Composer):
When the user says "deposit into Morpho", "stake on Lido", "deposit into Aave", "get yield on USDC", "stake ETH", or similar:
→ Use buildRoute with toToken set to the vault/staking token contract address.
LI.FI Composer handles the swap + deposit in a single transaction.
Supported protocols: Morpho, Aave V3, Lido (wstETH), EtherFi, Pendle, Euler, Ethena, and more.
You can even do cross-chain zaps (e.g. ETH on mainnet → Morpho vault on Base).

ENS REGISTRATION:
When user wants to register an ENS name, use this workflow:
1. Call checkENSAvailability(name) first
2. Call getENSRentPrice(name, years) to get the cost
3. Tell the user the name availability and price
4. Call buildENSRegistration(name, owner, years) to build the 2-step transaction
5. Return the result from buildENSRegistration directly — it already has type "multistep_transaction"
Never tell the user to go to app.ens.domains — handle it inline.

MANDATORY WORKFLOW (for transactions only):
1. If you need balance info → call getPortfolio first
2. Resolve any ENS names → call resolveENS
3. For swaps/bridges: use buildRoute directly with token symbols — no need to resolve addresses
4. For DeFi zaps: look up the vault/staking token address, then use buildRoute with that as toToken
5. For simple transfers: use buildTransfer
6. For WETH wrap/unwrap specifically: use wrapEth / unwrapWeth (cheaper)
7. For ENS registration: use buildENSRegistration (returns multistep_transaction)
8. ALWAYS call simulateAssetChanges on the built calldata before returning (skip for ENS multistep — commit is gas-only)
9. If simulation shows unexpected results → call traceCall to diagnose
10. Only return the transaction if simulation confirms the expected asset changes
11. For cross-chain txs: after the user submits, use getRouteStatus to track delivery

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

For ENS registration (multistep) responses — return the buildENSRegistration result directly:
{
  "type": "multistep_transaction",
  "message": "I'll register cassiopeia.eth for you...",
  "steps": [
    { "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 1, "description": "Step 1: Commit", "label": "Commit" },
    { "to": "0x...", "data": "0x...", "value": "0x...", "chainId": 1, "description": "Step 2: Register", "label": "Register" }
  ],
  "delay": 65000,
  "priceEth": "0.0035",
  "priceWei": "3500000000000000"
}

RULES:
- Never invent token addresses — always look them up or use hardcoded well-known ones
- Never return a transaction that failed simulation
- Amount conversions: always work in wei internally, display in human units
- For ETH in LI.FI: use symbol "ETH" or address 0x0000000000000000000000000000000000000000 (NOT the 0xEeee... placeholder)
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
      model: anthropic("claude-opus-4-6"),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: intentTools,
      stopWhen: stepCountIs(15),
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

      if (parsed.type === "multistep_transaction" && parsed.steps) {
        return NextResponse.json({
          type: "multistep_transaction",
          message: parsed.message as string,
          steps: parsed.steps,
          delay: parsed.delay || 65000,
          priceEth: parsed.priceEth,
          priceWei: parsed.priceWei,
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

    // Fallback: scan tool results for transaction data (including multistep)
    type TxData = { to: string; data: string; value: string; chainId: number };
    type SimResult = {
      success: boolean;
      changes: { direction: string; symbol: string; amount: string }[];
      error?: string;
    };
    type MultiStepResult = {
      type: "multistep_transaction";
      message: string;
      steps: { to: string; data: string; value: string; chainId: number; description: string; label: string }[];
      delay: number;
      priceEth?: string;
      priceWei?: string;
    };

    let lastTx: TxData | null = null;
    let lastSim: SimResult | null = null;
    let lastMultistep: MultiStepResult | null = null;

    for (const step of result.steps) {
      for (const toolResult of step.toolResults) {
        const r = (toolResult as unknown as { output: Record<string, unknown> }).output;
        if (r && r.type === "multistep_transaction" && Array.isArray(r.steps)) {
          lastMultistep = r as unknown as MultiStepResult;
        } else if (r && typeof r.to === "string" && typeof r.data === "string") {
          lastTx = r as unknown as TxData;
        }
        if (r && typeof r.success === "boolean" && Array.isArray(r.changes)) {
          lastSim = r as unknown as SimResult;
        }
      }
    }

    // Check for multistep first (ENS registration)
    if (lastMultistep) {
      return NextResponse.json({
        type: "multistep_transaction",
        message: result.text || lastMultistep.message || "Multi-step transaction ready",
        steps: lastMultistep.steps,
        delay: lastMultistep.delay,
        priceEth: lastMultistep.priceEth,
        priceWei: lastMultistep.priceWei,
      });
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
