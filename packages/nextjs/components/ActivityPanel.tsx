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
  send: { label: "SENT", color: "#FFFFFF" },
  receive: { label: "RECEIVED", color: "#00FF41" },
  trade: { label: "SWAPPED", color: "#FFFFFF" },
  bridge: { label: "BRIDGED", color: "#FFFFFF" },
  approve: { label: "APPROVED", color: "#FFFFFF" },
  deposit: { label: "DEPOSITED", color: "#FFFFFF" },
  withdraw: { label: "WITHDREW", color: "#FF4500" },
  mint: { label: "MINTED", color: "#00FF41" },
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "NOW";
  if (diffMin < 60) return `${diffMin}M AGO`;
  if (diffHr < 24) return `${diffHr}H AGO`;
  if (diffDay === 1) return "1D AGO";
  if (diffDay < 7) return `${diffDay}D AGO`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
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
        <span style={{ color: "#666666" }} className="text-xs">
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
    <div className="border-2" style={{ backgroundColor: "#0d0d0d", borderColor: "#FFFFFF" }}>
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4" style={{ borderBottom: "2px solid #FFFFFF" }}>
        <span
          className="font-[family-name:var(--font-space-grotesk)] text-xl uppercase font-bold tracking-wider"
          style={{ color: "#E8E8E8" }}
        >
          ACTIVITY LOG
        </span>
        <div className="flex-1 h-0.5" style={{ backgroundColor: "#666666" }} />
        {isLoading && items.length > 0 && <span className="loading loading-spinner loading-xs"></span>}
      </div>

      {/* Loading skeleton */}
      {isLoading && items.length === 0 && (
        <div className="p-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-24 h-3" style={{ backgroundColor: "#333333" }} />
              <div className="flex-1 h-3" style={{ backgroundColor: "#333333" }} />
              <div className="w-12 h-3" style={{ backgroundColor: "#333333" }} />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div
          className="text-center py-8 font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase"
          style={{ color: "#666666" }}
        >
          {error}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && items.length === 0 && (
        <div
          className="text-center py-8 font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase"
          style={{ color: "#666666" }}
        >
          NO ACTIVITY YET
        </div>
      )}

      {/* Items */}
      {items.length > 0 && (
        <div>
          {items.map((item, idx) => {
            const typeInfo = TYPE_LABELS[item.type] || { label: item.type.toUpperCase(), color: "#FFFFFF" };
            const isFailed = item.status === "failed";

            return (
              <div
                key={item.id}
                className={`flex items-center justify-between px-6 py-4 transition-colors duration-150 hover:bg-white/5 ${isFailed ? "opacity-50" : ""}`}
                style={{
                  borderBottom: idx < items.length - 1 ? "2px solid #FFFFFF" : "none",
                }}
              >
                <div className="flex items-center gap-6">
                  <span
                    className="font-[family-name:var(--font-ibm-plex-mono)] text-xs font-bold uppercase w-24"
                    style={{ color: typeInfo.color }}
                  >
                    {typeInfo.label}
                  </span>
                  <div>
                    {isFailed && (
                      <span
                        className="font-[family-name:var(--font-ibm-plex-mono)] text-[10px] uppercase font-bold mr-2"
                        style={{ color: "#FF4500" }}
                      >
                        FAILED
                      </span>
                    )}
                    <TransferChips item={item} />
                  </div>
                </div>

                <div className="text-right shrink-0 flex items-center gap-3">
                  <div>
                    {item.valueUsd != null && (
                      <div className="font-[family-name:var(--font-ibm-plex-mono)] text-xs font-bold uppercase">
                        {formatUsdValue(item.valueUsd)}
                      </div>
                    )}
                    <div
                      className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase"
                      style={{ color: "#666666" }}
                    >
                      {relativeTime(item.minedAt)}
                    </div>
                  </div>
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors"
                    style={{ color: "#666666" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#FF4500")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#666666")}
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
