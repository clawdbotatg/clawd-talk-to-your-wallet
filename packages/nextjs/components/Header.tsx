"use client";

import React, { useEffect } from "react";
import { useAccount } from "wagmi";
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
  const { cvBalance, hasCvSig, fetchCvBalance } = useCvAuth();

  // Fetch live balance directly — don't depend on page.tsx's hook instance
  useEffect(() => {
    if (!address || !isConnected) return;
    fetchCvBalance(address);
    // Refresh every 30s
    const interval = setInterval(() => fetchCvBalance(address), 30_000);
    return () => clearInterval(interval);
  }, [address, isConnected, fetchCvBalance]);

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
        <div className="flex items-center gap-3">
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
        </div>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-3">
        {isConnected && (hasCvSig || cvBalance !== null) && (
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-sm"
            style={{
              border: "1px solid rgba(201, 168, 76, 0.3)",
              backgroundColor: "rgba(201, 168, 76, 0.05)",
            }}
            title="Your CV balance (ClawdViction — stake CLAWD at larv.ai to earn more)"
          >
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
