#!/usr/bin/env node
// wallet.mjs — every denarai wallet tool as a CLI: node tools/wallet.mjs <tool> '<json-args>'
// Prints a single JSON result on stdout. Ported 1:1 from packages/nextjs/app/api/intent/route.ts
// so the claude-p brain and the Bankr fallback path behave identically.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
// deps: prefer a local install (bridge/brain/tools/node_modules — `npm i` here),
// else fall back to the monorepo's copy under packages/nextjs
function requireFrom(pkg) {
  for (const anchor of [join(HERE, "package.json"), join(REPO_ROOT, "packages", "nextjs", "package.json")]) {
    try {
      return createRequire(anchor)(pkg);
    } catch {
      /* try next */
    }
  }
  throw new Error(`${pkg} not found — run \`npm install\` in bridge/brain/tools/`);
}
const { namehash } = requireFrom("viem/ens");
const viem = requireFrom("viem");
const TOKEN_ADDRESS_FILE = JSON.parse(
  readFileSync(join(REPO_ROOT, "packages", "nextjs", "data", "token-addresses.json"), "utf8"),
);

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";
const ZERION_KEY = process.env.ZERION_API_KEY || "";
const LIFI_KEY = process.env.LIFI_API_KEY || "";
const WETH_MAINNET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const ENS_REGISTRAR = "0x253553366Da8546fC250F225fe3d25d0C782303b";
const ENS_PUBLIC_RESOLVER = "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63";

const NETWORK_MAP = { 1: "eth-mainnet", 8453: "base-mainnet", 42161: "arb-mainnet", 10: "opt-mainnet", 137: "polygon-mainnet" };
const alchemyUrl = chainId => `https://${NETWORK_MAP[chainId] || "eth-mainnet"}.g.alchemy.com/v2/${ALCHEMY_KEY}`;

const RPC_URLS = {
  ethereum: () => alchemyUrl(1),
  base: () => alchemyUrl(8453),
  arbitrum: () => alchemyUrl(42161),
  optimism: () => alchemyUrl(10),
  polygon: () => alchemyUrl(137),
  xdai: () => "https://rpc.gnosischain.com",
  gnosis: () => "https://rpc.gnosischain.com",
  monad: () => "https://testnet-rpc.monad.xyz",
  "binance-smart-chain": () => "https://bsc-dataseed.binance.org",
  zksync: () => "https://mainnet.era.zksync.io",
  "zksync-era": () => "https://mainnet.era.zksync.io",
  scroll: () => "https://rpc.scroll.io",
  linea: () => "https://rpc.linea.build",
  mantle: () => "https://rpc.mantle.xyz",
};

const zerionHeaders = () => ({
  Authorization: `Basic ${Buffer.from(`${ZERION_KEY}:`).toString("base64")}`,
  accept: "application/json",
});

// ─── hex/ABI helpers (ported verbatim) ───────────────────────────────────────
const toHex = v => "0x" + v.toString(16);
const padUint256 = v => v.toString(16).padStart(64, "0");
const padAddress = a => a.toLowerCase().replace("0x", "").padStart(64, "0");

function safeBigInt(amount, decimals = 18) {
  const s = String(amount);
  if (s.startsWith("0x")) return BigInt(s);
  if (s.includes(".")) {
    const [whole, frac = ""] = s.split(".");
    return BigInt(whole + frac.padEnd(decimals, "0").slice(0, decimals));
  }
  return BigInt(s);
}

function encodeString(s) {
  const bytes = Buffer.from(s, "utf8");
  const len = padUint256(BigInt(bytes.length));
  const padded = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  return len + (padded.length === 0 ? "" : padded);
}
const encodeBytes32 = hex => hex.replace("0x", "").padStart(64, "0");
const encodeBool = v => padUint256(v ? 1n : 0n);
const encodeUint16 = v => padUint256(BigInt(v));

function encodeENSParams(name, owner, duration, secret, resolver, reverseRecord, fuses) {
  const headSize = 8 * 32;
  const nameEncoded = encodeString(name);
  const emptyBytesArray = padUint256(0n);
  const nameOffset = headSize;
  const dataOffset = nameOffset + nameEncoded.length / 2;
  let head = "";
  head += padUint256(BigInt(nameOffset));
  head += padAddress(owner);
  head += padUint256(duration);
  head += encodeBytes32(secret);
  head += padAddress(resolver);
  head += padUint256(BigInt(dataOffset));
  head += encodeBool(reverseRecord);
  head += encodeUint16(fuses);
  return head + nameEncoded + emptyBytesArray;
}

function validateEnsLabel(label) {
  if (label.length < 3) return `ENS name "${label}" is too short — minimum 3 characters.`;
  if (label.length > 173) return `ENS name "${label}" is too long — maximum 173 characters.`;
  if (!/^[a-z0-9_-]+$/.test(label))
    return `ENS name "${label}" contains invalid characters. Only lowercase letters (a-z), numbers (0-9), hyphens (-), and leading underscores are allowed.`;
  if (label.includes("_")) {
    const firstNonUnderscore = label.search(/[^_]/);
    if (firstNonUnderscore === -1) return `ENS name cannot be only underscores.`;
    if (label.slice(firstNonUnderscore).includes("_"))
      return `ENS name "${label}" has underscores in invalid positions. Underscores are only allowed as leading characters (e.g. "_foo" is valid, "foo_bar" is not).`;
  }
  return null;
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  return res.json();
}

function mapZerionPosition(p) {
  const chain = p.relationships.chain.data.id;
  const info = p.attributes.fungible_info;
  const impl = info.implementations?.find(i => i.chain_id === chain);
  return {
    blockchain: chain,
    tokenName: info.name,
    tokenSymbol: info.symbol,
    positionType: p.attributes.position_type,
    protocol: p.attributes.protocol || null,
    balance: p.attributes.quantity.float.toString(),
    balanceUsd: (p.attributes.value || 0).toFixed(2),
    tokenDecimals: impl?.decimals ?? 18,
    contractAddress: impl?.address || "",
  };
}

// ─── Uniswap V4 (Universal Router) ───────────────────────────────────────────
// Addresses verified against developers.uniswap.org/docs/protocols/v4/deployments
const V4 = {
  1: {
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
    stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
    universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  },
  8453: {
    poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
    quoter: "0x0d5e0f971ed27fbff6c2837bf31316121532048d",
    stateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
    universalRouter: "0x6ff5693b99212da76ad316178a184ab56d299b43",
  },
};
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const NATIVE = "0x0000000000000000000000000000000000000000";
// standard hookless fee tiers: [fee (hundredths of a bip), tickSpacing]
const V4_FEE_TIERS = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10000, 200],
];

const POOL_KEY_ABI = [
  { type: "address", name: "currency0" },
  { type: "address", name: "currency1" },
  { type: "uint24", name: "fee" },
  { type: "int24", name: "tickSpacing" },
  { type: "address", name: "hooks" },
];

function v4PoolId(key) {
  return viem.keccak256(
    viem.encodeAbiParameters(
      [{ type: "tuple", components: POOL_KEY_ABI }],
      [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]],
    ),
  );
}

async function v4EthCall(chainId, to, abiItem, args) {
  const data = viem.encodeFunctionData({ abi: [abiItem], functionName: abiItem.name, args });
  const json = await rpc(alchemyUrl(chainId), "eth_call", [{ to, data }, "latest"]);
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  const decoded = viem.decodeFunctionResult({ abi: [abiItem], functionName: abiItem.name, data: json.result });
  return Array.isArray(decoded) ? decoded : [decoded]; // single-output fns decode to a bare value
}

const STATEVIEW_GET_LIQUIDITY = {
  type: "function",
  name: "getLiquidity",
  stateMutability: "view",
  inputs: [{ type: "bytes32", name: "poolId" }],
  outputs: [{ type: "uint128", name: "liquidity" }],
};
const QUOTER_EXACT_IN_SINGLE = {
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [
    {
      type: "tuple",
      name: "params",
      components: [
        { type: "tuple", name: "poolKey", components: POOL_KEY_ABI },
        { type: "bool", name: "zeroForOne" },
        { type: "uint128", name: "exactAmount" },
        { type: "bytes", name: "hookData" },
      ],
    },
  ],
  outputs: [
    { type: "uint256", name: "amountOut" },
    { type: "uint256", name: "gasEstimate" },
  ],
};
const ERC20_ALLOWANCE = {
  type: "function",
  name: "allowance",
  stateMutability: "view",
  inputs: [
    { type: "address", name: "owner" },
    { type: "address", name: "spender" },
  ],
  outputs: [{ type: "uint256" }],
};
const PERMIT2_ALLOWANCE = {
  type: "function",
  name: "allowance",
  stateMutability: "view",
  inputs: [
    { type: "address", name: "user" },
    { type: "address", name: "token" },
    { type: "address", name: "spender" },
  ],
  outputs: [
    { type: "uint160", name: "amount" },
    { type: "uint48", name: "expiration" },
    { type: "uint32", name: "nonce" },
  ],
};
// PoolManager Initialize event — the on-chain registry of every V4 pool's PoolKey
const V4_INITIALIZE_EVENT =
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)";
// PoolManager deployment blocks (fallback when fromBlock 0x0 is rejected)
const V4_DEPLOY_BLOCK = { 1: 21688329, 8453: 25350988 };

async function v4GetLogs(chain, topics, fromBlock) {
  const json = await rpc(alchemyUrl(chain), "eth_getLogs", [
    { address: V4[chain].poolManager, topics, fromBlock, toBlock: "latest" },
  ]);
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result || [];
}

/** Every V4 pool ever initialized for a currency pair (or a specific poolId), hooks included. */
async function findV4Pools(chain, { currency0, currency1, poolId }) {
  const abiItem = viem.parseAbiItem(V4_INITIALIZE_EVENT);
  const topics = viem.encodeEventTopics({
    abi: [abiItem],
    eventName: "Initialize",
    args: poolId ? { id: poolId } : { currency0, currency1 },
  });
  let logs;
  try {
    logs = await v4GetLogs(chain, topics, "0x0");
  } catch {
    logs = await v4GetLogs(chain, topics, toHex(BigInt(V4_DEPLOY_BLOCK[chain])));
  }
  return logs.map(l => {
    const { args } = viem.decodeEventLog({ abi: [abiItem], data: l.data, topics: l.topics });
    return {
      poolId: args.id,
      currency0: args.currency0.toLowerCase(),
      currency1: args.currency1.toLowerCase(),
      fee: Number(args.fee),
      tickSpacing: Number(args.tickSpacing),
      hooks: args.hooks.toLowerCase(),
    };
  });
}

const UR_EXECUTE = {
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [
    { type: "bytes", name: "commands" },
    { type: "bytes[]", name: "inputs" },
    { type: "uint256", name: "deadline" },
  ],
  outputs: [],
};

/** Universal Router execute() calldata for a single V4 exact-in swap. */
function buildV4SwapCalldata(poolKey, zeroForOne, amount, minOut, isNativeIn) {
  const { V4Planner, Actions } = requireFrom("@uniswap/v4-sdk");
  const { RoutePlanner, CommandType } = requireFrom("@uniswap/universal-router-sdk");
  const planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
    { poolKey, zeroForOne, amountIn: amount.toString(), amountOutMinimum: minOut.toString(), hookData: "0x" },
  ]);
  planner.addAction(Actions.SETTLE_ALL, [zeroForOne ? poolKey.currency0 : poolKey.currency1, amount.toString()]);
  planner.addAction(Actions.TAKE_ALL, [zeroForOne ? poolKey.currency1 : poolKey.currency0, minOut.toString()]);
  const route = new RoutePlanner();
  route.addCommand(CommandType.V4_SWAP, [planner.actions, planner.params]);
  const deadline = Math.floor(Date.now() / 1000) + 1800;
  return {
    data: viem.encodeFunctionData({
      abi: [UR_EXECUTE],
      functionName: "execute",
      args: [route.commands, [planner.finalize()], BigInt(deadline)],
    }),
    value: isNativeIn ? toHex(amount) : "0x0",
    deadline,
  };
}

// ─── tools ───────────────────────────────────────────────────────────────────
const tools = {
  async simulateAssetChanges({ from, to, data, value, chainId }) {
    const chain = chainId ?? 1;
    const json = await rpc(alchemyUrl(chain), "alchemy_simulateAssetChanges", [{ from, to, data, value: value || "0x0" }]);
    if (json.error) return { success: false, error: json.error.message || JSON.stringify(json.error), changes: [] };
    const result = json.result;
    if (!result) return { success: false, error: "No result from simulation", changes: [] };
    if (result.error) return { success: false, error: result.error.message || result.error, changes: result.changes || [] };
    const wallet = (from || "").toLowerCase();
    const touchesWallet = c =>
      c.changeType !== "TRANSFER" || (c.from || "").toLowerCase() === wallet || (c.to || "").toLowerCase() === wallet;
    const changes = (result.changes || []).filter(touchesWallet).map(c => ({
      // direction relative to the user's wallet (Alchemy gives raw from/to)
      direction:
        c.changeType !== "TRANSFER"
          ? c.changeType
          : (c.to || "").toLowerCase() === wallet
            ? "in"
            : (c.from || "").toLowerCase() === wallet
              ? "out"
              : "out",
      symbol: c.symbol,
      amount: c.amount,
      rawAmount: c.rawAmount,
      decimals: c.decimals,
      assetType: c.assetType,
      contractAddress: c.contractAddress,
    }));
    return { success: true, changes };
  },

  async traceCall({ from, to, data, value, chainId }) {
    const chain = chainId ?? 1;
    const json = await rpc(alchemyUrl(chain), "debug_traceCall", [
      { from, to, data, value: value || "0x0" },
      "latest",
      { tracer: "callTracer" },
    ]);
    if (json.error)
      return {
        success: false,
        revertReason: json.error.message || JSON.stringify(json.error),
        gasUsed: "0x0",
        internalCalls: [],
        hasUnlimitedApproval: false,
      };
    const result = json.result;
    const internalCalls = [];
    let hasUnlimitedApproval = false;
    const MAX_UINT256 = "f".repeat(64);
    (function walk(calls) {
      for (const call of calls || []) {
        if (call.to) internalCalls.push({ to: call.to, input: (call.input || "0x").slice(0, 74), value: call.value || "0x0" });
        if (call.input && call.input.startsWith("0x095ea7b3") && call.input.includes(MAX_UINT256)) hasUnlimitedApproval = true;
        if (Array.isArray(call.calls)) walk(call.calls);
      }
    })(result.calls);
    return {
      success: !result.error,
      revertReason: result.error || undefined,
      gasUsed: result.gasUsed || "0x0",
      internalCalls: internalCalls.slice(0, 20),
      hasUnlimitedApproval,
    };
  },

  async getPortfolio({ address }) {
    const headers = zerionHeaders();
    const [walletRes, defiRes, portfolioRes] = await Promise.all([
      fetch(
        `https://api.zerion.io/v1/wallets/${address}/positions/?filter[positions]=only_simple&currency=usd&sort=-value&page[size]=100`,
        { headers },
      ),
      fetch(
        `https://api.zerion.io/v1/wallets/${address}/positions/?filter[positions]=only_complex&currency=usd&sort=-value&page[size]=100`,
        { headers },
      ),
      fetch(`https://api.zerion.io/v1/wallets/${address}/portfolio?currency=usd`, { headers }),
    ]);
    if (!walletRes.ok) return { error: `Zerion wallet positions error (${walletRes.status})` };
    const walletData = await walletRes.json();
    const assets = (walletData.data || [])
      .filter(p => p.attributes.flags.displayable && (p.attributes.value || 0) > 1)
      .map(mapZerionPosition)
      .sort((a, b) => parseFloat(b.balanceUsd) - parseFloat(a.balanceUsd));
    const totalBalanceUsd = assets.reduce((s, a) => s + parseFloat(a.balanceUsd), 0).toFixed(2);

    let defiPositions = [];
    if (defiRes.ok) {
      const defiData = await defiRes.json().catch(() => ({}));
      defiPositions = (defiData.data || [])
        .filter(p => p.attributes.flags.displayable && (p.attributes.value || 0) > 1)
        .map(mapZerionPosition)
        .sort((a, b) => parseFloat(b.balanceUsd) - parseFloat(a.balanceUsd));
    }
    const totalPortfolioUsd = defiPositions.reduce((s, p) => s + parseFloat(p.balanceUsd), 0).toFixed(2);

    let change1dUsd = "0",
      change1dPct = "0",
      chainBreakdown = {};
    if (portfolioRes.ok) {
      const pd = await portfolioRes.json().catch(() => ({}));
      const attrs = pd?.data?.attributes || {};
      change1dUsd = ((attrs.changes || {}).absolute_1d || 0).toFixed(2);
      change1dPct = ((attrs.changes || {}).percent_1d || 0).toFixed(2);
      chainBreakdown = attrs.positions_distribution_by_chain || {};
    }
    return { assets, defiPositions, totalBalanceUsd, totalPortfolioUsd, chainBreakdown, change1dUsd, change1dPct };
  },

  async searchTransactions({ address, tokenSymbol, chainId, operationType, afterDate, beforeDate, limit }) {
    const headers = zerionHeaders();
    const maxResults = Math.min(limit || 20, 100);
    let fungibleId = null;
    if (tokenSymbol) {
      const fRes = await fetch(
        `https://api.zerion.io/v1/fungibles/?filter[search_query]=${encodeURIComponent(tokenSymbol)}&currency=usd`,
        { headers },
      );
      if (fRes.ok) {
        const fData = await fRes.json();
        const match = (fData.data || []).find(f => f.attributes?.symbol?.toLowerCase() === tokenSymbol.toLowerCase());
        fungibleId = match?.id || null;
      }
    }
    const params = new URLSearchParams();
    params.set("currency", "usd");
    params.set("page[size]", "100");
    params.set("sort", "-mined_at");
    if (fungibleId) params.set("filter[fungible_ids]", fungibleId);
    if (chainId) params.set("filter[chain_ids]", chainId);
    if (operationType) params.set("filter[operation_types]", operationType);
    const res = await fetch(`https://api.zerion.io/v1/wallets/${address}/transactions/?${params}`, { headers });
    if (!res.ok) return { error: `Zerion API error: ${res.status}` };
    const data = await res.json();
    const items = (data.data || []).filter(tx => {
      const minedAt = tx.attributes?.mined_at || "";
      if (afterDate && minedAt < afterDate) return false;
      if (beforeDate && minedAt > beforeDate) return false;
      return true;
    });
    const results = items.slice(0, maxResults).map(tx => {
      const attrs = tx.attributes;
      return {
        date: attrs.mined_at,
        type: attrs.operation_type,
        chain: tx.relationships?.chain?.data?.id,
        hash: attrs.hash,
        from: attrs.sent_from,
        to: attrs.sent_to,
        transfers: (attrs.transfers || []).map(t => ({
          direction: t.direction,
          symbol: t.fungible_info?.symbol,
          name: t.fungible_info?.name,
          amount: t.quantity?.float,
          valueUsd: t.value,
          pricePerToken: t.price,
        })),
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
    return { found: true, totalFound: items.length, returned: results.length, tokenSymbol, fungibleIdResolved: fungibleId, transactions: results };
  },

  async getTransactionDetails({ hash, chain }) {
    const res = await fetch(`https://api.zerion.io/v1/transactions/${hash}?currency=usd`, { headers: zerionHeaders() });
    if (res.ok) {
      const data = await res.json();
      const attrs = data.data?.attributes || {};
      return {
        hash,
        chain: data.data?.relationships?.chain?.data?.id || chain,
        from: attrs.sent_from,
        to: attrs.sent_to,
        status: attrs.status,
        minedAt: attrs.mined_at,
        fee: attrs.fee,
        transfers: (attrs.transfers || []).map(t => ({
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
    const rpcUrl = RPC_URLS[chain]?.();
    if (!rpcUrl) return { error: `Chain ${chain} not supported for direct lookup` };
    const rpcData = await rpc(rpcUrl, "eth_getTransactionByHash", [hash]);
    const tx = rpcData.result;
    if (!tx) return { error: "Transaction not found" };
    return { hash, chain, from: tx.from, to: tx.to, value: tx.value, blockNumber: parseInt(tx.blockNumber, 16), gas: parseInt(tx.gas, 16) };
  },

  async getOnChainBalance({ walletAddress, chain, tokenAddress, tokenSymbol, tokenDecimals }) {
    const rpcUrl = RPC_URLS[chain]?.();
    if (!rpcUrl) return { error: `Chain '${chain}' not supported` };
    const isNative =
      !tokenAddress ||
      tokenAddress === "0x0000000000000000000000000000000000000000" ||
      tokenAddress === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ||
      tokenAddress === "";
    if (isNative) {
      const data = await rpc(rpcUrl, "eth_getBalance", [walletAddress, "latest"]);
      const balance = Number(BigInt(data.result || "0x0")) / 1e18;
      return { walletAddress, chain, token: tokenSymbol || "ETH", balance: balance.toFixed(6), raw: data.result };
    }
    const decimals = tokenDecimals ?? 18;
    const data = await rpc(rpcUrl, "eth_call", [{ to: tokenAddress, data: "0x70a08231" + padAddress(walletAddress) }, "latest"]);
    if (data.error) return { error: data.error.message };
    const balance = Number(BigInt(data.result || "0x0")) / Math.pow(10, decimals);
    return {
      walletAddress,
      chain,
      token: tokenSymbol || tokenAddress,
      tokenAddress,
      balance: balance.toFixed(decimals > 6 ? 6 : decimals),
      raw: data.result,
    };
  },

  async getTokenPrice({ symbol }) {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`,
      { headers: { accept: "application/json" } },
    );
    const data = await res.json();
    if (data[symbol.toLowerCase()])
      return { symbol, priceUsd: data[symbol.toLowerCase()].usd, change24h: data[symbol.toLowerCase()].usd_24h_change };
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${symbol}`);
    const coin = (await searchRes.json()).coins?.[0];
    if (coin) {
      const priceRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd&include_24hr_change=true`,
      );
      const priceData = await priceRes.json();
      return { symbol, name: coin.name, priceUsd: priceData[coin.id]?.usd, change24h: priceData[coin.id]?.usd_24h_change };
    }
    return { error: "Token not found" };
  },

  async getWalletActivity({ address, limit }) {
    const fetchLimit = limit ?? 20;
    const res = await fetch(
      `https://api.zerion.io/v1/wallets/${address}/transactions/?currency=usd&page[size]=${fetchLimit}&sort=-mined_at`,
      { headers: zerionHeaders() },
    );
    const data = await res.json();
    return {
      transactions: (data.data || []).slice(0, fetchLimit).map(tx => {
        const attrs = tx.attributes;
        return {
          date: attrs.mined_at?.slice(0, 10),
          type: attrs.operation_type,
          chain: tx.relationships?.chain?.data?.id,
          status: attrs.status,
          transfers: (attrs.transfers || []).map(t => ({
            direction: t.direction,
            symbol: t.fungible_info?.symbol,
            amount: t.quantity?.float?.toFixed(4),
            valueUsd: t.value?.toFixed(2),
          })),
          hash: attrs.hash,
        };
      }),
    };
  },

  async buildRoute({ fromToken, toToken, amountIn, fromChainId, toChainId, fromAddress }) {
    const url = `https://li.quest/v1/quote?fromChain=${fromChainId}&toChain=${toChainId}&fromToken=${fromToken}&toToken=${toToken}&fromAmount=${amountIn}&fromAddress=${fromAddress}&slippage=0.005`;
    const res = await fetch(url, { headers: { "x-lifi-api-key": LIFI_KEY } });
    if (!res.ok) return { error: `LI.FI API error (${res.status}): ${await res.text()}` };
    const data = await res.json();
    if (data.transactionRequest) {
      return {
        to: data.transactionRequest.to,
        data: data.transactionRequest.data,
        value: data.transactionRequest.value || "0x0",
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
  },

  async getRouteStatus({ txHash, fromChain, toChain }) {
    const res = await fetch(`https://li.quest/v1/status?txHash=${txHash}&fromChain=${fromChain}&toChain=${toChain}`, {
      headers: { "x-lifi-api-key": LIFI_KEY },
    });
    if (!res.ok) return { error: `LI.FI status API error (${res.status}): ${await res.text()}` };
    const data = await res.json();
    const leg = l => (l ? { txHash: l.txHash, amount: l.amount, token: l.token?.symbol, chainId: l.chainId } : undefined);
    return {
      status: data.status,
      substatus: data.substatus,
      substatusMessage: data.substatusMessage,
      sending: leg(data.sending),
      receiving: leg(data.receiving),
    };
  },

  async buildTransfer({ to, amount, token, chainId, tokenDecimals }) {
    const chain = chainId ?? 1;
    const decimals = tokenDecimals ?? 18;
    if (token.toUpperCase() === "ETH") return { to, data: "0x", value: toHex(safeBigInt(amount, 18)), chainId: chain };
    return { to: token, data: "0xa9059cbb" + padAddress(to) + padUint256(safeBigInt(amount, decimals)), value: "0x0", chainId: chain };
  },

  async resolveENS({ name }) {
    const res = await fetch(`https://api.ensideas.com/ens/resolve/${name}`);
    if (!res.ok) return { error: `ENS resolution failed (${res.status})` };
    const data = await res.json();
    return { address: data.address, name: data.name, displayName: data.displayName, avatar: data.avatar };
  },

  async getTokenAddress({ symbol, chainId }) {
    const upper = symbol.toUpperCase();
    const chainTokens = TOKEN_ADDRESS_FILE.tokens[String(chainId)];
    if (chainTokens) {
      if (chainTokens[upper]) return chainTokens[upper];
      const match = Object.entries(chainTokens).find(([k]) => k.toUpperCase() === upper);
      if (match) return match[1];
    }
    const res = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`, { headers: { "x-lifi-api-key": LIFI_KEY } });
    if (!res.ok) return { error: `LI.FI token search failed (${res.status})` };
    const data = await res.json();
    const exact = (data.tokens?.[String(chainId)] || []).find(t => t.symbol.toUpperCase() === upper);
    if (exact) return { address: exact.address, decimals: exact.decimals, name: exact.name };
    return { error: `Token '${symbol}' not found on chain ${chainId}` };
  },

  async wrapEth({ amount, chainId }) {
    const chain = chainId ?? 1;
    return { to: chain === 8453 ? WETH_BASE : WETH_MAINNET, data: "0xd0e30db0", value: toHex(safeBigInt(amount, 18)), chainId: chain };
  },

  async unwrapWeth({ amount, chainId }) {
    const chain = chainId ?? 1;
    return {
      to: chain === 8453 ? WETH_BASE : WETH_MAINNET,
      data: "0x2e1a7d4d" + padUint256(safeBigInt(amount, 18)),
      value: "0x0",
      chainId: chain,
    };
  },

  async validateENSName({ name }) {
    const label = name.replace(/\.eth$/i, "").toLowerCase();
    const err = validateEnsLabel(label);
    return err ? { valid: false, name: label, error: err } : { valid: true, name: label };
  },

  async checkENSAvailability({ name }) {
    const label = name.replace(/\.eth$/i, "").toLowerCase();
    const err = validateEnsLabel(label);
    if (err) return { available: false, name: label, valid: false, error: err };
    const node = namehash(`${label}.eth`);
    const json = await rpc("https://mainnet.rpc.buidlguidl.com", "eth_call", [
      { to: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e", data: "0x02571be3" + node.replace("0x", "") },
      "latest",
    ]);
    const result = json?.result;
    const owner = "0x" + result?.slice(-40);
    const available = !result || owner === "0x0000000000000000000000000000000000000000";
    return { available, valid: true, name: label };
  },

  async getENSRentPrice({ name, years = 1 }) {
    const label = name.replace(/\.eth$/i, "");
    const duration = BigInt(Math.round(years * 365 * 24 * 60 * 60));
    const calldata = "0x83e7f6ff" + padUint256(64n) + padUint256(duration) + encodeString(label);
    const json = await rpc(alchemyUrl(1), "eth_call", [{ to: ENS_REGISTRAR, data: calldata }, "latest"]);
    if (json.error) return { error: json.error.message || JSON.stringify(json.error) };
    const result = (json.result || "0x").replace("0x", "");
    const base = BigInt("0x" + (result.slice(0, 64) || "0"));
    const premium = BigInt("0x" + (result.slice(64, 128) || "0"));
    const total = base + premium;
    return {
      priceWei: total.toString(),
      priceEth: (Number(total) / 1e18).toFixed(6),
      baseWei: base.toString(),
      premiumWei: premium.toString(),
      years,
      name: label,
    };
  },

  async buildENSRegistration({ name, owner, years = 1 }) {
    const label = name.replace(/\.eth$/i, "").toLowerCase();
    const duration = BigInt(Math.round(years * 365 * 24 * 60 * 60));
    const err = validateEnsLabel(label);
    if (err) return { error: err };
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const secretHex = "0x" + Array.from(secretBytes, b => b.toString(16).padStart(2, "0")).join("");

    const priceCalldata = "0x83e7f6ff" + padUint256(64n) + padUint256(duration) + encodeString(label);
    const priceJson = await rpc(alchemyUrl(1), "eth_call", [{ to: ENS_REGISTRAR, data: priceCalldata }, "latest"]);
    if (priceJson.error) return { error: `Failed to get rent price: ${priceJson.error.message || JSON.stringify(priceJson.error)}` };
    const priceResult = (priceJson.result || "0x").replace("0x", "");
    const base = BigInt("0x" + (priceResult.slice(0, 64) || "0"));
    const premium = BigInt("0x" + (priceResult.slice(64, 128) || "0"));
    const totalPrice = base + premium;
    const valueWithBuffer = (totalPrice * 110n) / 100n;
    const priceEth = Number(totalPrice) / 1e18;

    const params = encodeENSParams(label, owner, duration, secretHex, ENS_PUBLIC_RESOLVER, true, 0);
    const commitmentJson = await rpc(alchemyUrl(1), "eth_call", [{ to: ENS_REGISTRAR, data: "0x65a69dcf" + params }, "latest"]);
    if (commitmentJson.error)
      return { error: `Failed to compute commitment: ${commitmentJson.error.message || JSON.stringify(commitmentJson.error)}` };
    const commitment = commitmentJson.result;

    return {
      type: "multistep_transaction",
      message: `I'll register **${label}.eth** for you. This is a 2-step process:\n1. **Commit** — locks in your registration intent (gas only)\n2. **Wait 60 seconds** — required by the ENS contract\n3. **Register** — completes registration (${priceEth.toFixed(4)} ETH + gas)`,
      steps: [
        {
          to: ENS_REGISTRAR,
          data: "0xf14fcbc8" + commitment.replace("0x", "").padStart(64, "0"),
          value: "0x0",
          chainId: 1,
          description: `Step 1 of 2: Commit to register ${label}.eth`,
          label: "Commit",
        },
        {
          to: ENS_REGISTRAR,
          data: "0x74694a2b" + params,
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
  },

  async logMiss({ userRequest, reason, category }) {
    const gistId = process.env.MISS_LOG_GIST_ID;
    const token = process.env.GITHUB_GIST_TOKEN;
    if (!gistId || !token) return { logged: false };
    try {
      const getRes = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "denarai" },
      });
      const gist = await getRes.json();
      const current = JSON.parse(gist?.files?.["misses.json"]?.content ?? "[]");
      current.push({ ts: new Date().toISOString(), userRequest, reason, category, engine: "claude-p" });
      await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "denarai", "Content-Type": "application/json" },
        body: JSON.stringify({ files: { "misses.json": { content: JSON.stringify(current.slice(-500), null, 2) } } }),
      });
      return { logged: true };
    } catch {
      return { logged: false };
    }
  },

  async buildUniV4Swap({ tokenIn, tokenOut, amountIn, chainId, fromAddress, slippagePct, fee, tickSpacing, hooks, poolId }) {
    const chain = chainId ?? 1;
    const v4 = V4[chain];
    if (!v4) return { error: `Uniswap V4 swaps supported on chains ${Object.keys(V4).join(", ")} — got ${chain}` };

    const norm = t => (!t || t.toUpperCase?.() === "ETH" || t === NATIVE ? NATIVE : t.toLowerCase());
    const inAddr = norm(tokenIn);
    const outAddr = norm(tokenOut);
    if (inAddr === outAddr) return { error: "tokenIn and tokenOut are the same" };
    const [currency0, currency1] = [inAddr, outAddr].sort();
    const zeroForOne = inAddr === currency0;
    const amount = safeBigInt(amountIn, 0); // raw units expected; hex ok
    if (amount <= 0n) return { error: "amountIn must be > 0 (raw units)" };
    if (amount >= 1n << 128n) return { error: "amountIn exceeds uint128" };

    // 1. Collect candidate PoolKeys:
    //    - explicit fee/tickSpacing/hooks or poolId → just that pool
    //    - otherwise the PoolManager's Initialize logs are the ground truth for
    //      EVERY pool ever created for this pair — hooked and non-standard
    //      included. (No app, no indexer: the chain itself.)
    let candidates;
    if (fee != null) {
      const ts = tickSpacing ?? { 100: 1, 500: 10, 3000: 60, 10000: 200 }[fee];
      if (ts == null) return { error: `tickSpacing required for non-standard fee ${fee}` };
      candidates = [{ currency0, currency1, fee, tickSpacing: ts, hooks: (hooks || NATIVE).toLowerCase() }];
    } else if (poolId) {
      candidates = await findV4Pools(chain, { poolId });
      if (candidates.length === 0) return { error: `No Initialize event found for poolId ${poolId} on chain ${chain}` };
      const c = candidates[0];
      if (c.currency0 !== currency0 || c.currency1 !== currency1)
        return { error: `poolId ${poolId} is for pair ${c.currency0}/${c.currency1}, not the requested tokens` };
    } else {
      candidates = await findV4Pools(chain, { currency0, currency1 });
      if (candidates.length === 0)
        return { error: `No V4 pool has ever been initialized for this pair on chain ${chain} (checked PoolManager Initialize logs).` };
    }

    // 2. Liquidity-sweep all candidates in parallel, then quote the live ones.
    //    Policy: best HOOKLESS pool wins; unknown hooks are only considered when
    //    no hookless pool can serve, and the result carries a hookWarning —
    //    a too-good quote from an arbitrary hook is how users get rugged.
    const keys = candidates.map(c => ({ currency0, currency1, fee: c.fee, tickSpacing: c.tickSpacing, hooks: c.hooks }));
    const liqs = await Promise.all(
      keys.map(key =>
        v4EthCall(chain, v4.stateView, STATEVIEW_GET_LIQUIDITY, [v4PoolId(key)]).then(
          ([liq]) => liq,
          () => 0n,
        ),
      ),
    );
    const live = keys.map((key, i) => ({ key, liq: liqs[i] })).filter(p => p.liq > 0n);
    const failures = [];
    const quoted = (
      await Promise.all(
        live.map(p =>
          v4EthCall(chain, v4.quoter, QUOTER_EXACT_IN_SINGLE, [
            { poolKey: p.key, zeroForOne, exactAmount: amount, hookData: "0x" },
          ]).then(
            ([out]) => ({ ...p, out }),
            e => {
              failures.push(`fee ${p.key.fee}/${p.key.tickSpacing}${p.key.hooks !== NATIVE ? ` hooks ${p.key.hooks.slice(0, 10)}…` : ""}: ${e.message?.slice(0, 80)}`);
              return null;
            },
          ),
        ),
      )
    ).filter(Boolean);
    const best = arr => arr.reduce((a, b) => (b.out > (a?.out ?? 0n) ? b : a), null);
    const bestHookless = best(quoted.filter(p => p.key.hooks === NATIVE));
    const bestHooked = best(quoted.filter(p => p.key.hooks !== NATIVE));
    let pick = bestHookless || bestHooked;
    let quoteSource = "quoter";

    // Some hooks revert the official Quoter even though real swaps work fine
    // (the pool has live liquidity + volume). Fall back to quote-by-simulation:
    // build the swap with a floor minimum, simulate it, read the actual output.
    // Only possible when the input side needs no approvals (native ETH in, or
    // approvals already granted) — simulation can't fake an allowance.
    if (!pick && live.length > 0) {
      const cand = live.reduce((a, b) => (b.liq > (a?.liq ?? 0n) ? b : a), null);
      const probe = buildV4SwapCalldata(cand.key, zeroForOne, amount, 1n, inAddr === NATIVE);
      try {
        const sim = await tools.simulateAssetChanges({
          from: fromAddress,
          to: v4.universalRouter,
          data: probe.data,
          value: probe.value,
          chainId: chain,
        });
        const outAddrLc = outAddr === NATIVE ? null : outAddr;
        const inChange = (sim.changes || []).find(
          c => c.direction === "in" && (outAddrLc ? (c.contractAddress || "").toLowerCase() === outAddrLc : c.assetType === "NATIVE"),
        );
        if (sim.success && inChange?.rawAmount) {
          pick = { key: cand.key, liq: cand.liq, out: BigInt(inChange.rawAmount) };
          quoteSource = "simulation";
        } else if (!sim.success) {
          failures.push(`simulation probe: ${sim.error || "reverted"}`);
        }
      } catch (e) {
        failures.push(`simulation probe: ${e.message?.slice(0, 80)}`);
      }
    }

    if (!pick) {
      // Trace one live pool so the failure is explainable rather than mysterious:
      // the deepest reverting frame names the contract that rejected the swap
      // (usually the hook), which the agent can then read with getContractSource.
      let rejectedBy = null;
      if (live.length > 0) {
        try {
          const cand = live.reduce((a, b) => (b.liq > (a?.liq ?? 0n) ? b : a), null);
          const probe = buildV4SwapCalldata(cand.key, zeroForOne, amount, 1n, inAddr === NATIVE);
          const t = await tools.traceCall({
            from: fromAddress,
            to: v4.universalRouter,
            data: probe.data,
            value: probe.value,
            chainId: chain,
          });
          const deepest = (t.internalCalls || []).slice(-1)[0];
          if (deepest) {
            rejectedBy = deepest.to;
            if (cand.key.hooks !== NATIVE && deepest.to?.toLowerCase() === cand.key.hooks)
              rejectedBy = `${deepest.to} (the pool's HOOK — read it with getContractSource to find the gate, e.g. a buys-disabled flag or allowlist)`;
          }
        } catch {
          /* best effort */
        }
      }
      return {
        error:
          live.length > 0
            ? `${live.length} live V4 pool(s) for this pair on chain ${chain} but neither the Quoter nor a simulation probe could price this swap${inAddr !== NATIVE ? " (note: ERC-20 input can only be simulation-quoted after approvals exist — try the ETH side, or complete approvals first)" : ""}.`
            : `Found ${candidates.length} pool(s) via Initialize logs but none has liquidity.`,
        quoteFailures: failures.slice(0, 4),
        rejectedBy,
        nextStep: rejectedBy
          ? "Call getContractSource on the rejecting contract (grep for 'revert' / 'Swap') and ethCall any gate flags it exposes, then tell the user the REAL reason."
          : undefined,
      };
    }
    const poolKey = pick.key;
    const poolLiquidity = pick.liq;
    const amountOut = pick.out;
    const hookWarning =
      poolKey.hooks !== NATIVE
        ? `This pool uses a custom hook (${poolKey.hooks}) — behavior at execution can differ from the quote. Simulation is mandatory; tell the user about the hook.`
        : undefined;
    // Simulation-derived quotes get a wider default slippage floor — the sim
    // reflects one block's state, and hooked pools can move fees per-swap.
    const slipBps = BigInt(Math.round((slippagePct ?? (quoteSource === "simulation" ? 2 : 1)) * 100));
    const minOut = (amountOut * (10000n - slipBps)) / 10000n;

    // 3. Encode the swap via Uniswap's own SDKs (V4Planner + RoutePlanner)
    const built = buildV4SwapCalldata(poolKey, zeroForOne, amount, minOut, inAddr === NATIVE);
    const swapData = built.data;
    const deadline = built.deadline;

    const quote = {
      pool: { ...poolKey, liquidity: poolLiquidity.toString() },
      amountIn: amount.toString(),
      amountOut: amountOut.toString(),
      amountOutMinimum: minOut.toString(),
      slippagePct: Number(slipBps) / 100,
      quoteSource,
      ...(hookWarning ? { hookWarning } : {}),
    };

    const swapTx = {
      to: v4.universalRouter,
      data: swapData,
      value: inAddr === NATIVE ? toHex(amount) : "0x0",
      chainId: chain,
    };

    // 4. Native input needs no approvals — single transaction.
    if (inAddr === NATIVE) return { ...swapTx, quote };

    // ERC-20 input: Universal Router pulls through Permit2, so check both hops
    if (!fromAddress) return { error: "fromAddress required for ERC-20 input (approval checks)" };
    const steps = [];
    try {
      const [erc20Allow] = await v4EthCall(chain, inAddr, ERC20_ALLOWANCE, [fromAddress, PERMIT2]);
      if (erc20Allow < amount) {
        steps.push({
          to: inAddr,
          data: viem.encodeFunctionData({
            abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }],
            functionName: "approve",
            args: [PERMIT2, viem.maxUint256],
          }),
          value: "0x0",
          chainId: chain,
          description: "Approve token for Permit2 (one-time)",
          label: "Approve",
        });
      }
      const [p2Amount, p2Exp] = await v4EthCall(chain, PERMIT2, PERMIT2_ALLOWANCE, [fromAddress, inAddr, v4.universalRouter]);
      if (p2Amount < amount || p2Exp <= Math.floor(Date.now() / 1000)) {
        steps.push({
          to: PERMIT2,
          data: viem.encodeFunctionData({
            abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address", name: "token" }, { type: "address", name: "spender" }, { type: "uint160", name: "amount" }, { type: "uint48", name: "expiration" }], outputs: [] }],
            functionName: "approve",
            args: [inAddr, v4.universalRouter, (1n << 160n) - 1n, deadline + 30 * 24 * 3600],
          }),
          value: "0x0",
          chainId: chain,
          description: "Authorize Uniswap Universal Router via Permit2",
          label: "Permit2",
        });
      }
    } catch (e) {
      return { error: `Allowance check failed: ${e.message}` };
    }

    if (steps.length === 0) return { ...swapTx, quote };
    steps.push({ ...swapTx, description: "Swap via Uniswap V4", label: "Swap" });
    return {
      type: "multistep_transaction",
      steps,
      delay: 3000,
      quote,
      note: `${steps.length - 1} approval step(s) needed before the swap (token → Permit2 → Universal Router).`,
    };
  },

  // ─── generic on-chain research: read ANY contract state or event history ──

  async ethCall({ to, signature, args, chainId, chain }) {
    const rpcUrl = chain ? RPC_URLS[chain]?.() : alchemyUrl(chainId ?? 1);
    if (!rpcUrl) return { error: `Unknown chain '${chain}'` };
    try {
      const abiItem = viem.parseAbiItem(signature.startsWith("function") ? signature : `function ${signature}`);
      const data = viem.encodeFunctionData({ abi: [abiItem], functionName: abiItem.name, args: args || [] });
      const json = await rpc(rpcUrl, "eth_call", [{ to, data }, "latest"]);
      if (json.error) return { error: json.error.message || JSON.stringify(json.error) };
      if (!json.result || json.result === "0x") return { error: "empty return (wrong address, signature, or reverted)" };
      const decoded = viem.decodeFunctionResult({ abi: [abiItem], functionName: abiItem.name, data: json.result });
      const jsonify = v =>
        typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(jsonify) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonify(x)])) : v;
      return { result: jsonify(decoded) };
    } catch (e) {
      return { error: `ethCall failed: ${e.message}` };
    }
  },

  async getLogs({ address, eventSignature, indexedArgs, fromBlock, toBlock, chainId, chain, limit }) {
    const rpcUrl = chain ? RPC_URLS[chain]?.() : alchemyUrl(chainId ?? 1);
    if (!rpcUrl) return { error: `Unknown chain '${chain}'` };
    try {
      const abiItem = viem.parseAbiItem(eventSignature.startsWith("event") ? eventSignature : `event ${eventSignature}`);
      const topics = viem.encodeEventTopics({ abi: [abiItem], eventName: abiItem.name, args: indexedArgs || {} });
      const json = await rpc(rpcUrl, "eth_getLogs", [
        {
          address,
          topics,
          fromBlock: fromBlock != null ? toHex(BigInt(fromBlock)) : "0x0",
          toBlock: toBlock != null ? toHex(BigInt(toBlock)) : "latest",
        },
      ]);
      if (json.error) return { error: json.error.message || JSON.stringify(json.error), hint: "Alchemy caps log queries — narrow the block range or add indexed filters." };
      const jsonify = v =>
        typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(jsonify) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonify(x)])) : v;
      const logs = (json.result || []).slice(0, Math.min(limit || 25, 100)).map(l => {
        try {
          const { args: a } = viem.decodeEventLog({ abi: [abiItem], data: l.data, topics: l.topics });
          return { blockNumber: parseInt(l.blockNumber, 16), txHash: l.transactionHash, args: jsonify(a) };
        } catch {
          return { blockNumber: parseInt(l.blockNumber, 16), txHash: l.transactionHash, raw: { data: l.data, topics: l.topics } };
        }
      });
      return { totalFound: (json.result || []).length, returned: logs.length, logs };
    } catch (e) {
      return { error: `getLogs failed: ${e.message}` };
    }
  },

  async getCode({ address, chainId, chain }) {
    const rpcUrl = chain ? RPC_URLS[chain]?.() : alchemyUrl(chainId ?? 1);
    if (!rpcUrl) return { error: `Unknown chain '${chain}'` };
    const json = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
    if (json.error) return { error: json.error.message };
    const code = json.result || "0x";
    // EIP-1967 implementation slot — detect proxies so research follows the real logic
    const slot = await rpc(rpcUrl, "eth_getStorageAt", [address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"]);
    const impl = slot.result && BigInt(slot.result) !== 0n ? "0x" + slot.result.slice(-40) : null;
    return { isContract: code !== "0x", codeSize: (code.length - 2) / 2, eip1967Implementation: impl };
  },

  async getContractSource({ address, chain, chainId, grep, maxChars }) {
    const CHAIN_HOSTS = {
      1: "eth.blockscout.com",
      8453: "base.blockscout.com",
      42161: "arbitrum.blockscout.com",
      10: "optimism.blockscout.com",
      137: "polygon.blockscout.com",
      100: "gnosis.blockscout.com",
    };
    const NAMED = { ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137, gnosis: 100, xdai: 100 };
    const id = chainId ?? NAMED[chain] ?? 1;
    const host = CHAIN_HOSTS[id];
    if (!host) return { error: `No source explorer configured for chain ${chain ?? id}` };
    try {
      const res = await fetch(`https://${host}/api/v2/smart-contracts/${address}`, { headers: { accept: "application/json" } });
      if (!res.ok) return { error: `Explorer returned ${res.status} — contract may be unverified` };
      const d = await res.json();
      const src = d.source_code || "";
      if (!src) return { name: d.name || null, verified: false, error: "Source not verified for this address" };
      const abiFns = (d.abi || [])
        .filter(x => x.type === "function")
        .map(x => `${x.name}(${(x.inputs || []).map(i => i.type).join(",")})${x.stateMutability === "view" ? " view" : ""}`);
      const out = { name: d.name || null, verified: true, isProxy: !!d.is_proxy, implementation: d.implementations?.[0]?.address || null, functions: abiFns.slice(0, 80), sourceChars: src.length };
      if (grep) {
        // return the regions around each match — how you read a big contract cheaply
        const re = new RegExp(grep, "gi");
        const hits = [];
        let m;
        while ((m = re.exec(src)) && hits.length < 8) hits.push(src.slice(Math.max(0, m.index - 300), m.index + 900));
        out.matches = hits;
        out.matchCount = hits.length;
      } else {
        out.source = src.slice(0, Math.min(maxChars || 6000, 20000));
        out.truncated = src.length > (maxChars || 6000);
      }
      return out;
    } catch (e) {
      return { error: `getContractSource failed: ${e.message}` };
    }
  },

  async getTokenLiquidity({ tokenAddress, chain }) {
    const chainMap = {
      ethereum: "eth",
      base: "base",
      arbitrum: "arbitrum",
      optimism: "optimism",
      polygon: "polygon",
      gnosis: "xdai",
      xdai: "xdai",
      "binance-smart-chain": "bsc",
      avalanche: "avax",
      zksync: "zksync",
      scroll: "scroll",
      linea: "linea",
      mantle: "mantle",
    };
    const network = chainMap[chain] || chain;
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddress}/pools?page=1`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { error: `GeckoTerminal API error: ${res.status}` };
    const data = await res.json();
    const pools = (data.data || []).map(p => ({
      dex: p.relationships?.dex?.data?.id,
      poolAddress: p.attributes?.address,
      name: p.attributes?.name,
      liquidityUsd: parseFloat(p.attributes?.reserve_in_usd || "0"),
      volume24hUsd: parseFloat(p.attributes?.volume_usd?.h24 || "0"),
      priceUsd: p.attributes?.base_token_price_usd,
    }));
    if (pools.length === 0) {
      return {
        found: false,
        tokenAddress,
        chain,
        message: `No liquidity pools found for ${tokenAddress} on ${chain}. The token may not be tradeable on any DEX.`,
      };
    }
    const totalLiquidity = pools.reduce((s, p) => s + p.liquidityUsd, 0);
    return {
      found: true,
      tokenAddress,
      chain,
      totalLiquidityUsd: totalLiquidity,
      poolCount: pools.length,
      bestPool: pools[0],
      pools: pools.slice(0, 5),
      swappable: totalLiquidity > 10,
      warning:
        totalLiquidity < 100 ? `Very low liquidity ($${totalLiquidity.toFixed(2)}) — expect high slippage or swap failure` : undefined,
    };
  },
};

// ─── main ────────────────────────────────────────────────────────────────────
const [, , toolName, argsJson] = process.argv;
if (!toolName || !tools[toolName]) {
  console.error(`usage: wallet.mjs <tool> '<json-args>'\ntools: ${Object.keys(tools).join(", ")}`);
  process.exit(2);
}
let args = {};
try {
  args = argsJson ? JSON.parse(argsJson) : {};
} catch {
  console.error(`invalid JSON args: ${argsJson}`);
  process.exit(2);
}
try {
  const result = await tools[toolName](args);
  console.log(JSON.stringify(result, null, 1));
} catch (e) {
  console.log(JSON.stringify({ error: `${toolName} failed: ${e?.message || e}` }));
}
