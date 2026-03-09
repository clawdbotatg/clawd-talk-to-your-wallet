"use client";

import React from "react";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

function getRomanYear(): string {
  // 2026 = MMXXVI
  return "MMXXVI";
}

function getDateline(): string {
  const now = new Date();
  const months = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  ];
  return `${now.getDate()} ${months[now.getMonth()]} ${getRomanYear()}`;
}

export const Header = () => {
  return (
    <div className="sticky lg:static top-0 z-20" style={{ backgroundColor: "#FFF8EE" }}>
      {/* Dateline */}
      <div className="text-center py-1" style={{ borderBottom: "1px solid #DDD5C8" }}>
        <span
          className="font-[family-name:var(--font-victor-mono)]"
          style={{ fontSize: "11px", letterSpacing: "0.15em", color: "#8B8680", textTransform: "uppercase" }}
        >
          DENARAI FINANCIAL GAZETTE — {getDateline()}
        </span>
      </div>
      {/* Masthead */}
      <div className="flex justify-between items-center px-4 sm:px-6 py-3" style={{ borderBottom: "3px solid #2C2C2C" }}>
        <div className="navbar-start">
          <span
            className="font-[family-name:var(--font-newsreader)] italic"
            style={{ fontSize: "1.75rem", letterSpacing: "0.08em", color: "#2C2C2C", fontWeight: 400 }}
          >
            Denarai
          </span>
        </div>
        <div className="navbar-end">
          <RainbowKitCustomConnectButton />
        </div>
      </div>
    </div>
  );
};
