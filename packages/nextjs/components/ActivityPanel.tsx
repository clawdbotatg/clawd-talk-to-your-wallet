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

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  send: { label: "Sent", color: "#8A8578" },
  receive: { label: "Received", color: "#C9A84C" },
  trade: { label: "Swapped", color: "#8A8578" },
  bridge: { label: "Bridged", color: "#8A8578" },
  approve: { label: "Approved", color: "#8A8578" },
  deposit: { label: "Deposited", color: "#8A8578" },
  withdraw: { label: "Withdrew", color: "#9B3D3D" },
  mint: { label: "Minted", color: "#C9A84C" },
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
        <span style={{ color: "#8A8578" }} className="text-xs">
          →
        </span>
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
    <div className="p-4" style={{ backgroundColor: "#111111", border: "1px solid rgba(201, 168, 76, 0.15)" }}>
      <div className="flex justify-between items-center mb-4">
        <span
          className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.15em] uppercase"
          style={{ color: "#C9A84C" }}
        >
          Activity
        </span>
        {isLoading && items.length > 0 && (
          <span className="loading loading-spinner loading-xs" style={{ color: "#C9A84C" }}></span>
        )}
      </div>

      {/* Loading skeleton */}
      {isLoading && items.length === 0 && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-8 h-8 shrink-0" style={{ backgroundColor: "#1a1a1a" }} />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-3/4" style={{ backgroundColor: "#1a1a1a" }} />
                <div className="h-2 w-1/2" style={{ backgroundColor: "#1a1a1a" }} />
              </div>
              <div className="h-3 w-12" style={{ backgroundColor: "#1a1a1a" }} />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="text-center py-8 text-sm" style={{ color: "#8A8578" }}>
          {error}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && items.length === 0 && (
        <div className="text-center py-8 text-sm" style={{ color: "#8A8578" }}>
          No activity yet
        </div>
      )}

      {/* Items */}
      {items.length > 0 && (
        <div className="space-y-0">
          {items.map(item => {
            const typeInfo = TYPE_LABELS[item.type] || { label: item.type, color: "#8A8578" };
            const isFailed = item.status === "failed";

            return (
              <div
                key={item.id}
                className={`flex items-center gap-2 py-3 px-2 -mx-2 transition-colors duration-300 hover:bg-white/[0.02] ${isFailed ? "opacity-50" : ""}`}
                style={{
                  borderBottom: "1px solid rgba(201, 168, 76, 0.06)",
                }}
              >
                {/* Action label */}
                <span
                  className="font-[family-name:var(--font-cinzel)] text-xs w-20 shrink-0"
                  style={{ color: typeInfo.color }}
                >
                  {typeInfo.label}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {isFailed && (
                    <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: "#9B3D3D" }}>
                      Failed
                    </span>
                  )}
                  <TransferChips item={item} />
                </div>

                {/* Right side: value + time + link */}
                <div className="text-right shrink-0 flex items-center gap-1.5">
                  <div>
                    {item.valueUsd != null && (
                      <div className="font-[family-name:var(--font-jetbrains)] text-xs" style={{ color: "#E8E4DC" }}>
                        {formatUsdValue(item.valueUsd)}
                      </div>
                    )}
                    <div className="text-[10px]" style={{ color: "#8A8578" }}>
                      {relativeTime(item.minedAt)}
                    </div>
                  </div>
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors"
                    style={{ color: "#8A8578" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#C9A84C")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#8A8578")}
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
