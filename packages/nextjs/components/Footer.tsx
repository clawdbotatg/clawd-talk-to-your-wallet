"use client";

import { useEffect, useState } from "react";

interface TokenPrice {
  symbol: string;
  price: number | null;
  change24h: number | null;
}

function PriceTicker({ token }: { token: TokenPrice }) {
  const isUp = (token.change24h ?? 0) >= 0;
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-[family-name:var(--font-cinzel)] text-[10px] tracking-widest" style={{ color: "#8A8578" }}>
        {token.symbol}
      </span>
      <span className="font-[family-name:var(--font-jetbrains)] text-[10px]" style={{ color: "#E8E4DC" }}>
        {token.price != null
          ? token.price < 0.01
            ? `$${token.price.toFixed(6)}`
            : token.price < 1
              ? `$${token.price.toFixed(4)}`
              : `$${token.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
          : "—"}
      </span>
      {token.change24h != null && (
        <span
          className="text-[9px] font-[family-name:var(--font-jetbrains)]"
          style={{ color: isUp ? "#4CAF50" : "#ef4444" }}
        >
          {isUp ? "+" : ""}
          {token.change24h.toFixed(2)}%
        </span>
      )}
    </span>
  );
}

export const Footer = () => {
  const [prices, setPrices] = useState<TokenPrice[]>([]);

  useEffect(() => {
    const load = () =>
      fetch("/api/prices")
        .then(r => r.json())
        .then(setPrices)
        .catch(() => {});

    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-0 py-3 px-4 sm:px-6" style={{ borderTop: "1px solid rgba(201, 168, 76, 0.15)" }}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Left — all in one row */}
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            className="font-[family-name:var(--font-cinzel)] text-base font-bold tracking-[0.2em]"
            style={{ color: "#C9A84C" }}
          >
            DENAR.AI
          </span>
          <span
            className="font-[family-name:var(--font-cinzel)] text-[10px] tracking-widest italic"
            style={{ color: "rgba(138,133,120,0.6)" }}
          >
            /deh-NAR-eye/
          </span>
          <span className="text-[9px] tracking-widest uppercase" style={{ color: "rgba(138,133,120,0.5)" }}>
            powered by
          </span>
          {[
            { label: "LI.FI", url: "https://li.fi" },
            { label: "Zerion", url: "https://zerion.io" },
            { label: "Venice.ai", url: "https://venice.ai" },
          ].map(({ label, url }) => (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] tracking-widest uppercase transition-colors"
              style={{ color: "rgba(201,168,76,0.4)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#C9A84C")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(201,168,76,0.4)")}
            >
              {label}
            </a>
          ))}
        </div>

        {/* Right — live prices */}
        <div className="flex items-center gap-4 shrink-0">
          {prices.length === 0 ? (
            <span className="text-[10px]" style={{ color: "rgba(138,133,120,0.4)" }}>
              —
            </span>
          ) : (
            prices.map(t => <PriceTicker key={t.symbol} token={t} />)
          )}
        </div>
      </div>
    </div>
  );
};
