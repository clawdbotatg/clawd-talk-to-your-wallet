"use client";

import React from "react";
import AddressChip from "./AddressChip";
import AssetChip from "./AssetChip";
import NetworkChip from "./NetworkChip";

interface ChatMessageRendererProps {
  content: string;
  portfolio?: {
    tokenSymbol: string;
    thumbnail?: string;
    blockchain?: string;
    balanceUsd?: number | string;
    balance?: string;
  }[];
}

const ADDRESS_RE = /\b(0x[a-fA-F0-9]{40})\b/g;
const ENS_RE = /\b([a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+)*\.eth)\b/g;

const CHAIN_NAMES_LIST = [
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

const CHAIN_PAT = CHAIN_NAMES_LIST.join("|");

const ASSET_CHAIN_RE = new RegExp(
  `\\b(\\d+(?:[.,]\\d+)?(?:e-?\\d+)?)\\s+([A-Za-z]{2,10})\\s+on\\s+(${CHAIN_PAT})\\b`,
  "gi",
);
const SYMBOL_CHAIN_RE = new RegExp(`\\b([A-Za-z]{2,10})\\s+on\\s+(${CHAIN_PAT})\\b`, "gi");
const ASSET_AMOUNT_RE = /\b(\d+(?:[.,]\d+)?(?:e-?\d+)?)\s+([A-Za-z]{2,10})\b/g;
const ON_CHAIN_RE = new RegExp(`\\bon\\s+(${CHAIN_PAT})\\b`, "gi");
const BARE_CHAIN_RE = new RegExp(`\\b(${CHAIN_PAT})\\s+(?:chain|network|mainnet)\\b`, "gi");

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
    <p
      className="text-sm whitespace-pre-wrap leading-snug m-0 font-[family-name:var(--font-inter)]"
      style={{ color: "#E8E4DC" }}
    >
      {segments.map((seg, i) => {
        if (seg.type === "text") return <React.Fragment key={i}>{seg.value}</React.Fragment>;
        if (seg.type === "address") return <AddressChip key={i} address={seg.value} />;
        if (seg.type === "ens") return <AddressChip key={i} address={seg.value} ens={seg.value} />;
        if (seg.type === "network") return <NetworkChip key={i} chain={seg.chain!} />;
        if (seg.type === "asset") {
          return (
            <AssetChip
              key={i}
              symbol={seg.symbol!}
              amount={seg.amount}
              chain={seg.chain}
              thumbnail={thumbnailMap[seg.symbol!]}
            />
          );
        }
        return null;
      })}
    </p>
  );
}

type Segment =
  | { type: "text"; value: string }
  | { type: "address"; value: string }
  | { type: "ens"; value: string }
  | { type: "network"; value: string; chain: string }
  | { type: "asset"; value: string; symbol: string; amount?: string; chain?: string };

function parseContent(text: string, thumbnailMap: Record<string, string>): Segment[] {
  const combined = new RegExp(
    [
      `(${ADDRESS_RE.source})`,
      `(${ENS_RE.source})`,
      ASSET_CHAIN_RE.source,
      SYMBOL_CHAIN_RE.source,
      `(${ASSET_AMOUNT_RE.source})`,
      ON_CHAIN_RE.source,
      BARE_CHAIN_RE.source,
    ].join("|"),
    "gi",
  );

  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(combined)) {
    const full = match[0];
    const start = match.index!;

    if (start > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, start) });

    const [, addr, , ens, , amtChain, symChain, chainChain, symOnly, chainOnly, , amt, sym, onChain, bareChain] = match;

    if (addr) {
      segments.push({ type: "address", value: addr });
    } else if (ens) {
      segments.push({ type: "ens", value: ens });
    } else if (amtChain && symChain && chainChain) {
      const symbol = symChain.toUpperCase();
      const chain = CHAIN_NORMALIZE[chainChain.toLowerCase()] || chainChain.toLowerCase();
      if (KNOWN_SYMBOLS.has(symbol) || thumbnailMap[symbol]) {
        segments.push({ type: "asset", value: full, symbol, amount: amtChain, chain });
      } else {
        segments.push({ type: "text", value: `${amtChain} ${symChain} on ` });
        segments.push({ type: "network", value: chainChain, chain });
      }
    } else if (symOnly && chainOnly) {
      const symbol = symOnly.toUpperCase();
      const chain = CHAIN_NORMALIZE[chainOnly.toLowerCase()] || chainOnly.toLowerCase();
      if (KNOWN_SYMBOLS.has(symbol) || thumbnailMap[symbol]) {
        segments.push({ type: "asset", value: full, symbol, chain });
      } else {
        segments.push({ type: "text", value: `${symOnly} on ` });
        segments.push({ type: "network", value: chainOnly, chain });
      }
    } else if (amt && sym) {
      const symbol = sym.toUpperCase();
      if (KNOWN_SYMBOLS.has(symbol) || thumbnailMap[symbol]) {
        segments.push({ type: "asset", value: full, symbol, amount: amt });
      } else {
        segments.push({ type: "text", value: full });
      }
    } else if (onChain) {
      const chain = CHAIN_NORMALIZE[onChain.toLowerCase()] || onChain.toLowerCase();
      segments.push({ type: "text", value: "on " });
      segments.push({ type: "network", value: onChain, chain });
    } else if (bareChain) {
      const chain = CHAIN_NORMALIZE[bareChain.toLowerCase()] || bareChain.toLowerCase();
      segments.push({ type: "network", value: bareChain, chain });
      segments.push({ type: "text", value: full.slice(bareChain.length) });
    } else {
      segments.push({ type: "text", value: full });
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });

  return segments;
}
