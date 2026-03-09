"use client";

import React from "react";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

export const Header = () => {
  return (
    <div
      className="sticky lg:static top-0 min-h-0 shrink-0 z-20 px-4 sm:px-6 flex items-center justify-between"
      style={{
        backgroundColor: "#1a1a1a",
        borderBottom: "2px solid #FFFFFF",
        height: "56px",
      }}
    >
      <div>
        <span
          className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold uppercase tracking-tight"
          style={{ color: "#FFFFFF" }}
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
