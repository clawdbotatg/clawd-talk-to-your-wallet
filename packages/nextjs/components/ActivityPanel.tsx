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

const TYPE_LABELS: Record<string, string> = {
  send: "Sent",
  receive: "Received",
  trade: "Swapped",
  bridge: "Bridged",
  approve: "Approved",
  deposit: "Deposited",
  withdraw: "Withdrew",
  mint: "Minted",
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

function TransferDescription({ item }: { item: ActivityItem }) {
  const { type, out: outT, in: inT, chain } = item;
  const isSwapOrBridge = type === "trade" || type === "bridge";

  if (isSwapOrBridge && outT && inT) {
    return (
      <span className="inline-flex items-center gap-1 flex-wrap" style={{ fontSize: "13px" }}>
        <AssetChip symbol={outT.symbol} amount={outT.amount} thumbnail={outT.icon} chain={chain} />
        <span style={{ color: "#8B8680", fontSize: "11px" }}>→</span>
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
    <div>
      {/* Section header */}
      <div className="mb-4 pb-2" style={{ borderBottom: "2px solid #2C2C2C" }}>
        <div className="flex justify-between items-center">
          <p
            className="font-semibold m-0"
            style={{ color: "#2C2C2C", fontVariant: "small-caps", letterSpacing: "0.15em", fontSize: "13px" }}
          >
            ACTIVITY
          </p>
          {isLoading && items.length > 0 && <span className="loading loading-spinner loading-xs"></span>}
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && items.length === 0 && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="py-3" style={{ borderBottom: "1px solid #DDD5C8", opacity: 0.4 }}>
              <div className="h-3 w-3/4 mb-1" style={{ backgroundColor: "#DDD5C8" }} />
              <div className="h-2 w-1/2" style={{ backgroundColor: "#DDD5C8" }} />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="text-center py-8" style={{ color: "#8B8680", fontSize: "13px" }}>{error}</div>
      )}

      {/* Empty */}
      {!isLoading && !error && items.length === 0 && (
        <div className="text-center py-8" style={{ color: "#8B8680", fontSize: "13px" }}>No activity yet</div>
      )}

      {/* Activity items — gazette style */}
      {items.length > 0 && (
        <div>
          {items.map(item => {
            const label = TYPE_LABELS[item.type] || item.type;
            const isFailed = item.status === "failed";
            const isReceive = item.type === "receive";

            return (
              <div
                key={item.id}
                className={`flex items-start justify-between py-3 ${isFailed ? "opacity-50" : ""}`}
                style={{ borderBottom: "1px solid #DDD5C8" }}
              >
                <div>
                  <span
                    className="font-[family-name:var(--font-newsreader)] italic mr-2"
                    style={{
                      fontSize: "14px",
                      color: isReceive ? "#C41E3A" : "#2C2C2C",
                    }}
                  >
                    {label}
                  </span>
                  {isFailed && (
                    <span
                      className="font-[family-name:var(--font-victor-mono)]"
                      style={{ fontSize: "10px", color: "#C41E3A" }}
                    >
                      FAILED
                    </span>
                  )}
                  <div className="mt-0.5">
                    <TransferDescription item={item} />
                  </div>
                </div>
                <div className="text-right shrink-0 flex items-center gap-1.5">
                  <div>
                    {item.valueUsd != null && (
                      <div
                        className="font-[family-name:var(--font-victor-mono)]"
                        style={{ fontSize: "12px", fontWeight: 600 }}
                      >
                        {formatUsdValue(item.valueUsd)}
                      </div>
                    )}
                    <div
                      className="font-[family-name:var(--font-victor-mono)]"
                      style={{ fontSize: "10px", color: "#8B8680" }}
                    >
                      {relativeTime(item.minedAt)}
                    </div>
                  </div>
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#8B8680" }}
                    title="View on explorer"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-3 h-3"
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
