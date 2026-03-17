import { NextRequest, NextResponse } from "next/server";
import TOKEN_ADDRESS_FILE from "../../../data/token-addresses.json";
import { requireAuth } from "../_lib/auth";
import OpenAI from "openai";
import { namehash } from "viem/ens";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "8GVG8WjDs-sGFRr6Rm839";
const WETH_MAINNET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

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

/**
 * Safely convert an amount string to BigInt (wei).
 * If the AI passes a decimal like "0.678" instead of wei, detect it and convert to wei.
 * Handles: "0x1a2b", "1000000000000000000", "0.678", "1.5"
 */
function safeBigInt(amount: string | number, decimals = 18): bigint {
  const s = String(amount);
  // Already hex
  if (s.startsWith("0x")) return BigInt(s);
  // If it contains a decimal point, it's human-readable — convert to wei
  if (s.includes(".")) {
    const [whole, frac = ""] = s.split(".");
    const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }
  // Pure integer string — assume already wei
  return BigInt(s);
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
  simulateAssetChanges: {
    description:
      "Simulate a transaction via Alchemy to see exactly what assets leave/enter the wallet. ALWAYS use this to verify every transaction before returning it.",
    execute: async ({ from, to, data, value, chainId }: any) => {
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
  },

  traceCall: {
    description:
      "Full EVM execution trace via debug_traceCall. Use when simulateAssetChanges shows unexpected results or the user asks why something failed.",
    execute: async ({ from, to, data, value, chainId }: any) => {
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
  },

  getPortfolio: {
    description:
      "Get all token balances for the user's wallet across all chains, including chain breakdown and total USD value. Use this to answer balance questions and to find token addresses the user holds.",
    execute: async ({ address }: any) => {
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
  },

  searchTransactions: {
    description: `Search the wallet's full on-chain transaction history. Use for ANY question about past activity:
- "where did X come from?" / "when did I buy X?" / "what did I pay for X?" → pass tokenSymbol
- "show my recent swaps/trades" → pass operationType="trade"
- "what did I do on Base?" → pass chainId="base"
- "what happened in January?" → pass afterDate / beforeDate
Always call this before saying you can't find something. It uses server-side token filtering so results are instant regardless of history depth.`,
    execute: async ({ address, tokenSymbol, chainId, operationType, afterDate, beforeDate, limit }: any) => {
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
  },

  getTransactionDetails: {
    description:
      "Look up full details of a specific transaction by hash. Returns sender address, receiver address, value, block number, timestamp, and decoded transfer info. Use this when the user asks WHO sent something, WHERE it came from, or wants any specific transaction detail.",
    execute: async ({ hash, chain }: any) => {
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
  },

  getOnChainBalance: {
    description:
      "Get the LIVE on-chain balance of ETH or any ERC-20 token for a wallet address. Use this when the user asks specifically about a token balance on a specific chain — the injected portfolio snapshot can be stale. Also use to check allowances.",
    execute: async ({ walletAddress, chain, tokenAddress, tokenSymbol, tokenDecimals }: any) => {
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
  },

  getTokenPrice: {
    description: "Get the current USD price and 24h change for a token by symbol.",
    execute: async ({ symbol }: any) => {
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
  },

  getWalletActivity: {
    description:
      "Get the user's recent cross-chain transaction history. Use when asked about recent activity, what they've been doing, or to find specific past transactions.",
    execute: async ({ address, limit }: any) => {
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
  },

  buildRoute: {
    description:
      "Build swap, bridge, or DeFi zap calldata via LI.FI. Handles same-chain swaps (fromChainId === toChainId), cross-chain bridges (fromChainId !== toChainId), AND DeFi deposits/staking (set toToken to a vault/staking token address). After getting calldata, the AI MUST call simulateAssetChanges to verify before returning.",
    execute: async ({ fromToken, toToken, amountIn, fromChainId, toChainId, fromAddress }: any) => {
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
  },

  getRouteStatus: {
    description:
      "Check the status of a cross-chain LI.FI transfer after the user has submitted the transaction. Returns NOT_FOUND, PENDING, DONE, or FAILED with substatus details.",
    execute: async ({ txHash, fromChain, toChain }: any) => {
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
  },

  buildTransfer: {
    description:
      "Build ETH or ERC-20 transfer calldata. For ETH: simple value transfer. For ERC-20: encodes transfer(address,uint256). Returns raw tx object. Amount can be in wei or human-readable (e.g. '0.5' for 0.5 ETH).",
    execute: async ({ to, amount, token, chainId, tokenDecimals }: any) => {
      const chain = chainId ?? 1;
      const decimals = tokenDecimals ?? 18;
      if (token.toUpperCase() === "ETH") {
        return {
          to,
          data: "0x",
          value: toHex(safeBigInt(amount, 18)),
          chainId: chain,
        };
      }
      const data = "0xa9059cbb" + padAddress(to) + padUint256(safeBigInt(amount, decimals));
      return {
        to: token,
        data,
        value: "0x0",
        chainId: chain,
      };
    },
  },

  resolveENS: {
    description: "Resolve an ENS name to an Ethereum address.",
    execute: async ({ name }: any) => {
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
  },

  getTokenAddress: {
    description:
      "Look up a token's contract address by symbol on a given chain. Checks file-based address registry first, then falls back to LI.FI token list.",
    execute: async ({ symbol, chainId }: any) => {
      const upper = symbol.toUpperCase();
      const chainKey = String(chainId);

      // 1. Check the file-based address registry first
      const chainTokens = (
        TOKEN_ADDRESS_FILE.tokens as Record<string, Record<string, { address: string; decimals: number; name: string }>>
      )[chainKey];
      if (chainTokens) {
        // Exact match
        if (chainTokens[upper]) return chainTokens[upper];
        // Case-insensitive match
        const match = Object.entries(chainTokens).find(([k]) => k.toUpperCase() === upper);
        if (match) return match[1];
      }

      // 2. Fall back to LI.FI token search
      try {
        const url = `https://li.quest/v1/tokens?chains=${chainId}`;
        const res = await fetch(url, { headers: { "x-lifi-api-key": process.env.LIFI_API_KEY || "" } });
        if (!res.ok) return { error: `LI.FI token search failed (${res.status})` };
        const data = await res.json();
        const chainTokens: { address: string; decimals: number; name: string; symbol: string }[] =
          data.tokens?.[String(chainId)] || [];
        const exact = chainTokens.find(t => t.symbol.toUpperCase() === upper);
        if (exact) return { address: exact.address, decimals: exact.decimals, name: exact.name };
        return { error: `Token '${symbol}' not found on chain ${chainId}` };
      } catch (e) {
        return { error: `Token search failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  },

  wrapEth: {
    description:
      "Wrap ETH to WETH. Returns transaction calldata for WETH deposit(). Amount can be in wei or human-readable (e.g. '0.5' for 0.5 ETH).",
    execute: async ({ amount, chainId }: any) => {
      const chain = chainId ?? 1;
      const wethAddr = chain === 8453 ? WETH_BASE : WETH_MAINNET;
      return {
        to: wethAddr,
        data: "0xd0e30db0",
        value: toHex(safeBigInt(amount, 18)),
        chainId: chain,
      };
    },
  },

  unwrapWeth: {
    description:
      "Unwrap WETH to ETH. Returns transaction calldata for WETH withdraw(). Amount can be in wei or human-readable (e.g. '0.5' for 0.5 ETH).",
    execute: async ({ amount, chainId }: any) => {
      const chain = chainId ?? 1;
      const wethAddr = chain === 8453 ? WETH_BASE : WETH_MAINNET;
      return {
        to: wethAddr,
        data: "0x2e1a7d4d" + padUint256(safeBigInt(amount, 18)),
        value: "0x0",
        chainId: chain,
      };
    },
  },

  // ─── ENS Registration Tools ─────────────────────────────────────────────

  checkENSAvailability: {
    description: "Check if an ENS name is available for registration",
    execute: async ({ name }: any) => {
      const label = name.replace(/\.eth$/i, "").toLowerCase();
      const fullName = `${label}.eth`;
      try {
        // Use viem's namehash + BuidlGuidl mainnet RPC + ENS registry owner()
        // ENS Registry: 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
        // owner(bytes32 node) selector: 0x02571be3
        const node = namehash(fullName);
        const calldata = "0x02571be3" + node.replace("0x", "");

        const res = await fetch("https://mainnet.rpc.buidlguidl.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e", data: calldata }, "latest"],
          }),
        });
        const json = await res.json();
        const result = json?.result as string;
        // If owner is zero address → available
        const owner = "0x" + result?.slice(-40);
        const available = !result || owner === "0x0000000000000000000000000000000000000000";
        // Don't return the owner address — AI will leak it into responses
        return { available, name: label };
      } catch (e) {
        return { error: `Failed to check ENS availability: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  },

  getENSRentPrice: {
    description: "Get the rent price for registering an ENS name for a given number of years",
    execute: async ({ name, years }: any) => {
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
  },

  buildENSRegistration: {
    description:
      "Build the 2-step ENS registration transaction. Returns a multistep_transaction with commit + register steps. The user must execute step 1 (commit), wait 60+ seconds, then execute step 2 (register).",
    execute: async ({ name, years, owner }: any) => {
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
  },

  logMiss: {
    description:
      "Call this whenever your response will NOT end with actual calldata OR a definitive, complete, confident answer. This includes: requests you deflect, things outside your scope, tokens/protocols you can't find, unclear intents you can't resolve, or anything where you ask clarifying questions instead of acting. If you're not 100% sure and not returning calldata — log it first, then respond.",
    execute: async ({ userRequest, reason, category }: any) => {
      try {
        const gistId = process.env.MISS_LOG_GIST_ID;
        const token = process.env.GITHUB_GIST_TOKEN;
        if (!gistId || !token) return { logged: false };

        // Fetch current misses
        const getRes = await fetch(`https://api.github.com/gists/${gistId}`, {
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "denarai" },
        });
        const gist = await getRes.json();
        const current = JSON.parse(gist?.files?.["misses.json"]?.content ?? "[]");

        // Append new miss
        current.push({
          ts: new Date().toISOString(),
          userRequest,
          reason,
          category,
        });

        // Write back (keep last 500)
        const trimmed = current.slice(-500);
        await fetch(`https://api.github.com/gists/${gistId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "denarai",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ files: { "misses.json": { content: JSON.stringify(trimmed, null, 2) } } }),
        });

        return { logged: true };
      } catch {
        return { logged: false };
      }
    },
  },
};

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a smart wallet assistant with full visibility into the user's portfolio and transaction history.

YOU ALWAYS HAVE:
- The user's current portfolio (all tokens, all chains, USD values) — injected in context below
- The user's DeFi positions (staked, deposited, LP, locked tokens with protocol names) — injected in context below
- The user's recent 20 transactions — injected in context below
- Tools to look up more detailed history, prices, and to build transactions

INTENT CLASSIFICATION (read this FIRST before doing anything):
- "do you know...?", "are you aware...?", "did you know...?" → The user is asking whether you KNOW something. Respond conversationally confirming or denying your knowledge. Do NOT call any tools. Do NOT dump portfolio data. Just answer the question in plain English.
- "what do I have?", "show me my portfolio", "how much X?" → Portfolio/balance question. Use injected data or tools.
- "swap X", "send X", "bridge X" → Transaction request. Build calldata.
- If unsure, default to a conversational chat response and ask for clarification. NEVER dump unrelated data.

WHEN ANSWERING QUESTIONS:
- Injected portfolio + DeFi positions = your starting point for overviews ("what do I have?", "show me my portfolio")
- DeFi positions include staked tokens, deposits, LP positions, etc. with their protocol names. When a user asks about a token by name (e.g. "Venice", "DIEM"), check BOTH the portfolio AND DeFi positions — the token name field often differs from the symbol (e.g. VVV symbol = "Venice" name, DIEM symbol might be staked via a protocol)
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

CV / CLAWDVICTION ECOSYSTEM KNOWLEDGE:
- CV (ClawdViction) is NOT an on-chain token — it is an off-chain governance score tracked in the larv.ai database
- CV accrues continuously: CV = CLAWD_staked × seconds_staked. It is NOT tradeable, NOT transferable, NOT visible in any wallet or portfolio tracker
- Users earn CV by staking $CLAWD at larv.ai (https://larv.ai/stake). The staking contract is on Base
- CV is used for governance weight on larv.ai AND as a payment mechanism for AI services (like Denarai)
- Denarai costs: 5,000 CV per page load, 25,000 CV per chat message
- larv.ai chat costs: 10,000 CV per message (requires 1,000,000 CV minimum balance)
- The user's current CV balance is injected below — use it to answer "what's my CV balance?" or "how much CV do I have?"
- If a user asks about CV rewards, staking, or governance, direct them to larv.ai

WHEN TO BUILD A TRANSACTION:
Only when the user clearly wants to execute: "swap", "send", "bridge", "wrap", "buy", "sell"

Chat (just respond in plain English) when the user:
- Asks whether you know something ("do you know that I have X?", "are you aware of Y?") — just confirm your knowledge conversationally, do NOT dump portfolio data or call tools
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
- logMiss: Call this BEFORE responding whenever your answer will NOT be calldata or a 100% confident, complete answer. This means: you're deflecting, out of scope, can't find the token/protocol, asking clarifying questions, or giving a partial/educational answer instead of acting. If you're unsure at all — log it first. No exceptions.

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

For approve + swap multistep responses — use a 3 second delay to give the RPC time to register the approval:
{
  "type": "multistep_transaction",
  "message": "You need to approve OP first, then execute the swap.",
  "steps": [
    { "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 10, "description": "Approve OP for spending", "label": "Approve" },
    { "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 10, "description": "Swap OP → USDC", "label": "Swap" }
  ],
  "delay": 3000
}

DELAY RULES:
- delay is milliseconds to wait after step 1 confirms before step 2 executes
- Approve + swap: always use delay: 3000 (3 seconds — lets the RPC sync the approval)
- ENS registration: delay: 65000 (protocol requires ~60s between commit and register — this is set automatically by the buildENSRegistration tool, do not set it manually)
- Everything else: delay: 0

RULES:
- NEVER type or recall a token contract address from your training memory. ALWAYS call getTokenAddress(symbol, chainId) — it checks a verified on-disk address registry first, then falls back to live lookup. Your training memory for addresses is wrong. The file is right.
- Never return a transaction that failed simulation
- Amount conversions: always work in wei internally, display in human units
- For ETH in LI.FI: use symbol "ETH" — LI.FI resolves it, no address needed
- All amount parameters expect wei (raw units). Convert from human-readable first.
- If the user's request is unclear, respond with a chat message asking for clarification
- If simulation fails, respond with a chat message explaining why`;

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { message, address, portfolio, defiPositions, chainId, recentMessages, recentActivity, cvSignature } =
      await req.json();

    if (!process.env.VENICE_API_KEY) {
      return NextResponse.json(
        { type: "chat", message: "API key not configured. Please set VENICE_API_KEY." },
        { status: 500 },
      );
    }

    // ─── CV charge (25,000 CV per request) ───────────────────────────────────
    const CV_COST_PER_REQUEST = 25_000;
    if (!cvSignature) {
      return NextResponse.json(
        { type: "chat", message: "⚠️ CV signature required to use Denarai. Please reconnect your wallet." },
        { status: 402 },
      );
    }

    {
      const cvRes = await fetch("https://larv.ai/api/cv/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          signature: cvSignature,
          secret: process.env.CV_SPEND_SECRET,
          amount: CV_COST_PER_REQUEST,
        }),
      });
      const cvData = await cvRes.json();
      if (!cvData.success) {
        const isInsufficient = cvRes.status === 402;
        const isBadSig =
          cvRes.status === 400 || (cvData.error && String(cvData.error).toLowerCase().includes("signature"));
        let msg: string;
        if (isBadSig) {
          msg = `⚠️ CV signature invalid or expired. Please disconnect and reconnect your wallet to re-sign, then try again.`;
        } else if (isInsufficient) {
          msg = `⚠️ Insufficient CV balance. Each request costs ${CV_COST_PER_REQUEST.toLocaleString()} CV. Your stored signature may be for a different wallet — try disconnecting and reconnecting. Otherwise, stake more CLAWD on [larv.ai](https://larv.ai) to earn more CV.`;
        } else {
          msg = `⚠️ CV charge failed: ${cvData.error || "unknown error"} (status ${cvRes.status})`;
        }
        console.error("[CV spend failed]", { status: cvRes.status, error: cvData.error, wallet: address });
        return NextResponse.json({ type: "chat", message: msg }, { status: cvRes.status });
      }
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

    // Build DeFi positions context (staked, deposited, LP, locked, etc.)
    const defiItems =
      (defiPositions as {
        tokenName: string;
        tokenSymbol: string;
        positionType: string;
        protocol: string | null;
        balance: string;
        balanceUsd: string;
        blockchain: string;
        contractAddress?: string;
      }[]) || [];

    const defiTotalUsd = defiItems.reduce((sum, a) => sum + (parseFloat(a.balanceUsd) || 0), 0);
    const defiSummary = defiItems.length
      ? `\n\nDeFi Positions (${defiItems.length} positions, total $${defiTotalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}):\n${defiItems
          .map(
            a =>
              `- ${parseFloat(a.balance).toFixed(4)} ${a.tokenSymbol} "${a.tokenName}" [${a.positionType}${a.protocol ? ` via ${a.protocol}` : ""}] ($${parseFloat(a.balanceUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}) on ${a.blockchain}`,
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

    // recentMessages is passed as proper OpenAI message objects below — not embedded in the prompt

    // Fetch CV balance server-side so the AI always knows it
    let cvBalanceSummary = "";
    try {
      const cvBalRes = await fetch(`https://larv.ai/api/cv/balance?address=${address}`);
      const cvBalData = await cvBalRes.json();
      if (cvBalData.success && typeof cvBalData.balance === "number") {
        cvBalanceSummary = `\n\nCV (ClawdViction) Balance: ${cvBalData.balance.toLocaleString("en-US")} CV (off-chain governance score earned by staking $CLAWD at larv.ai)`;
      }
    } catch {
      // non-fatal — skip CV balance if fetch fails
    }

    // userPrompt is no longer used — wallet context is injected as a priming message pair in loopMessages below

    const client = new OpenAI({
      apiKey: process.env.VENICE_API_KEY,
      baseURL: "https://api.venice.ai/api/v1",
    });

    // Tool schemas for OpenAI format
    const openAiTools: OpenAI.Chat.ChatCompletionFunctionTool[] = [
      {
        type: "function",
        function: {
          name: "simulateAssetChanges",
          description:
            "Simulate a transaction via Alchemy to see exactly what assets leave/enter the wallet. ALWAYS use this to verify every transaction before returning it.",
          parameters: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              data: { type: "string" },
              value: { type: "string" },
              chainId: { type: "number" },
            },
            required: ["from", "to", "data"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "traceCall",
          description: "Full EVM execution trace via debug_traceCall.",
          parameters: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              data: { type: "string" },
              value: { type: "string" },
              chainId: { type: "number" },
            },
            required: ["from", "to", "data"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "getPortfolio",
          description: "Get all token balances for the user's wallet across all chains.",
          parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
        },
      },
      {
        type: "function",
        function: {
          name: "searchTransactions",
          description:
            "Search the wallet's full on-chain transaction history. Use for ANY question about past activity.",
          parameters: {
            type: "object",
            properties: {
              address: { type: "string" },
              tokenSymbol: { type: "string" },
              chainId: { type: "string" },
              operationType: { type: "string" },
              afterDate: { type: "string" },
              beforeDate: { type: "string" },
              limit: { type: "number" },
            },
            required: ["address"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "getTransactionDetails",
          description: "Look up full details of a specific transaction by hash.",
          parameters: {
            type: "object",
            properties: { hash: { type: "string" }, chain: { type: "string" } },
            required: ["hash", "chain"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "getOnChainBalance",
          description: "Get the LIVE on-chain balance of ETH or any ERC-20 token for a wallet address.",
          parameters: {
            type: "object",
            properties: {
              walletAddress: { type: "string" },
              chain: { type: "string" },
              tokenAddress: { type: "string" },
              tokenSymbol: { type: "string" },
              tokenDecimals: { type: "number" },
            },
            required: ["walletAddress", "chain"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "getTokenPrice",
          description: "Get the current USD price and 24h change for a token by symbol.",
          parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
        },
      },
      {
        type: "function",
        function: {
          name: "getWalletActivity",
          description: "Get the user's recent cross-chain transaction history.",
          parameters: {
            type: "object",
            properties: { address: { type: "string" }, limit: { type: "number" } },
            required: ["address"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "buildRoute",
          description: "Build swap, bridge, or DeFi zap calldata via LI.FI.",
          parameters: {
            type: "object",
            properties: {
              fromToken: { type: "string" },
              toToken: { type: "string" },
              amountIn: { type: "string" },
              fromChainId: { type: "number" },
              toChainId: { type: "number" },
              fromAddress: { type: "string" },
            },
            required: ["fromToken", "toToken", "amountIn", "fromChainId", "toChainId", "fromAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "getRouteStatus",
          description: "Check the status of a cross-chain LI.FI transfer.",
          parameters: {
            type: "object",
            properties: { txHash: { type: "string" }, fromChain: { type: "number" }, toChain: { type: "number" } },
            required: ["txHash", "fromChain", "toChain"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "buildTransfer",
          description: "Build ETH or ERC-20 transfer calldata.",
          parameters: {
            type: "object",
            properties: {
              to: { type: "string" },
              amount: { type: "string" },
              token: { type: "string" },
              fromAddress: { type: "string" },
              chainId: { type: "number" },
            },
            required: ["to", "amount", "token", "fromAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "resolveENS",
          description: "Resolve an ENS name to an Ethereum address.",
          parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        },
      },
      {
        type: "function",
        function: {
          name: "getTokenAddress",
          description: "Look up a token's contract address by symbol on a given chain.",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string" }, chainId: { type: "number" } },
            required: ["symbol", "chainId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "wrapEth",
          description: "Wrap ETH to WETH.",
          parameters: {
            type: "object",
            properties: { amount: { type: "string" }, chainId: { type: "number" } },
            required: ["amount"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "unwrapWeth",
          description: "Unwrap WETH to ETH.",
          parameters: {
            type: "object",
            properties: { amount: { type: "string" }, chainId: { type: "number" } },
            required: ["amount"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "checkENSAvailability",
          description: "Check if an ENS name is available for registration.",
          parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        },
      },
      {
        type: "function",
        function: {
          name: "getENSRentPrice",
          description: "Get the rent price for registering an ENS name.",
          parameters: {
            type: "object",
            properties: { name: { type: "string" }, years: { type: "number" } },
            required: ["name"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "buildENSRegistration",
          description: "Build the 2-step ENS registration transaction.",
          parameters: {
            type: "object",
            properties: { name: { type: "string" }, owner: { type: "string" }, years: { type: "number" } },
            required: ["name", "owner"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "logMiss",
          description: "Call this when you cannot fulfill a user request. Log what the user wanted.",
          parameters: {
            type: "object",
            properties: { userRequest: { type: "string" }, reason: { type: "string" }, category: { type: "string" } },
            required: ["userRequest", "reason", "category"],
          },
        },
      },
    ];

    // Execute tool by name
    async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      const t = intentTools[name as keyof typeof intentTools];
      if (!t) return { error: `Unknown tool: ${name}` };
      return t.execute(args as never);
    }

    // Build prior conversation turns as proper OpenAI message objects
    const historyMessages: OpenAI.Chat.ChatCompletionMessageParam[] = (
      (recentMessages as { role: string; content: string }[]) ?? []
    ).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    // Agentic loop — system prompt + wallet context (first user msg) + conversation history + current message
    const loopMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      // Inject wallet context as a system-style user turn so it doesn't pollute history
      {
        role: "user",
        content: `User's wallet address: ${address}\nConnected chain ID: ${userChainId}${portfolioSummary}${defiSummary}${cvBalanceSummary}${activitySummary}\n\n[Context injected — ready for conversation]`,
      },
      {
        role: "assistant",
        content: "Got it. I have your portfolio, DeFi positions, and activity loaded. What would you like to do?",
      },
      // Previous turns from the frontend
      ...historyMessages,
      // Current message
      { role: "user", content: message },
    ];

    let finalText = "";
    for (let step = 0; step < 15; step++) {
      const completion = await client.chat.completions.create({
        model: "claude-opus-4-6",
        messages: loopMessages,
        tools: openAiTools,
        tool_choice: "auto",
        max_tokens: 4096,
      });

      const choice = completion.choices[0];
      const assistantMsg: OpenAI.Chat.ChatCompletionMessageParam = {
        role: "assistant",
        content: choice.message.content ?? null,
      };
      if (choice.message.tool_calls?.length) {
        (assistantMsg as OpenAI.Chat.ChatCompletionAssistantMessageParam).tool_calls = choice.message.tool_calls;
      }
      loopMessages.push(assistantMsg);

      if (!choice.message.tool_calls?.length || choice.finish_reason === "stop") {
        finalText = choice.message.content ?? "";
        break;
      }

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        choice.message.tool_calls
          .filter((tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => tc.type === "function")
          .map(async tc => {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const res = await executeTool(tc.function.name, args);
            return {
              role: "tool" as const,
              tool_call_id: tc.id,
              content: JSON.stringify(res),
            };
          }),
      );
      loopMessages.push(...toolResults);
    }

    // Try to parse the AI's final text as JSON
    let parsed: Record<string, unknown> | null = null;
    if (finalText) {
      const jsonMatch = finalText.match(/```(?:json)?\s*([\s\S]*?)```/) || finalText.match(/(\{[\s\S]*\})/);
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
          delay: Math.min(typeof parsed.delay === "number" ? parsed.delay : 3000, 10000), // Cap at 10s — ENS 65s comes via buildENSRegistration tool result, not here
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
          message: (parsed.description as string) || finalText || "Transaction ready",
          transaction: {
            ...txs[0],
            description: (parsed.description as string) || "",
            simulation: sim ? { verified: sim.verified, changes: sim.changes } : undefined,
          },
        });
      }
    }

    // Fallback: scan tool results from the loop messages for transaction data
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

    for (const msg of loopMessages) {
      if (msg.role === "tool" && typeof msg.content === "string") {
        try {
          const r = JSON.parse(msg.content) as Record<string, unknown>;
          if (r && r.type === "multistep_transaction" && Array.isArray(r.steps)) {
            lastMultistep = r as unknown as MultiStepResult;
          } else if (r && typeof r.to === "string" && typeof r.data === "string") {
            lastTx = r as unknown as TxData;
          }
          if (r && typeof r.success === "boolean" && Array.isArray(r.changes)) {
            lastSim = r as unknown as SimResult;
          }
        } catch {
          // not JSON
        }
      }
    }

    if (lastMultistep) {
      return NextResponse.json({
        type: "multistep_transaction",
        message: finalText || lastMultistep.message || "Multi-step transaction ready",
        steps: lastMultistep.steps,
        delay: lastMultistep.delay ?? 0,
        priceEth: lastMultistep.priceEth,
        priceWei: lastMultistep.priceWei,
      });
    }

    if (lastTx) {
      const simChanges = lastSim?.changes || [];
      return NextResponse.json({
        type: "transaction",
        message: finalText || "Transaction ready",
        transaction: {
          ...lastTx,
          description: finalText || "",
          simulation: lastSim ? { verified: !!lastSim.success, changes: simChanges } : undefined,
        },
      });
    }

    // No transaction built — treat as chat response
    let chatMessage = finalText || "I'm not sure how to help with that. Could you rephrase?";
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
