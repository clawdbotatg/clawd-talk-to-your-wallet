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
        <div className="flex items-center gap-3 flex-wrap">
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
            { label: "Alchemy", url: "https://alchemy.com" },
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

          {/* GitHub link */}
          <a
            href="https://github.com/clawdbotatg/clawd-talk-to-your-wallet"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[9px] tracking-widest uppercase transition-colors"
            style={{ color: "rgba(201,168,76,0.4)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#C9A84C")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(201,168,76,0.4)")}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .322.216.694.825.576C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
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
