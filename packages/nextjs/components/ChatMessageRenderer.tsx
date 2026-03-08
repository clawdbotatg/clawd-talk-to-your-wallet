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

// Matches "15 GNO", "0.5 ETH", "100 USDC", "$5.00 worth of DAI" etc.
// Token symbol: 2–10 uppercase letters
const ASSET_AMOUNT_RE = /\b(\d+(?:[.,]\d+)?(?:e-?\d+)?)\s+([A-Z]{2,10})\b/g;

// Token symbol alone (no amount) — only match known tokens to avoid false positives
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

  // Parse the content into segments
  const segments = parseContent(content, thumbnailMap);

  return (
    <p className="text-sm whitespace-pre-wrap leading-relaxed">
      {segments.map((seg, i) => {
        if (seg.type === "text") return <React.Fragment key={i}>{seg.value}</React.Fragment>;
        if (seg.type === "address") return <AddressChip key={i} address={seg.value} />;
        if (seg.type === "ens") return <AddressChip key={i} address={seg.value} ens={seg.value} />;
        if (seg.type === "asset")
          return <AssetChip key={i} symbol={seg.symbol!} amount={seg.amount} thumbnail={thumbnailMap[seg.symbol!]} />;
        return null;
      })}
    </p>
  );
}

type Segment =
  | { type: "text"; value: string }
  | { type: "address"; value: string }
  | { type: "ens"; value: string }
  | { type: "asset"; value: string; symbol: string; amount?: string };

function parseContent(text: string, thumbnailMap: Record<string, string>): Segment[] {
  // Build combined regex with named groups
  // Order matters: address first (more specific), then asset+amount, then ENS
  const combined = new RegExp(`(${ADDRESS_RE.source})|(${ENS_RE.source})|(${ASSET_AMOUNT_RE.source})`, "g");

  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(combined)) {
    const [full, addr, , ens, , amount, symbol] = match;
    const start = match.index!;

    // Push text before this match
    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }

    if (addr) {
      segments.push({ type: "address", value: addr });
    } else if (ens) {
      segments.push({ type: "ens", value: ens });
    } else if (amount && symbol) {
      // Only chip-ify if it's a known token OR the user has it in portfolio
      if (KNOWN_SYMBOLS.has(symbol) || thumbnailMap[symbol]) {
        segments.push({ type: "asset", value: full, symbol, amount });
      } else {
        segments.push({ type: "text", value: full });
      }
    } else {
      segments.push({ type: "text", value: full });
    }

    lastIndex = start + full.length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}
