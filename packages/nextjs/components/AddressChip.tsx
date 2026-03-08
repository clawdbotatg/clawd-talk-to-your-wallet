"use client";

import { useState } from "react";

interface AddressChipProps {
  address: string;
  ens?: string;
}

// Deterministic blockie — 5x5 grid, mirrored, from address bytes
function Blockie({ address }: { address: string }) {
  const hex = address.toLowerCase().replace("0x", "").padEnd(40, "0");

  // Use first 25 bytes for the 5x5 grid (mirrored left/right)
  const cells: boolean[] = [];
  for (let row = 0; row < 5; row++) {
    // Only need 3 cols (0,1,2) — mirror to get 3,4
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      const byte = parseInt(hex[idx * 2] || "0", 16);
      cells.push(byte > 7); // threshold at half
    }
  }

  // Color from address
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
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
