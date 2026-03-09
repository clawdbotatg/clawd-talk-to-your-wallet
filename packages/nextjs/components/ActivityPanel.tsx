"use client";

import { useEffect, useState } from "react";
import AssetChip from "./AssetChip";

interface ActivityItem {
  id: string;
  hash: string;
  chain: string;
  type: string;
  status: string;
  minedAt: string;
  valueUsd: number | null;
  out: { symbol: string; amount: string; icon: string } | null;
  in: { symbol: string; amount: string; icon: string } | null;
  explorerUrl: string;
}

const CHAIN_ICONS: Record<string, string> = {
  ethereum: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
  base: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
  arbitrum: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
  optimism: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg",
  polygon: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg",
  bsc: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg",
  avalanche: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg",
  gnosis: "https://icons.llamao.fi/icons/chains/rsz_xdai.jpg",
  xdai: "https://icons.llamao.fi/icons/chains/rsz_xdai.jpg",
  linea: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg",
  scroll: "https://icons.llamao.fi/icons/chains/rsz_scroll.jpg",
  zksync: "https://icons.llamao.fi/icons/chains/rsz_zksync%20era.jpg",
  fantom: "https://icons.llamao.fi/icons/chains/rsz_fantom.jpg",
  monad: "https://icons.llamao.fi/icons/chains/rsz_monad.jpg",
  abstract: "https://icons.llamao.fi/icons/chains/rsz_abstract.jpg",
  celo: "https://icons.llamao.fi/icons/chains/rsz_celo.jpg",
};

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  send: { label: "Send", className: "badge-ghost" },
  receive: { label: "Receive", className: "badge-success" },
  trade: { label: "Swap", className: "badge-info" },
  bridge: { label: "Bridge", className: "badge-primary" },
  approve: { label: "Approve", className: "badge-warning" },
  deposit: { label: "Deposit", className: "badge-accent" },
  withdraw: { label: "Withdraw", className: "badge-secondary" },
  mint: { label: "Mint", className: "badge-error" },
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatUsdValue(value: number | null): string {
  if (value == null) return "";
  if (value < 0.01) return "<$0.01";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function TransferChips({ item }: { item: ActivityItem }) {
  const { type, out: outT, in: inT, chain } = item;
  const isSwapOrBridge = type === "trade" || type === "bridge";

  if (isSwapOrBridge && outT && inT) {
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <AssetChip symbol={outT.symbol} amount={outT.amount} thumbnail={outT.icon} chain={chain} />
        <span className="text-base-content/40 text-xs">→</span>
        <AssetChip symbol={inT.symbol} amount={inT.amount} thumbnail={inT.icon} chain={chain} />
      </span>
    );
  }
  if (outT) return <AssetChip symbol={outT.symbol} amount={outT.amount} thumbnail={outT.icon} chain={chain} />;
  if (inT) return <AssetChip symbol={inT.symbol} amount={inT.amount} thumbnail={inT.icon} chain={chain} />;
  return null;
}

interface ActivityPanelProps {
  address: string;
  initialItems?: ActivityItem[];
}

export default function ActivityPanel({ address, initialItems }: ActivityPanelProps) {
  const [items, setItems] = useState<ActivityItem[]>(initialItems || []);
  const [isLoading, setIsLoading] = useState(!initialItems);
  const [error, setError] = useState("");

  useEffect(() => {
    // If items were passed as props, use them (no self-fetch to avoid rate limits)
    if (initialItems !== undefined) {
      setItems(initialItems);
      setIsLoading(false);
      return;
    }

    if (!address) return;

    let cancelled = false;

    const fetchActivity = async () => {
      setIsLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/activity?address=${address}`);
        const data = await res.json();
        if (!cancelled) {
          if (data.error) {
            setError(data.error);
          } else {
            setItems(data.items || []);
          }
        }
      } catch {
        if (!cancelled) setError("Could not load activity");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchActivity();

    const interval = setInterval(fetchActivity, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, initialItems]);

  return (
    <div className="bg-base-200 rounded-xl p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-semibold text-base-content/60">Activity</span>
        {isLoading && items.length > 0 && <span className="loading loading-spinner loading-xs"></span>}
      </div>

      {/* Loading skeleton */}
      {isLoading && items.length === 0 && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-base-300 shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="h-3 bg-base-300 rounded w-3/4" />
                <div className="h-2 bg-base-300 rounded w-1/2" />
              </div>
              <div className="h-3 bg-base-300 rounded w-12" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && <div className="text-center py-8 text-base-content/50 text-sm">{error}</div>}

      {/* Empty */}
      {!isLoading && !error && items.length === 0 && (
        <div className="text-center py-8 text-base-content/50 text-sm">No activity yet</div>
      )}

      {/* Items */}
      {items.length > 0 && (
        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          {items.map(item => {
            const badge = TYPE_BADGES[item.type] || { label: item.type, className: "badge-ghost" };
            const tokenIcon = item.out?.icon || item.in?.icon || "";
            const chainIcon = CHAIN_ICONS[item.chain] || "";
            const isFailed = item.status === "failed";

            return (
              <div
                key={item.id}
                className={`flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-base-300/50 transition-colors ${isFailed ? "opacity-50" : ""}`}
              >
                {/* Token icon with chain badge */}
                <div className="relative w-8 h-8 shrink-0">
                  {tokenIcon ? (
                    <img
                      src={tokenIcon}
                      alt=""
                      className="w-8 h-8 rounded-full"
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-base-300 flex items-center justify-center text-xs">⟠</div>
                  )}
                  {chainIcon && (
                    <img
                      src={chainIcon}
                      alt={item.chain}
                      className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-base-200"
                    />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`badge badge-xs ${badge.className}`}>{badge.label}</span>
                    {isFailed && <span className="badge badge-xs badge-error">Failed</span>}
                  </div>
                  <div className="mt-0.5">
                    <TransferChips item={item} />
                  </div>
                </div>

                {/* Right side: value + time + link */}
                <div className="text-right shrink-0 flex items-center gap-1.5">
                  <div>
                    {item.valueUsd != null && (
                      <div className="text-xs font-medium">{formatUsdValue(item.valueUsd)}</div>
                    )}
                    <div className="text-[10px] text-base-content/50">{relativeTime(item.minedAt)}</div>
                  </div>
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base-content/40 hover:text-primary transition-colors"
                    title="View on explorer"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-3.5 h-3.5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                      <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                    </svg>
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
