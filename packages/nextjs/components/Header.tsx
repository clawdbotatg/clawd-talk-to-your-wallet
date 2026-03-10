"use client";

import React from "react";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

export const Header = () => {
  return (
    <div
      className="sticky lg:static top-0 min-h-0 shrink-0 z-20 px-4 sm:px-6 flex items-center justify-between"
      style={{
        backgroundColor: "#0a0a0a",
        borderBottom: "1px solid rgba(201, 168, 76, 0.15)",
        height: "72px",
      }}
    >
      <div className="flex items-baseline gap-4">
        <span
          className="font-[family-name:var(--font-cinzel)] text-3xl font-bold tracking-[0.25em]"
          style={{ color: "#C9A84C" }}
        >
          DENARAI
        </span>
        <span
          className="font-[family-name:var(--font-cinzel)] text-sm tracking-[0.2em] hidden sm:inline"
          style={{ color: "#8A8578" }}
        >
          talk to your coins
        </span>
      </div>
      <div>
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
