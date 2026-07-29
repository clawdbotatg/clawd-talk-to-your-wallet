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
// viem is installed under packages/nextjs — resolve from there
const { namehash } = createRequire(join(REPO_ROOT, "packages", "nextjs", "package.json"))("viem/ens");
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
    const changes = (result.changes || []).map(c => ({
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
