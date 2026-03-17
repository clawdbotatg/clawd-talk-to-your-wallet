"use client";

import React, { useEffect } from "react";
import { useAccount } from "wagmi";
import AddressChip from "~~/components/AddressChip";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useCvAuth } from "~~/hooks/useCvAuth";

const formatCv = (balance: number): string => {
  if (balance >= 1_000_000_000) return `${(balance / 1_000_000_000).toFixed(1)}B`;
  if (balance >= 1_000_000) return `${(balance / 1_000_000).toFixed(1)}M`;
  if (balance >= 1_000) return `${(balance / 1_000).toFixed(1)}K`;
  return balance.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

export const Header = () => {
  const { address, isConnected } = useAccount();
  const { cvBalance, cvWallet, hasCvSig, fetchCvBalance } = useCvAuth();

  const cvWalletDiffers = isConnected && cvWallet && address && cvWallet.toLowerCase() !== address.toLowerCase();

  // Fetch live balance from the CV wallet address (not necessarily the operating wallet)
  useEffect(() => {
    const walletToFetch = cvWallet || address;
    if (!walletToFetch || !isConnected) return;
    fetchCvBalance(walletToFetch);
    const interval = setInterval(() => fetchCvBalance(walletToFetch), 30_000);
    return () => clearInterval(interval);
  }, [cvWallet, address, isConnected, fetchCvBalance]);

  return (
    <div
      className="sticky lg:static top-0 min-h-0 shrink-0 z-20 px-4 sm:px-6 flex items-center justify-between"
      style={{
        backgroundColor: isConnected ? "#0a0a0a" : "transparent",
        borderBottom: isConnected ? "1px solid rgba(201, 168, 76, 0.15)" : "none",
        height: "72px",
      }}
    >
      {isConnected ? (
        <div className="flex items-baseline gap-4">
          <span
            className="font-[family-name:var(--font-cinzel)] text-3xl font-bold tracking-[0.25em]"
            style={{ color: "#C9A84C" }}
          >
            DENARAI
          </span>
          <span
            className="font-[family-name:var(--font-cinzel)] text-2xl tracking-[0.2em] hidden sm:inline"
            style={{ color: "#8A8578" }}
          >
            talk to your coins
          </span>
        </div>
      ) : (
        <div />
      )}

      <div className="flex items-center gap-3">
        {isConnected && (hasCvSig || cvBalance !== null) && (
          <div
            className="flex items-center gap-2 px-3 py-1 rounded-sm"
            style={{
              border: "1px solid rgba(201, 168, 76, 0.3)",
              backgroundColor: "rgba(201, 168, 76, 0.05)",
            }}
            title="Your CV balance (ClawdViction — stake CLAWD at larv.ai to earn more)"
          >
            {/* If CV wallet differs from connected wallet, show which address owns this CV */}
            {cvWalletDiffers && cvWallet && (
              <div className="flex items-center gap-1 text-xs" style={{ color: "#8A8578" }}>
                <span>CV from</span>
                <AddressChip address={cvWallet} />
              </div>
            )}
            <span className="font-[family-name:var(--font-jetbrains)] text-sm font-medium" style={{ color: "#C9A84C" }}>
              {cvBalance !== null ? `${formatCv(cvBalance)} CV` : "— CV"}
            </span>
          </div>
        )}
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
