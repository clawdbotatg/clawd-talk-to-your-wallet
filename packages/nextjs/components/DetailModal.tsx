"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useEnsAvatar, useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";
import AddressChip from "~~/components/AddressChip";
import AssetChip from "~~/components/AssetChip";
import NetworkChip from "~~/components/NetworkChip";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModalItem =
  | { type: "address"; address: string; ens?: string }
  | { type: "asset"; symbol: string; amount?: string; chain?: string; thumbnail?: string; contractAddress?: string }
  | { type: "network"; chain: string }
  | { type: "transaction"; hash: string; chain: string }
  | {
      type: "portfolio_position";
      symbol: string;
      tokenName: string;
      chain: string;
      balance: string;
      balanceUsd: string;
      contractAddress?: string;
      thumbnail?: string;
      protocol?: string;
      positionType?: string;
      walletAddress?: string;
    }
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

// ─── Shared Components ───────────────────────────────────────────────────────

function LoadingSkeleton({ width = "60%" }: { width?: string }) {
  return <div className="h-3 rounded animate-pulse" style={{ backgroundColor: "rgba(201,168,76,0.1)", width }} />;
}

function DataRow({ label, value, mono = false }: { label: string; value?: React.ReactNode | null; mono?: boolean }) {
  return (
    <div
      className="flex items-center justify-between py-2"
      style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}
    >
      <span className="text-xs" style={{ color: "#8A8578" }}>
        {label}
      </span>
      {value != null ? (
        typeof value === "string" ? (
          <span
            className={`text-xs ${mono ? "font-[family-name:var(--font-jetbrains)]" : ""}`}
            style={{ color: "#E8E4DC" }}
          >
            {value}
          </span>
        ) : (
          <span className="text-xs">{value}</span>
        )
      ) : (
        <LoadingSkeleton />
      )}
    </div>
  );
}

function ExplorerLink({ url, label = "View on Explorer" }: { url: string; label?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs underline transition-colors"
      style={{ color: "#C9A84C" }}
      onMouseEnter={e => (e.currentTarget.style.color = "#E8E4DC")}
      onMouseLeave={e => (e.currentTarget.style.color = "#C9A84C")}
    >
      {label} ↗
    </a>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="text-xs transition-colors ml-2 cursor-pointer"
      style={{ color: copied ? "#4CAF50" : "#8A8578" }}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

// Plain address display for contracts — no modal trigger, just copy + explorer link
const CHAIN_EXPLORERS: Record<string, string> = {
  ethereum: "https://etherscan.io/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
  optimism: "https://optimistic.etherscan.io/address/",
  polygon: "https://polygonscan.com/address/",
  gnosis: "https://gnosisscan.io/address/",
  xdai: "https://gnosisscan.io/address/",
};

function ContractAddressDisplay({ address, chain }: { address: string; chain?: string }) {
  const truncated = `${address.slice(0, 8)}…${address.slice(-6)}`;
  const explorerBase = chain
    ? CHAIN_EXPLORERS[chain.toLowerCase()] || "https://etherscan.io/address/"
    : "https://etherscan.io/address/";
  return (
    <span className="flex items-center gap-1">
      <a
        href={`${explorerBase}${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-[family-name:var(--font-jetbrains)] text-xs hover:underline"
        style={{ color: "#C9A84C" }}
      >
        {truncated}
      </a>
      <CopyButton text={address} />
    </span>
  );
}

function PriceChange({ pct }: { pct: number }) {
  const isPositive = pct >= 0;
  return (
    <span style={{ color: isPositive ? "#4CAF50" : "#ef4444" }}>
      {isPositive ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

// ─── Per-Type Content ────────────────────────────────────────────────────────

interface AddressData {
  portfolioUsd: string;
  ethBalance: string;
  topTokens: { symbol: string; balanceUsd: string; icon: string }[];
  txCount: number;
}

function AddressContent({ item }: { item: Extract<ModalItem, { type: "address" }> }) {
  const [data, setData] = useState<AddressData | null>(null);
  const [error, setError] = useState(false);
  const truncated = `${item.address.slice(0, 6)}…${item.address.slice(-4)}`;

  const { data: ensName } = useEnsName({ address: item.address as `0x${string}`, chainId: mainnet.id });
  const { data: ensAvatar } = useEnsAvatar({ name: ensName || undefined, chainId: mainnet.id });

  useEffect(() => {
    fetch(`/api/modal/address?address=${item.address}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(true);
          return;
        }
        setData(d);
      })
      .catch(() => setError(true));
  }, [item.address]);

  const displayEns = ensName || item.ens;

  return (
    <>
      <ModalHeader label="Address" identifier={displayEns || truncated} />
      <div className="px-5 py-4 space-y-0">
        {/* ENS + Avatar */}
        {(displayEns || ensAvatar) && (
          <div className="flex items-center gap-3 pb-3" style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}>
            {ensAvatar && <img src={ensAvatar} alt="" className="w-8 h-8 rounded-full" />}
            {displayEns && (
              <span className="font-[family-name:var(--font-cinzel)] text-sm" style={{ color: "#C9A84C" }}>
                {displayEns}
              </span>
            )}
          </div>
        )}

        {/* Full address with copy */}
        <div
          className="flex items-center justify-between py-2"
          style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}
        >
          <span className="text-xs" style={{ color: "#8A8578" }}>
            Address
          </span>
          <span className="flex items-center">
            <span className="font-[family-name:var(--font-jetbrains)] text-xs" style={{ color: "#E8E4DC" }}>
              {truncated}
            </span>
            <CopyButton text={item.address} />
          </span>
        </div>

        <DataRow label="ETH Balance" value={error ? "—" : data ? `${data.ethBalance} ETH` : null} mono />
        <DataRow label="Portfolio" value={error ? "—" : data ? formatUsd(parseFloat(data.portfolioUsd)) : null} />
        <DataRow label="Transactions" value={error ? "—" : data ? data.txCount.toLocaleString() : null} />

        {/* Top tokens */}
        {data && data.topTokens.length > 0 && (
          <div className="pt-3">
            <span className="text-xs" style={{ color: "#8A8578" }}>
              Top Tokens
            </span>
            <div className="mt-1 space-y-1">
              {data.topTokens.slice(0, 5).map(t => (
                <div key={t.symbol} className="flex items-center justify-between py-1">
                  <AssetChip symbol={t.symbol} thumbnail={t.icon} />
                  <span className="font-[family-name:var(--font-jetbrains)] text-xs" style={{ color: "#8A8578" }}>
                    {formatUsd(parseFloat(t.balanceUsd))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Etherscan link */}
        <div className="pt-3">
          <ExplorerLink url={`https://etherscan.io/address/${item.address}`} label="View on Etherscan" />
        </div>
      </div>
    </>
  );
}

// ─── Asset Content ───────────────────────────────────────────────────────────

interface AssetData {
  symbol: string;
  name: string;
  price: number | null;
  priceChange24h: number | null;
  marketCap: number | null;
  volume24h: number | null;
  description: string | null;
  icon: string | null;
  links: { type: string; url: string; name: string }[];
  implementations: { chain: string; address: string | null; decimals: number }[];
}

function AssetContent({ item }: { item: Extract<ModalItem, { type: "asset" }> }) {
  const [data, setData] = useState<AssetData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/modal/asset?symbol=${encodeURIComponent(item.symbol)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(true);
          return;
        }
        setData(d);
      })
      .catch(() => setError(true));
  }, [item.symbol]);

  return (
    <>
      <ModalHeader label="Asset" identifier={item.symbol} />
      <div className="px-5 py-4 space-y-0">
        {/* Token icon + name */}
        {(item.thumbnail || data?.icon) && (
          <div className="flex items-center gap-3 pb-3" style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}>
            <img src={item.thumbnail || data?.icon || ""} alt="" className="w-8 h-8 rounded-full" />
            {data?.name && (
              <span className="font-[family-name:var(--font-cinzel)] text-sm" style={{ color: "#E8E4DC" }}>
                {data.name}
              </span>
            )}
          </div>
        )}

        {item.amount && <DataRow label="Balance" value={<AssetChip symbol={item.symbol} amount={item.amount} />} />}
        {item.chain && <DataRow label="Chain" value={<NetworkChip chain={item.chain} />} />}

        {/* Price with 24h change */}
        <div
          className="flex items-center justify-between py-2"
          style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}
        >
          <span className="text-xs" style={{ color: "#8A8578" }}>
            Price
          </span>
          {data?.price != null ? (
            <span className="text-xs flex items-center gap-2">
              <span className="font-[family-name:var(--font-jetbrains)]" style={{ color: "#E8E4DC" }}>
                {formatUsd(data.price)}
              </span>
              {data.priceChange24h != null && <PriceChange pct={data.priceChange24h} />}
            </span>
          ) : error ? (
            <span className="text-xs" style={{ color: "#E8E4DC" }}>
              —
            </span>
          ) : (
            <LoadingSkeleton />
          )}
        </div>

        <DataRow label="Market Cap" value={error ? "—" : data?.marketCap != null ? formatUsd(data.marketCap) : null} />
        <DataRow label="24h Volume" value={error ? "—" : data?.volume24h != null ? formatUsd(data.volume24h) : null} />

        {/* Contract addresses per chain from Zerion implementations */}
        {data?.implementations && data.implementations.length > 0 && (
          <div className="pt-2">
            <span className="text-xs block pb-1" style={{ color: "#8A8578" }}>
              Contracts
            </span>
            {data.implementations.map((impl, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid rgba(201,168,76,0.06)" }}
              >
                <NetworkChip chain={impl.chain} />
                {impl.address ? (
                  <ContractAddressDisplay address={impl.address} chain={impl.chain} />
                ) : (
                  <span className="text-xs" style={{ color: "#8A8578" }}>
                    native
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Fallback: contractAddress from item props if no implementations */}
        {(!data?.implementations || data.implementations.length === 0) && item.contractAddress && (
          <DataRow label="Contract" value={<ContractAddressDisplay address={item.contractAddress} />} />
        )}

        {/* Description */}
        {data?.description && (
          <div className="pt-3">
            <span className="text-xs" style={{ color: "#8A8578" }}>
              About
            </span>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "#E8E4DC" }}>
              {data.description.length > 200 ? `${data.description.slice(0, 200)}…` : data.description}
            </p>
          </div>
        )}

        {/* Links */}
        <div className="pt-3 flex gap-3 flex-wrap">
          {data?.links &&
            data.links.length > 0 &&
            data.links.map((l, i) => <ExplorerLink key={i} url={l.url} label={l.name || l.type} />)}
        </div>
      </div>
    </>
  );
}

// ─── Network Content ─────────────────────────────────────────────────────────

interface NetworkData {
  gasGwei: string;
  blockNumber: number;
  chainId: number;
  explorerUrl: string;
}

const CHAIN_ICONS: Record<string, string> = {
  ethereum: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
  base: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
  arbitrum: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
  optimism: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg",
  polygon: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg",
};

function NetworkContent({ item }: { item: Extract<ModalItem, { type: "network" }> }) {
  const [data, setData] = useState<NetworkData | null>(null);
  const [error, setError] = useState(false);
  const chainKey = item.chain.toLowerCase();

  useEffect(() => {
    fetch(`/api/modal/network?chain=${encodeURIComponent(item.chain)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(true);
          return;
        }
        setData(d);
      })
      .catch(() => setError(true));
  }, [item.chain]);

  const icon = CHAIN_ICONS[chainKey];
  const displayName = item.chain.charAt(0).toUpperCase() + item.chain.slice(1);

  return (
    <>
      <ModalHeader label="Network" identifier={displayName} />
      <div className="px-5 py-4 space-y-0">
        {/* Chain icon + name */}
        <div className="flex items-center gap-3 pb-3" style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}>
          {icon && <img src={icon} alt="" className="w-8 h-8 rounded-full" />}
          <span className="font-[family-name:var(--font-cinzel)] text-sm" style={{ color: "#E8E4DC" }}>
            {displayName}
          </span>
        </div>

        <DataRow label="Gas Price" value={error ? "—" : data ? `${data.gasGwei} gwei` : null} mono />
        <DataRow label="Latest Block" value={error ? "—" : data ? data.blockNumber.toLocaleString() : null} mono />
        <DataRow label="Chain ID" value={error ? "—" : data ? String(data.chainId) : null} mono />

        {/* Explorer link */}
        {data?.explorerUrl && (
          <div className="pt-3">
            <ExplorerLink url={data.explorerUrl} label="Block Explorer" />
          </div>
        )}
      </div>
    </>
  );
}

// ─── Transaction Content (for "transaction" type modal) ──────────────────────

interface TransactionData {
  from: string;
  to: string;
  valueEth: string;
  gasUsed: number;
  gasCostEth: string;
  blockNumber: number | null;
  timestamp: string | null;
  status: string;
  explorerUrl: string;
}

function TransactionContent({ item }: { item: Extract<ModalItem, { type: "transaction" }> }) {
  const [data, setData] = useState<TransactionData | null>(null);
  const [error, setError] = useState(false);
  const truncatedHash = `${item.hash.slice(0, 10)}…${item.hash.slice(-6)}`;

  useEffect(() => {
    fetch(`/api/modal/transaction?hash=${item.hash}&chain=${item.chain}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(true);
          return;
        }
        setData(d);
      })
      .catch(() => setError(true));
  }, [item.hash, item.chain]);

  return (
    <>
      <ModalHeader label="Transaction" identifier={truncatedHash} />
      <div className="px-5 py-4 space-y-0">
        {/* Hash with copy */}
        <div
          className="flex items-center justify-between py-2"
          style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}
        >
          <span className="text-xs" style={{ color: "#8A8578" }}>
            Hash
          </span>
          <span className="flex items-center">
            <span className="font-[family-name:var(--font-jetbrains)] text-xs" style={{ color: "#E8E4DC" }}>
              {truncatedHash}
            </span>
            <CopyButton text={item.hash} />
          </span>
        </div>

        {/* Status */}
        <div
          className="flex items-center justify-between py-2"
          style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}
        >
          <span className="text-xs" style={{ color: "#8A8578" }}>
            Status
          </span>
          {data ? (
            <span
              className="text-xs"
              style={{
                color: data.status === "success" ? "#4CAF50" : data.status === "failed" ? "#ef4444" : "#C9A84C",
              }}
            >
              {data.status === "success" ? "✅ Confirmed" : data.status === "failed" ? "❌ Failed" : "⏳ Pending"}
            </span>
          ) : error ? (
            <span className="text-xs" style={{ color: "#E8E4DC" }}>
              —
            </span>
          ) : (
            <LoadingSkeleton />
          )}
        </div>

        <DataRow label="Chain" value={<NetworkChip chain={item.chain} />} />

        {/* From */}
        <DataRow label="From" value={data?.from ? <AddressChip address={data.from} /> : error ? "—" : null} />

        {/* To */}
        <DataRow label="To" value={data?.to ? <AddressChip address={data.to} /> : error ? "—" : null} />

        <DataRow label="Value" value={error ? "—" : data ? <AssetChip symbol="ETH" amount={data.valueEth} /> : null} />
        <DataRow
          label="Gas Cost"
          value={error ? "—" : data ? <AssetChip symbol="ETH" amount={data.gasCostEth} /> : null}
        />
        <DataRow
          label="Block"
          value={error ? "—" : data?.blockNumber != null ? data.blockNumber.toLocaleString() : null}
          mono
        />

        {/* Timestamp */}
        {data?.timestamp && <DataRow label="Time" value={new Date(data.timestamp).toLocaleString()} />}

        {/* Explorer */}
        {data?.explorerUrl && (
          <div className="pt-3">
            <ExplorerLink url={data.explorerUrl} />
          </div>
        )}
      </div>
    </>
  );
}

// ─── Portfolio Position Content ──────────────────────────────────────────────

function PortfolioPositionContent({ item }: { item: Extract<ModalItem, { type: "portfolio_position" }> }) {
  // Derive price per token from balance and USD value
  const pricePerToken = (() => {
    const qty = parseFloat(item.balance);
    const usd = parseFloat(item.balanceUsd.replace(/[^0-9.-]/g, ""));
    if (qty > 0 && usd > 0) return usd / qty;
    return null;
  })();

  return (
    <>
      <ModalHeader label="Position" identifier={item.symbol} />
      <div className="px-5 py-4 space-y-0">
        {/* Token icon + name */}
        <div className="flex items-center gap-3 pb-3" style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}>
          {item.thumbnail && <img src={item.thumbnail} alt="" className="w-8 h-8 rounded-full" />}
          <div>
            <span className="font-[family-name:var(--font-cinzel)] text-sm block" style={{ color: "#E8E4DC" }}>
              {item.tokenName || item.symbol}
            </span>
            {item.protocol && (
              <span className="text-xs" style={{ color: "#8A8578" }}>
                via {item.protocol}
              </span>
            )}
          </div>
        </div>

        {/* How much they hold */}
        <DataRow
          label="Amount"
          value={`${parseFloat(item.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${item.symbol}`}
        />

        {/* USD value */}
        <DataRow label="Value" value={item.balanceUsd.startsWith("$") ? item.balanceUsd : `$${item.balanceUsd}`} />

        {/* Price per token (derived) */}
        {pricePerToken != null && <DataRow label="Price" value={formatUsd(pricePerToken)} />}

        {/* Chain */}
        <DataRow label="Chain" value={<NetworkChip chain={item.chain} />} />

        {/* Position type */}
        {item.positionType && item.positionType !== "wallet" && <DataRow label="Type" value={item.positionType} />}

        {/* Protocol */}
        {item.protocol && <DataRow label="Protocol" value={item.protocol} />}

        {/* Contract address */}
        {item.contractAddress && item.contractAddress !== "0x0000000000000000000000000000000000000000" && (
          <div
            className="flex items-center justify-between py-2"
            style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}
          >
            <span className="text-xs" style={{ color: "#8A8578" }}>
              Contract
            </span>
            <ContractAddressDisplay address={item.contractAddress} chain={item.chain} />
          </div>
        )}

        {/* External links */}
        <div className="pt-3 flex gap-3 flex-wrap">
          {item.walletAddress && (
            <ExplorerLink url={`https://app.zerion.io/${item.walletAddress}/overview`} label="View on Zerion" />
          )}
          {item.contractAddress &&
            item.contractAddress !== "0x0000000000000000000000000000000000000000" &&
            (() => {
              const explorers: Record<string, string> = {
                ethereum: "https://etherscan.io/token/",
                base: "https://basescan.org/token/",
                arbitrum: "https://arbiscan.io/token/",
                optimism: "https://optimistic.etherscan.io/token/",
                polygon: "https://polygonscan.com/token/",
                gnosis: "https://gnosisscan.io/token/",
              };
              const explorerBase = explorers[item.chain];
              return explorerBase ? (
                <ExplorerLink url={`${explorerBase}${item.contractAddress}`} label="Token contract" />
              ) : null;
            })()}
        </div>
      </div>
    </>
  );
}

// ─── Activity Item Content ───────────────────────────────────────────────────

function ActivityItemContent({ item }: { item: Extract<ModalItem, { type: "activity_item" }> }) {
  const [data, setData] = useState<TransactionData | null>(null);
  const [error, setError] = useState(false);
  const truncatedHash = `${item.hash.slice(0, 10)}…${item.hash.slice(-6)}`;

  useEffect(() => {
    fetch(`/api/modal/transaction?hash=${item.hash}&chain=${item.chain}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(true);
          return;
        }
        setData(d);
      })
      .catch(() => setError(true));
  }, [item.hash, item.chain]);

  const typeBadgeColor =
    {
      send: "#ef4444",
      receive: "#4CAF50",
      trade: "#C9A84C",
      approve: "#8A8578",
      deposit: "#4CAF50",
      withdraw: "#ef4444",
      mint: "#C9A84C",
      bridge: "#C9A84C",
    }[item.txType] || "#8A8578";

  return (
    <>
      <ModalHeader label={item.txType} identifier={truncatedHash} />
      <div className="px-5 py-4 space-y-0">
        {/* Type badge + Status */}
        <div className="flex items-center gap-3 pb-3" style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}>
          <span
            className="text-xs px-2 py-0.5 uppercase tracking-wider font-[family-name:var(--font-cinzel)]"
            style={{
              backgroundColor: `${typeBadgeColor}15`,
              border: `1px solid ${typeBadgeColor}40`,
              color: typeBadgeColor,
            }}
          >
            {item.txType}
          </span>
          {data && (
            <span
              className="text-xs"
              style={{
                color: data.status === "success" ? "#4CAF50" : data.status === "failed" ? "#ef4444" : "#C9A84C",
              }}
            >
              {data.status === "success" ? "✅ Confirmed" : data.status === "failed" ? "❌ Failed" : "⏳ Pending"}
            </span>
          )}
        </div>

        {/* Hash with copy */}
        <div
          className="flex items-center justify-between py-2"
          style={{ borderBottom: "1px solid rgba(201, 168, 76, 0.06)" }}
        >
          <span className="text-xs" style={{ color: "#8A8578" }}>
            Hash
          </span>
          <span className="flex items-center">
            <span className="font-[family-name:var(--font-jetbrains)] text-xs" style={{ color: "#E8E4DC" }}>
              {truncatedHash}
            </span>
            <CopyButton text={item.hash} />
          </span>
        </div>

        <DataRow label="Chain" value={<NetworkChip chain={item.chain} />} />

        {/* From → To */}
        {data?.from && <DataRow label="From" value={<AddressChip address={data.from} />} />}
        {data?.to && <DataRow label="To" value={<AddressChip address={data.to} />} />}

        {item.valueUsd != null && <DataRow label="Value (USD)" value={`$${item.valueUsd.toFixed(2)}`} />}
        <DataRow
          label="Value (ETH)"
          value={error ? "—" : data ? <AssetChip symbol="ETH" amount={data.valueEth} /> : null}
        />
        <DataRow
          label="Gas Cost"
          value={error ? "—" : data ? <AssetChip symbol="ETH" amount={data.gasCostEth} /> : null}
        />
        <DataRow
          label="Block"
          value={error ? "—" : data?.blockNumber != null ? data.blockNumber.toLocaleString() : null}
          mono
        />

        {/* Timestamp */}
        {data?.timestamp && <DataRow label="Time" value={new Date(data.timestamp).toLocaleString()} />}

        {/* Explorer */}
        {data?.explorerUrl && (
          <div className="pt-3">
            <ExplorerLink url={data.explorerUrl} />
          </div>
        )}
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 cursor-pointer"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg relative max-h-[85vh] overflow-y-auto"
        style={{
          backgroundColor: "#0d0d0d",
          border: "1px solid rgba(201, 168, 76, 0.3)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center transition-colors z-10 cursor-pointer"
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
            className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] px-5 py-2 transition-colors cursor-pointer"
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
