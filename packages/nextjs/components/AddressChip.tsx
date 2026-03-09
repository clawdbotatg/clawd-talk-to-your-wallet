"use client";

import { useState } from "react";
import { blo } from "blo";
import { useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";

interface AddressChipProps {
  address: string; // 0x... address OR ENS name
  ens?: string; // pre-resolved ENS name (optional override)
}

const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

export default function AddressChip({ address, ens: ensProp }: AddressChipProps) {
  const [copied, setCopied] = useState(false);

  // If we got a raw address, try to resolve ENS
  const { data: resolvedEns } = useEnsName({
    address: isAddress(address) ? (address as `0x${string}`) : undefined,
    chainId: mainnet.id,
  });

  const displayName =
    ensProp || resolvedEns || (isAddress(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address);

  // Blockie: use blo for real addresses, fallback to first-char avatar for ENS names
  const blockieUrl = isAddress(address) ? blo(address as `0x${string}`) : null;

  const explorerUrl = isAddress(address)
    ? `https://etherscan.io/address/${address}`
    : `https://app.ens.domains/${address}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-full bg-base-300 border border-base-content/10 text-xs font-mono align-middle whitespace-nowrap">
      {blockieUrl ? (
        <img src={blockieUrl} alt={address} className="w-4 h-4 rounded-full flex-shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-full bg-primary/30 flex items-center justify-center text-[8px] font-bold text-primary flex-shrink-0">
          {address.slice(0, 1).toUpperCase()}
        </span>
      )}
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline text-base-content/80"
        title={address}
      >
        {displayName}
      </a>
      <button
        onClick={handleCopy}
        className="text-base-content/40 hover:text-base-content transition-colors ml-0.5"
        title={copied ? "Copied!" : "Copy"}
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
