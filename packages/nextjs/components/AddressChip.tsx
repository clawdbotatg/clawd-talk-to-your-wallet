"use client";

import { useState } from "react";

interface AddressChipProps {
  address: string;
  ens?: string;
}

export default function AddressChip({ address, ens }: AddressChipProps) {
  const [copied, setCopied] = useState(false);

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const display = ens || short;
  const explorerUrl = `https://etherscan.io/address/${address}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="inline-flex items-center gap-1 mx-0.5 px-2 py-0.5 rounded-full bg-base-300 border border-base-content/10 text-xs font-mono align-middle whitespace-nowrap">
      {/* Blockies-style colored dot */}
      <span
        className="inline-block w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: addressToColor(address) }}
      />
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
        className="text-base-content/40 hover:text-base-content transition-colors"
        title="Copy address"
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

// Deterministic color from address — consistent across renders
function addressToColor(address: string): string {
  const hex = address.toLowerCase().replace("0x", "");
  const r = parseInt(hex.slice(0, 2), 16);
  // Use just r for hue, g for saturation tweak
  const g = parseInt(hex.slice(2, 4), 16);
  const hue = Math.round((r / 255) * 360);
  const sat = 50 + Math.round((g / 255) * 20);
  return `hsl(${hue}, ${sat}%, 55%)`;
}
