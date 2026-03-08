"use client";

import React from "react";
import AddressChip from "./AddressChip";
import AssetChip from "./AssetChip";

interface ChatMessageRendererProps {
  content: string;
  portfolio?: { tokenSymbol: string; thumbnail?: string }[];
}

// Matches 0x + 40 hex chars (Ethereum addresses)
const ADDRESS_RE = /\b(0x[a-fA-F0-9]{40})\b/g;

// Matches ENS names like austingriffith.eth, clawd.atg.eth
const ENS_RE = /\b([a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+)*\.eth)\b/g;

// Chain names we recognize (case-insensitive)
const CHAIN_NAMES = [
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "gnosis",
  "xdai",
  "linea",
  "scroll",
  "zksync",
  "mantle",
  "monad",
  "abstract",
  "zora",
  "unichain",
  "bsc",
  "binance",
];

// Normalize chain name to canonical key used by AssetChip/CHAIN_ICONS
const CHAIN_NORMALIZE: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon",
  gnosis: "gnosis",
  xdai: "xdai",
  linea: "linea",
  scroll: "scroll",
  zksync: "zksync-era",
  mantle: "mantle",
  monad: "monad",
  abstract: "abstract",
  zora: "zora",
  unichain: "unichain",
  bsc: "binance-smart-chain",
  binance: "binance-smart-chain",
};

const CHAIN_PATTERN = CHAIN_NAMES.join("|");

// "179.08 USDC on Base" or "179 USDC on Base"
const ASSET_CHAIN_RE = new RegExp(
  `\\b(\\d+(?:[.,]\\d+)?(?:e-?\\d+)?)\\s+([A-Z]{2,10})\\s+on\\s+(${CHAIN_PATTERN})\\b`,
  "gi",
);

// "USDC on Base" (no amount)
const SYMBOL_CHAIN_RE = new RegExp(`\\b([A-Z]{2,10})\\s+on\\s+(${CHAIN_PATTERN})\\b`, "gi");

// "179.08 USDC" (amount + symbol, no chain)
const ASSET_AMOUNT_RE = /\b(\d+(?:[.,]\d+)?(?:e-?\d+)?)\s+([A-Z]{2,10})\b/g;

// Known tokens — prevents false positives for bare symbol matches
const KNOWN_SYMBOLS = new Set([
  "ETH",
  "WETH",
  "USDC",
  "USDT",
  "DAI",
  "WBTC",
  "GNO",
  "ARB",
  "OP",
  "MATIC",
  "POL",
  "MNT",
  "PENDLE",
  "ZORA",
  "DEGEN",
  "RNBW",
  "SCR",
  "MON",
  "CLAWD",
  "CLAWNCH",
  "ABS",
  "VIBE",
  "GIV",
  "HNY",
  "RAID",
  "XDAI",
  "STAKE",
  "LOOKS",
  "ALEX",
  "FOX",
  "LPT",
  "BNKRW",
  "LVUSDC",
  "SALT",
  "WRLD",
  "SOCIAL",
  "JOON",
  "DREAMBOY",
  "BNB",
  "wstETH",
  "weETH",
]);

export default function ChatMessageRenderer({ content, portfolio }: ChatMessageRendererProps) {
  // Build a symbol→thumbnail map from portfolio
  const thumbnailMap: Record<string, string> = {};
  if (portfolio) {
    for (const asset of portfolio) {
      if (asset.thumbnail && !thumbnailMap[asset.tokenSymbol]) {
        thumbnailMap[asset.tokenSymbol] = asset.thumbnail;
      }
    }
  }

  const segments = parseContent(content, thumbnailMap);

  return (
    <p className="text-sm whitespace-pre-wrap leading-relaxed">
      {segments.map((seg, i) => {
        if (seg.type === "text") return <React.Fragment key={i}>{seg.value}</React.Fragment>;
        if (seg.type === "address") return <AddressChip key={i} address={seg.value} />;
        if (seg.type === "ens") return <AddressChip key={i} address={seg.value} ens={seg.value} />;
        if (seg.type === "asset")
          return (
            <AssetChip
              key={i}
              symbol={seg.symbol!}
              amount={seg.amount}
              chain={seg.chain}
              thumbnail={thumbnailMap[seg.symbol!]}
            />
          );
        return null;
      })}
    </p>
  );
}

type Segment =
  | { type: "text"; value: string }
  | { type: "address"; value: string }
  | { type: "ens"; value: string }
  | { type: "asset"; value: string; symbol: string; amount?: string; chain?: string };

function parseContent(text: string, thumbnailMap: Record<string, string>): Segment[] {
  // We do a single pass with a combined regex.
  // Priority order (most specific first):
  // 1. 0x addresses
  // 2. ENS names
  // 3. "179 USDC on Base" (amount + symbol + chain)
  // 4. "USDC on Base" (symbol + chain, no amount)
  // 5. "179 USDC" (amount + symbol)

  const combined = new RegExp(
    [
      `(${ADDRESS_RE.source})`, // group 1: address
      `(${ENS_RE.source})`, // group 3: ENS
      ASSET_CHAIN_RE.source, // groups 5,6,7: amount+symbol+chain
      SYMBOL_CHAIN_RE.source, // groups 8,9: symbol+chain
      `(${ASSET_AMOUNT_RE.source})`, // groups 10,11,12: amount+symbol
    ].join("|"),
    "gi",
  );

  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(combined)) {
    const full = match[0];
    const start = match.index!;

    // Push text before match
    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }

    const [, addr, , ens, , amtChain, symChain, chainChain, symOnly, chainOnly, , amt, sym] = match;

    if (addr) {
      segments.push({ type: "address", value: addr });
    } else if (ens) {
      segments.push({ type: "ens", value: ens });
    } else if (amtChain && symChain && chainChain) {
      // "179 USDC on Base"
      const symbol = symChain.toUpperCase();
      const chain = CHAIN_NORMALIZE[chainChain.toLowerCase()] || chainChain.toLowerCase();
      if (KNOWN_SYMBOLS.has(symbol) || thumbnailMap[symbol]) {
        segments.push({ type: "asset", value: full, symbol, amount: amtChain, chain });
      } else {
        segments.push({ type: "text", value: full });
      }
    } else if (symOnly && chainOnly) {
      // "USDC on Base"
      const symbol = symOnly.toUpperCase();
      const chain = CHAIN_NORMALIZE[chainOnly.toLowerCase()] || chainOnly.toLowerCase();
      if (KNOWN_SYMBOLS.has(symbol) || thumbnailMap[symbol]) {
        segments.push({ type: "asset", value: full, symbol, chain });
      } else {
        segments.push({ type: "text", value: full });
      }
    } else if (amt && sym) {
      // "179 USDC"
      const symbol = sym.toUpperCase();
      if (KNOWN_SYMBOLS.has(symbol) || thumbnailMap[symbol]) {
        segments.push({ type: "asset", value: full, symbol, amount: amt });
      } else {
        segments.push({ type: "text", value: full });
      }
    } else {
      segments.push({ type: "text", value: full });
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}
