"use client";

import { useEffect, useRef, useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import ActivityPanel from "~~/components/ActivityPanel";
import ChatMessageRenderer from "~~/components/ChatMessageRenderer";
import TransactionCard from "~~/components/TransactionCard";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface PortfolioAsset {
  blockchain: string;
  tokenName: string;
  tokenSymbol: string;
  positionType?: string;
  protocol?: string | null;
  balance: string;
  balanceUsd: string;
  tokenDecimals: number;
  contractAddress: string;
  thumbnail: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  transaction?: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    description: string;
    simulation?: {
      verified: boolean;
      changes: { direction: "in" | "out"; symbol: string; amount: string }[];
    };
  };
  timestamp: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const formatUsdValue = (value: string | number): string => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num < 0.01) return "<$0.01";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
};

const MAX_DISPLAY_ASSETS = 8;

// ─── Component ───────────────────────────────────────────────────────────────

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Chat persistence
  const STORAGE_KEY = address ? `clawd-chat-${address.toLowerCase()}` : null;
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const key = `clawd-chat-${address?.toLowerCase() || "anon"}`;
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Portfolio state
  const [portfolio, setPortfolio] = useState<PortfolioAsset[]>([]);
  const [defiPositions, setDefiPositions] = useState<PortfolioAsset[]>([]);
  const [totalBalanceUsd, setTotalBalanceUsd] = useState("0");
  const [totalPortfolioUsd, setTotalPortfolioUsd] = useState("0");
  const [change1dUsd, setChange1dUsd] = useState("0");
  const [change1dPct, setChange1dPct] = useState("0");
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [showAllAssets, setShowAllAssets] = useState(false);

  // Activity state
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  // Chat scroll ref
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Persist messages
  useEffect(() => {
    if (!STORAGE_KEY || messages.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-20)));
      } catch {
        /* ignore */
      }
    }
  }, [messages, STORAGE_KEY]);

  // Load saved messages when address changes
  useEffect(() => {
    if (!address) {
      setMessages([]);
      return;
    }
    try {
      const key = `clawd-chat-${address.toLowerCase()}`;
      const saved = localStorage.getItem(key);
      setMessages(saved ? JSON.parse(saved) : []);
    } catch {
      setMessages([]);
    }
  }, [address]);

  // Auto-scroll
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

  // Fetch portfolio + activity
  useEffect(() => {
    if (!address) {
      setPortfolio([]);
      setDefiPositions([]);
      setTotalBalanceUsd("0");
      setTotalPortfolioUsd("0");
      setChange1dUsd("0");
      setChange1dPct("0");
      setActivity([]);
      return;
    }

    const fetchPortfolio = async () => {
      setIsLoadingPortfolio(true);
      try {
        const res = await fetch(`/api/portfolio?address=${address}`);
        const data = await res.json();
        if (data.error) {
          console.error("Portfolio error:", data.error);
          return;
        }
        setPortfolio(data.assets || []);
        setDefiPositions(data.defiPositions || []);
        setTotalBalanceUsd(data.totalBalanceUsd || "0");
        setTotalPortfolioUsd(data.totalPortfolioUsd || "0");
        setChange1dUsd(data.change1dUsd || "0");
        setChange1dPct(data.change1dPct || "0");
      } catch (e) {
        console.error("Failed to fetch portfolio:", e);
      } finally {
        setIsLoadingPortfolio(false);
      }
    };

    const fetchActivity = async () => {
      try {
        const res = await fetch(`/api/activity?address=${address}`);
        const data = await res.json();
        setActivity(data.items || []);
      } catch (e) {
        console.error("Failed to fetch activity:", e);
      }
    };

    fetchPortfolio();
    setTimeout(fetchActivity, 1500);
  }, [address]);

  // ─── handleSubmit ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!message.trim() || !address) return;

    const userMsg: ChatMessage = { role: "user", content: message, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setMessage("");
    setIsProcessing(true);

    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          address,
          portfolio,
          recentMessages: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          recentActivity: activity.slice(0, 50),
        }),
      });
      const data = await res.json();

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.message || "Something went wrong",
        transaction: data.type === "transaction" ? data.transaction : undefined,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── Computed ────────────────────────────────────────────────────────────

  const walletTotal = parseFloat(totalBalanceUsd) || 0;
  const defiTotal = parseFloat(totalPortfolioUsd) || 0;
  const grandTotal = walletTotal + defiTotal;
  const changeUsd = parseFloat(change1dUsd) || 0;
  const changePct = parseFloat(change1dPct) || 0;
  const isChangeNegative = changeUsd < 0;

  const displayedAssets = showAllAssets ? portfolio : portfolio.slice(0, MAX_DISPLAY_ASSETS);
  const hiddenCount = portfolio.length - MAX_DISPLAY_ASSETS;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center flex-col flex-grow pt-0">
      <div className="px-4 w-full max-w-7xl">
        {!isConnected ? (
          /* ─── Not Connected: Gazette welcome ─── */
          <div className="flex flex-col items-center mt-16 gap-6">
            <p
              className="font-[family-name:var(--font-newsreader)] italic text-center"
              style={{ fontSize: "1.5rem", color: "#2C2C2C", maxWidth: "480px" }}
            >
              Connect your wallet to read the day&apos;s financial report
            </p>
            <RainbowKitCustomConnectButton />
          </div>
        ) : (
          /* ─── Connected: Three-column gazette layout ─── */
          <div className="mt-0">
            <div className="flex flex-col lg:flex-row gap-0" style={{ height: "calc(100vh - 110px)" }}>

              {/* ═══ LEFT COLUMN: Portfolio ═══ */}
              <div
                className="w-full lg:w-72 shrink-0 overflow-y-auto p-4"
                style={{ borderRight: "1px solid #DDD5C8" }}
              >
                {/* Section header */}
                <div className="mb-4 pb-2" style={{ borderBottom: "2px solid #2C2C2C" }}>
                  <p
                    className="font-semibold m-0"
                    style={{ color: "#2C2C2C", fontVariant: "small-caps", letterSpacing: "0.15em", fontSize: "13px" }}
                  >
                    PORTFOLIO
                  </p>
                </div>

                {/* Total value */}
                <div className="mb-4">
                  {isLoadingPortfolio ? (
                    <div className="flex items-center gap-2">
                      <span className="loading loading-spinner loading-sm"></span>
                      <span style={{ fontSize: "13px", color: "#8B8680" }}>Loading...</span>
                    </div>
                  ) : (
                    <div>
                      <span
                        className="font-[family-name:var(--font-victor-mono)] font-bold"
                        style={{ fontSize: "2rem", color: "#2C2C2C" }}
                      >
                        {formatUsdValue(grandTotal)}
                      </span>
                      {changeUsd !== 0 && (
                        <div className="mt-1">
                          <span
                            className="font-[family-name:var(--font-victor-mono)]"
                            style={{
                              fontSize: "13px",
                              color: isChangeNegative ? "#C41E3A" : "#2C2C2C",
                            }}
                          >
                            {isChangeNegative ? "▼" : "▲"} $
                            {Math.abs(changeUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })} (
                            {isChangeNegative ? "" : "+"}
                            {changePct.toFixed(1)}%)
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* WALLET section */}
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2 pb-1" style={{ borderBottom: "1px solid #DDD5C8" }}>
                    <span
                      className="font-semibold"
                      style={{ fontVariant: "small-caps", letterSpacing: "0.15em", fontSize: "11px", color: "#8B8680" }}
                    >
                      WALLET
                    </span>
                    <span
                      className="font-[family-name:var(--font-victor-mono)] font-semibold"
                      style={{ fontSize: "12px", color: "#2C2C2C" }}
                    >
                      {formatUsdValue(walletTotal)}
                    </span>
                  </div>

                  {isLoadingPortfolio ? (
                    <div className="text-center py-4" style={{ color: "#8B8680", fontSize: "13px" }}>Loading assets...</div>
                  ) : portfolio.length === 0 ? (
                    <div className="text-center py-4" style={{ color: "#8B8680", fontSize: "13px" }}>No assets found</div>
                  ) : (
                    <table className="w-full">
                      <tbody>
                        {displayedAssets.map((asset, i) => (
                          <tr
                            key={`${asset.blockchain}-${asset.contractAddress || "native"}-${i}`}
                            style={{ borderBottom: "1px solid #DDD5C8" }}
                          >
                            <td className="py-2 pr-2">
                              <div className="flex items-center gap-2">
                                <div className="relative w-6 h-6 shrink-0">
                                  {asset.thumbnail ? (
                                    <img
                                      src={asset.thumbnail}
                                      alt={asset.tokenSymbol}
                                      className="w-6 h-6 rounded-full"
                                      onError={e => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className="w-6 h-6 rounded-full flex items-center justify-center"
                                      style={{ backgroundColor: "#DDD5C8", fontSize: "10px", fontWeight: "bold" }}
                                    >
                                      {asset.tokenSymbol.slice(0, 2)}
                                    </div>
                                  )}
                                  {CHAIN_ICONS[asset.blockchain] && (
                                    <img
                                      src={CHAIN_ICONS[asset.blockchain]}
                                      alt={asset.blockchain}
                                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full"
                                      style={{ border: "1.5px solid #FFF8EE" }}
                                    />
                                  )}
                                </div>
                                <span className="font-semibold" style={{ fontSize: "13px" }}>
                                  {asset.tokenSymbol}
                                </span>
                              </div>
                            </td>
                            <td
                              className="py-2 text-right font-[family-name:var(--font-victor-mono)]"
                              style={{ fontSize: "13px", fontWeight: 600 }}
                            >
                              {formatUsdValue(asset.balanceUsd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {!showAllAssets && hiddenCount > 0 && (
                    <button
                      className="w-full text-center py-2"
                      style={{ fontSize: "12px", color: "#8B8680", background: "none", border: "none", cursor: "pointer" }}
                      onClick={() => setShowAllAssets(true)}
                    >
                      and {hiddenCount} more...
                    </button>
                  )}
                  {showAllAssets && hiddenCount > 0 && (
                    <button
                      className="w-full text-center py-2"
                      style={{ fontSize: "12px", color: "#8B8680", background: "none", border: "none", cursor: "pointer" }}
                      onClick={() => setShowAllAssets(false)}
                    >
                      Show less
                    </button>
                  )}
                </div>

                {/* PORTFOLIO (DeFi) section */}
                {defiPositions.length > 0 && (
                  <div>
                    <div className="flex justify-between items-center mb-2 pb-1" style={{ borderBottom: "1px solid #DDD5C8" }}>
                      <span
                        className="font-semibold"
                        style={{ fontVariant: "small-caps", letterSpacing: "0.15em", fontSize: "11px", color: "#8B8680" }}
                      >
                        POSITIONS
                      </span>
                      <span
                        className="font-[family-name:var(--font-victor-mono)] font-semibold"
                        style={{ fontSize: "12px", color: "#2C2C2C" }}
                      >
                        {formatUsdValue(defiTotal)}
                      </span>
                    </div>
                    <table className="w-full">
                      <tbody>
                        {defiPositions.map((pos, i) => (
                          <tr
                            key={`defi-${pos.blockchain}-${pos.contractAddress || pos.tokenSymbol}-${i}`}
                            style={{ borderBottom: "1px solid #DDD5C8" }}
                          >
                            <td className="py-2 pr-2">
                              <div className="flex items-center gap-2">
                                <div className="relative w-5 h-5 shrink-0">
                                  {pos.thumbnail ? (
                                    <img
                                      src={pos.thumbnail}
                                      alt={pos.tokenSymbol}
                                      className="w-5 h-5 rounded-full"
                                      onError={e => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className="w-5 h-5 rounded-full flex items-center justify-center"
                                      style={{ backgroundColor: "#DDD5C8", fontSize: "9px", fontWeight: "bold" }}
                                    >
                                      {pos.tokenSymbol.slice(0, 2)}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <div style={{ fontSize: "12px", fontWeight: 600 }}>{pos.tokenSymbol}</div>
                                  <div
                                    style={{ fontSize: "10px", color: "#8B8680", textTransform: "capitalize" }}
                                  >
                                    {pos.positionType}
                                    {pos.protocol ? ` · ${pos.protocol}` : ""}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td
                              className="py-2 text-right font-[family-name:var(--font-victor-mono)]"
                              style={{ fontSize: "12px", fontWeight: 600 }}
                            >
                              {formatUsdValue(pos.balanceUsd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ═══ CENTER COLUMN: Chat ═══ */}
              <div className="flex-1 min-w-0 flex flex-col" style={{ borderRight: "1px solid #DDD5C8" }}>
                {/* Section header */}
                <div className="px-4 pt-4 pb-0">
                  <div className="flex justify-between items-center mb-3 pb-2" style={{ borderBottom: "2px solid #2C2C2C" }}>
                    <p
                      className="font-semibold m-0"
                      style={{ color: "#2C2C2C", fontVariant: "small-caps", letterSpacing: "0.15em", fontSize: "13px" }}
                    >
                      CORRESPONDENCE
                    </p>
                    {messages.length > 0 && (
                      <button
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "11px",
                          color: "#8B8680",
                          fontFamily: "var(--font-victor-mono)",
                        }}
                        onClick={() => {
                          setMessages([]);
                          if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto px-4 pb-4" ref={chatScrollRef}>
                  {messages.length === 0 && (
                    <div className="text-center mt-16">
                      <p
                        className="font-[family-name:var(--font-newsreader)] italic"
                        style={{ fontSize: "1.15rem", color: "#8B8680" }}
                      >
                        Inquire about your holdings
                      </p>
                      <p style={{ fontSize: "13px", color: "#8B8680", marginTop: "0.5rem" }}>
                        or instruct: &quot;swap 0.1 ETH for USDC&quot;
                      </p>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      style={{ marginBottom: "0.5rem" }}
                    >
                      <div
                        className="max-w-[85%] px-3 py-2"
                        style={{
                          backgroundColor: msg.role === "user" ? "#2C2C2C" : "#FFF4E6",
                          color: msg.role === "user" ? "#FFF8EE" : "#2C2C2C",
                          border: msg.role === "user" ? "none" : "1px solid #DDD5C8",
                        }}
                      >
                        {msg.role === "assistant" ? (
                          <ChatMessageRenderer content={msg.content} portfolio={portfolio} />
                        ) : (
                          <p
                            className="whitespace-pre-wrap leading-snug m-0 font-[family-name:var(--font-literata)]"
                            style={{ fontSize: "14px" }}
                          >
                            {msg.content}
                          </p>
                        )}

                        {msg.transaction && <TransactionCard tx={msg.transaction} address={address!} />}
                      </div>
                    </div>
                  ))}
                  {isProcessing && (
                    <div className="flex justify-start">
                      <div className="px-3 py-2" style={{ backgroundColor: "#FFF4E6", border: "1px solid #DDD5C8" }}>
                        <span className="loading loading-dots loading-sm"></span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input — sticky bottom */}
                <div className="sticky bottom-0 pb-4 pt-2 px-4" style={{ backgroundColor: "#FFF8EE" }}>
                  <div className="flex gap-0">
                    <input
                      type="text"
                      placeholder="Inquire about your wallet, or instruct a transaction..."
                      className="flex-1 px-3 py-2 font-[family-name:var(--font-literata)]"
                      style={{
                        fontSize: "14px",
                        backgroundColor: "#FFF8EE",
                        border: "1px solid #DDD5C8",
                        borderRight: "none",
                        outline: "none",
                        color: "#2C2C2C",
                      }}
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !isProcessing && handleSubmit()}
                      disabled={isProcessing}
                    />
                    <button
                      className="px-4 py-2"
                      style={{
                        backgroundColor: "#2C2C2C",
                        color: "#FFF8EE",
                        border: "1px solid #2C2C2C",
                        cursor: isProcessing || !message.trim() ? "not-allowed" : "pointer",
                        opacity: isProcessing || !message.trim() ? 0.4 : 1,
                      }}
                      onClick={handleSubmit}
                      disabled={isProcessing || !message.trim()}
                    >
                      {isProcessing ? (
                        <span className="loading loading-spinner loading-sm"></span>
                      ) : (
                        <span style={{ fontFamily: "var(--font-victor-mono)", fontSize: "14px" }}>→</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* ═══ RIGHT COLUMN: Activity ═══ */}
              <div className="w-full lg:w-80 shrink-0 overflow-y-auto p-4">
                <ActivityPanel address={address!} initialItems={activity} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
