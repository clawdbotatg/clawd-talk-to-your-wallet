"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModalItem =
  | { type: "address"; address: string; ens?: string }
  | { type: "asset"; symbol: string; amount?: string; chain?: string; thumbnail?: string; contractAddress?: string }
  | { type: "network"; chain: string }
  | { type: "transaction"; hash: string; chain: string }
  | { type: "portfolio_position"; symbol: string; chain: string; balanceUsd: string; protocol?: string }
  | { type: "activity_item"; id: string; hash: string; chain: string; txType: string; valueUsd?: number };

interface DetailModalContextValue {
  openModal: (item: ModalItem) => void;
  closeModal: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const DetailModalContext = createContext<DetailModalContextValue | null>(null);

export function useDetailModal(): DetailModalContextValue {
  const ctx = useContext(DetailModalContext);
  if (!ctx) throw new Error("useDetailModal must be used within <DetailModalProvider>");
  return ctx;
}

// ─── Modal Header ────────────────────────────────────────────────────────────

function ModalHeader({ label, identifier }: { label: string; identifier: string }) {
  return (
    <div
      className="px-5 py-4 flex items-center justify-between"
      style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.15)" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.15em] uppercase shrink-0"
          style={{ color: "#C9A84C" }}
        >
          {label}
        </span>
        <span className="font-[family-name:var(--font-jetbrains)] text-xs truncate" style={{ color: "#E8E4DC" }}>
          {identifier}
        </span>
      </div>
    </div>
  );
}

// ─── Placeholder Row ─────────────────────────────────────────────────────────

function PlaceholderRow({ label, value }: { label: string; value?: string }) {
  return (
    <div
      className="flex items-center justify-between py-2"
      style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}
    >
      <span className="text-xs" style={{ color: "#8A8578" }}>
        {label}
      </span>
      <span className="font-[family-name:var(--font-jetbrains)] text-xs" style={{ color: "#E8E4DC" }}>
        {value || "Loading..."}
      </span>
    </div>
  );
}

// ─── Per-Type Content ────────────────────────────────────────────────────────

function AddressContent({ item }: { item: Extract<ModalItem, { type: "address" }> }) {
  const truncated = `${item.address.slice(0, 6)}…${item.address.slice(-4)}`;
  return (
    <>
      <ModalHeader label="Address" identifier={item.ens || truncated} />
      <div className="px-5 py-4 space-y-0">
        <PlaceholderRow label="Full Address" value={truncated} />
        {item.ens && <PlaceholderRow label="ENS" value={item.ens} />}
        <PlaceholderRow label="ETH Balance" />
        <PlaceholderRow label="Token Count" />
        <PlaceholderRow label="First Seen" />
      </div>
    </>
  );
}

function AssetContent({ item }: { item: Extract<ModalItem, { type: "asset" }> }) {
  return (
    <>
      <ModalHeader label="Asset" identifier={item.symbol} />
      <div className="px-5 py-4 space-y-0">
        {item.amount && <PlaceholderRow label="Amount" value={`${item.amount} ${item.symbol}`} />}
        {item.chain && <PlaceholderRow label="Chain" value={item.chain} />}
        {item.contractAddress && (
          <PlaceholderRow
            label="Contract"
            value={`${item.contractAddress.slice(0, 6)}…${item.contractAddress.slice(-4)}`}
          />
        )}
        <PlaceholderRow label="Price" />
        <PlaceholderRow label="Market Cap" />
        <PlaceholderRow label="24h Volume" />
      </div>
    </>
  );
}

function NetworkContent({ item }: { item: Extract<ModalItem, { type: "network" }> }) {
  return (
    <>
      <ModalHeader label="Network" identifier={item.chain} />
      <div className="px-5 py-4 space-y-0">
        <PlaceholderRow label="Chain" value={item.chain} />
        <PlaceholderRow label="Gas Price" />
        <PlaceholderRow label="Block Height" />
        <PlaceholderRow label="TPS" />
      </div>
    </>
  );
}

function TransactionContent({ item }: { item: Extract<ModalItem, { type: "transaction" }> }) {
  const truncatedHash = `${item.hash.slice(0, 10)}…${item.hash.slice(-6)}`;
  return (
    <>
      <ModalHeader label="Transaction" identifier={truncatedHash} />
      <div className="px-5 py-4 space-y-0">
        <PlaceholderRow label="Hash" value={truncatedHash} />
        <PlaceholderRow label="Chain" value={item.chain} />
        <PlaceholderRow label="Status" />
        <PlaceholderRow label="Gas Used" />
        <PlaceholderRow label="Block" />
      </div>
    </>
  );
}

function PortfolioPositionContent({ item }: { item: Extract<ModalItem, { type: "portfolio_position" }> }) {
  return (
    <>
      <ModalHeader label="Position" identifier={item.symbol} />
      <div className="px-5 py-4 space-y-0">
        <PlaceholderRow label="Symbol" value={item.symbol} />
        <PlaceholderRow label="Chain" value={item.chain} />
        <PlaceholderRow label="Balance" value={item.balanceUsd} />
        {item.protocol && <PlaceholderRow label="Protocol" value={item.protocol} />}
        <PlaceholderRow label="24h Change" />
        <PlaceholderRow label="% of Portfolio" />
      </div>
    </>
  );
}

function ActivityItemContent({ item }: { item: Extract<ModalItem, { type: "activity_item" }> }) {
  const truncatedHash = `${item.hash.slice(0, 10)}…${item.hash.slice(-6)}`;
  return (
    <>
      <ModalHeader label={item.txType} identifier={truncatedHash} />
      <div className="px-5 py-4 space-y-0">
        <PlaceholderRow label="Hash" value={truncatedHash} />
        <PlaceholderRow label="Chain" value={item.chain} />
        <PlaceholderRow label="Type" value={item.txType} />
        {item.valueUsd != null && <PlaceholderRow label="Value" value={`$${item.valueUsd.toFixed(2)}`} />}
        <PlaceholderRow label="Gas Cost" />
        <PlaceholderRow label="Timestamp" />
      </div>
    </>
  );
}

function ModalContent({ item }: { item: ModalItem }) {
  switch (item.type) {
    case "address":
      return <AddressContent item={item} />;
    case "asset":
      return <AssetContent item={item} />;
    case "network":
      return <NetworkContent item={item} />;
    case "transaction":
      return <TransactionContent item={item} />;
    case "portfolio_position":
      return <PortfolioPositionContent item={item} />;
    case "activity_item":
      return <ActivityItemContent item={item} />;
  }
}

// ─── Modal Overlay ───────────────────────────────────────────────────────────

function DetailModalOverlay({ item, onClose }: { item: ModalItem; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg relative"
        style={{
          backgroundColor: "#0d0d0d",
          border: "1px solid rgba(201, 168, 76, 0.3)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center transition-colors z-10"
          style={{ color: "#8A8578" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#C9A84C")}
          onMouseLeave={e => (e.currentTarget.style.color = "#8A8578")}
          onClick={onClose}
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Content */}
        <ModalContent item={item} />

        {/* Footer */}
        <div className="px-5 py-3 flex justify-end" style={{ borderTop: "1px solid rgba(201, 168, 76, 0.1)" }}>
          <button
            className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] px-5 py-2 transition-colors"
            style={{
              border: "1px solid rgba(201, 168, 76, 0.3)",
              color: "#C9A84C",
              backgroundColor: "transparent",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = "rgba(201, 168, 76, 0.1)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function DetailModalProvider({ children }: { children: React.ReactNode }) {
  const [activeItem, setActiveItem] = useState<ModalItem | null>(null);

  const openModal = useCallback((item: ModalItem) => {
    setActiveItem(item);
  }, []);

  const closeModal = useCallback(() => {
    setActiveItem(null);
  }, []);

  return (
    <DetailModalContext.Provider value={{ openModal, closeModal }}>
      {children}
      {activeItem && <DetailModalOverlay item={activeItem} onClose={closeModal} />}
    </DetailModalContext.Provider>
  );
}
