"use client";

import { useState } from "react";

interface AddressChipProps {
  address: string;
  ens?: string;
}

// Convert any string to a stable sequence of bytes for blockie generation
function toBytes(input: string): number[] {
  const isHex = /^0x[a-fA-F0-9]{40}$/.test(input);
  if (isHex) {
    const hex = input.toLowerCase().replace("0x", "");
    return Array.from({ length: 20 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
  // ENS name or other string — use char codes
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) bytes.push(input.charCodeAt(i) & 0xff);
  // Pad/repeat to at least 20 bytes
  while (bytes.length < 20) bytes.push(...bytes);
  return bytes;
}

// Deterministic blockie — 5x5 grid, mirrored, works for addresses AND ENS names
function Blockie({ address }: { address: string }) {
  const bytes = toBytes(address);

  // Use first 15 bytes for the 5x5 grid (3 cols × 5 rows, mirrored)
  const cells: boolean[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const byte = bytes[row * 3 + col] ?? 0;
      cells.push(byte > 127);
    }
  }

  // Color from first two bytes
  const r = bytes[0] ?? 0;
  const g = bytes[1] ?? 0;
  const hue = Math.round((r / 255) * 360);
  const sat = 50 + Math.round((g / 255) * 20);
  const color = `hsl(${hue}, ${sat}%, 52%)`;
  const bg = `hsl(${hue}, ${sat}%, 92%)`;

  return (
    <span
      className="inline-grid flex-shrink-0 rounded-sm overflow-hidden"
      style={{ display: "inline-grid", gridTemplateColumns: "repeat(5, 1fr)", width: 16, height: 16, background: bg }}
    >
      {Array.from({ length: 5 }).map((_, row) =>
        Array.from({ length: 5 }).map((_, col) => {
          const mirrorCol = col < 3 ? col : 4 - col;
          const on = cells[row * 3 + mirrorCol];
          return <span key={`${row}-${col}`} style={{ display: "block", background: on ? color : "transparent" }} />;
        }),
      )}
    </span>
  );
}

export default function AddressChip({ address, ens }: AddressChipProps) {
  const [copied, setCopied] = useState(false);

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const display = ens || short;

  // Pick explorer based on address (default etherscan — user can navigate from there)
  const explorerUrl = `https://etherscan.io/address/${address}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-full bg-base-300 border border-base-content/10 text-xs font-mono align-middle whitespace-nowrap">
      <Blockie address={address} />
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline text-base-content/80"
        title={address}
      >
        {display}
      </a>
      <button
        onClick={handleCopy}
        className="text-base-content/40 hover:text-base-content transition-colors ml-0.5"
        title={copied ? "Copied!" : "Copy address"}
      >
        {copied ? (
          <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        )}
      </button>
    </span>
  );
}
