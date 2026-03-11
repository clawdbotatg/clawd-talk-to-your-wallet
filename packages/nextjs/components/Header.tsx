"use client";

import React from "react";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

export const Header = () => {
  const { isConnected } = useAccount();

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
      <div>
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
