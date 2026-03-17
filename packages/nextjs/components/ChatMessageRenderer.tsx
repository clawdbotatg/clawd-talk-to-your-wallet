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

// Matches numbers like 40,000,000 or 1.5 or 1,234.56 — handles multi-group comma separators
const NUM_PAT = `\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\.\\d+|\\d+(?:\\.\\d+)?`;

const ASSET_CHAIN_RE = new RegExp(`\\b(${NUM_PAT})\\s+([A-Za-z]{2,10})\\s+on\\s+(${CHAIN_PAT})\\b`, "gi");
const SYMBOL_CHAIN_RE = new RegExp(`\\b([A-Za-z]{2,10})\\s+on\\s+(${CHAIN_PAT})\\b`, "gi");
const ASSET_AMOUNT_RE = new RegExp(`\\b(${NUM_PAT})\\s+([A-Za-z]{2,10})\\b`, "g");
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

// ─── Inline segment renderer ─────────────────────────────────────────────────

function renderSegments(segments: Segment[], thumbnailMap: Record<string, string>) {
  return segments.map((seg, i) => {
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
  });
}

// ─── Inline markdown parser (bold, inline code) ───────────────────────────────

function parseInline(text: string, thumbnailMap: Record<string, string>): React.ReactNode {
  // Split on **bold** and `code` markers, then parse chips in remaining text
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      return (
        <strong key={i} className="font-semibold" style={{ color: "#E8E4DC" }}>
          {renderSegments(parseContent(inner, thumbnailMap), thumbnailMap)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="font-[family-name:var(--font-jetbrains)] text-xs px-1 rounded"
          style={{ backgroundColor: "rgba(201,168,76,0.1)", color: "#C9A84C" }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{renderSegments(parseContent(part, thumbnailMap), thumbnailMap)}</React.Fragment>;
  });
}

// ─── Block-level markdown renderer ───────────────────────────────────────────

function renderBlocks(content: string, thumbnailMap: Record<string, string>): React.ReactNode {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Numbered list item: "1. " or "1) "
    if (/^\d+[.)]\s/.test(line)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) {
        const text = lines[i].replace(/^\d+[.)]\s/, "");
        listItems.push(
          <li key={i} className="ml-4 mb-1">
            {parseInline(text, thumbnailMap)}
          </li>,
        );
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal list-outside my-2 space-y-0.5">
          {listItems}
        </ol>,
      );
      continue;
    }

    // Bullet list item: "- " or "* "
    if (/^[-*]\s/.test(line)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        const text = lines[i].replace(/^[-*]\s/, "");
        listItems.push(
          <li key={i} className="ml-4 mb-1">
            {parseInline(text, thumbnailMap)}
          </li>,
        );
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc list-outside my-2 space-y-0.5">
          {listItems}
        </ul>,
      );
      continue;
    }

    // Blank line — skip
    if (line.trim() === "") {
      blocks.push(<div key={`br-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Regular paragraph line
    blocks.push(
      <span key={`p-${i}`} className="block leading-relaxed">
        {parseInline(line, thumbnailMap)}
      </span>,
    );
    i++;
  }

  return blocks;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChatMessageRenderer({ content, portfolio }: ChatMessageRendererProps) {
  const thumbnailMap: Record<string, string> = {};
  if (portfolio) {
    for (const asset of portfolio) {
      if (asset.thumbnail && !thumbnailMap[asset.tokenSymbol]) {
        thumbnailMap[asset.tokenSymbol] = asset.thumbnail;
      }
    }
  }

  return (
    <div className="text-sm leading-snug m-0 font-[family-name:var(--font-inter)]" style={{ color: "#E8E4DC" }}>
      {renderBlocks(content, thumbnailMap)}
    </div>
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
