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
        height: "56px",
      }}
    >
      <div>
        <span
          className="font-[family-name:var(--font-cinzel)] text-sm font-semibold tracking-[0.25em]"
          style={{ color: "#C9A84C" }}
        >
          DENARAI
        </span>
      </div>
      <div>
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
