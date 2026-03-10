"use client";

import { useEffect, useRef, useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import ActivityPanel from "~~/components/ActivityPanel";
import ChatMessageRenderer from "~~/components/ChatMessageRenderer";
import { useDetailModal } from "~~/components/DetailModal";
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
    txHash?: `0x${string}`;
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
  const { openModal } = useDetailModal();
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

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

  const [portfolio, setPortfolio] = useState<PortfolioAsset[]>([]);
  const [defiPositions, setDefiPositions] = useState<PortfolioAsset[]>([]);
  const [totalBalanceUsd, setTotalBalanceUsd] = useState("0");
  const [totalPortfolioUsd, setTotalPortfolioUsd] = useState("0");
  const [change1dUsd, setChange1dUsd] = useState("0");
  const [change1dPct, setChange1dPct] = useState("0");
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [showAllAssets, setShowAllAssets] = useState(false);

  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const chatScrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

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
    <div className="flex items-center flex-col flex-grow pt-2" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="px-5 w-full max-w-7xl">
        {!isConnected ? (
          <div
            className="fixed inset-0 flex flex-col items-center justify-center gap-8"
            style={{
              backgroundImage: "url('/coins-bg.jpg')",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {/* Dark overlay so text is readable */}
            <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.55)" }} />
            <div className="relative z-10 flex flex-col items-center gap-6">
              <h1
                className="font-[family-name:var(--font-cinzel)] text-5xl sm:text-7xl font-bold tracking-[0.3em] text-center"
                style={{ color: "#C9A84C", textShadow: "0 2px 24px rgba(0,0,0,0.8)" }}
              >
                DENARAI
              </h1>
              <p
                className="font-[family-name:var(--font-cinzel)] text-lg sm:text-xl tracking-[0.25em] text-center"
                style={{ color: "#E8E4DC", textShadow: "0 1px 12px rgba(0,0,0,0.9)" }}
              >
                talk to your coins
              </p>
              <div className="h-px w-48" style={{ backgroundColor: "rgba(201, 168, 76, 0.3)" }} />
              <RainbowKitCustomConnectButton />
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <div className="flex flex-col lg:flex-row gap-4" style={{ height: "calc(100vh - 80px)" }}>
              {/* LEFT SIDEBAR: Portfolio */}
              <div className="w-full lg:w-72 shrink-0 space-y-4 overflow-y-auto">
                <div
                  className="p-4 space-y-4"
                  style={{
                    backgroundColor: "#111111",
                    border: "1px solid rgba(201, 168, 76, 0.15)",
                  }}
                >
                  {/* Total + daily change header */}
                  <div>
                    {isLoadingPortfolio ? (
                      <div className="flex items-center gap-2">
                        <span className="loading loading-spinner loading-sm" style={{ color: "#C9A84C" }}></span>
                        <span className="text-sm" style={{ color: "#8A8578" }}>
                          Loading...
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-[family-name:var(--font-jetbrains)] text-2xl font-light"
                          style={{ color: "#E8E4DC" }}
                        >
                          {formatUsdValue(grandTotal)}
                        </span>
                        {changeUsd !== 0 && (
                          <span
                            className="font-[family-name:var(--font-jetbrains)] text-sm"
                            style={{ color: isChangeNegative ? "#9B3D3D" : "#C9A84C" }}
                          >
                            {isChangeNegative ? "" : "+"}
                            {changePct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* WALLET section */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs tracking-[0.2em] uppercase" style={{ color: "#8A8578" }}>
                        Wallet
                      </span>
                      <span className="font-[family-name:var(--font-jetbrains)] text-sm" style={{ color: "#8A8578" }}>
                        {formatUsdValue(walletTotal)}
                      </span>
                    </div>

                    {isLoadingPortfolio ? (
                      <div className="text-center py-4" style={{ color: "#8A8578" }}>
                        Loading assets...
                      </div>
                    ) : portfolio.length === 0 ? (
                      <div className="text-center py-4" style={{ color: "#8A8578" }}>
                        No assets found
                      </div>
                    ) : (
                      <div className="space-y-0">
                        {displayedAssets.map((asset, i) => (
                          <div
                            key={`${asset.blockchain}-${asset.contractAddress || "native"}-${i}`}
                            className="flex items-center justify-between py-2 px-2 -mx-2 transition-colors duration-300 hover:bg-white/[0.02] cursor-pointer"
                            style={{
                              borderBottom: "1px solid rgba(201, 168, 76, 0.06)",
                            }}
                            onClick={() =>
                              openModal({
                                type: "portfolio_position",
                                symbol: asset.tokenSymbol,
                                chain: asset.blockchain,
                                balanceUsd: asset.balanceUsd,
                                protocol: asset.protocol ?? undefined,
                              })
                            }
                          >
                            <div className="flex items-center gap-2">
                              <div className="relative w-7 h-7 shrink-0">
                                {asset.thumbnail ? (
                                  <img
                                    src={asset.thumbnail}
                                    alt={asset.tokenSymbol}
                                    className="w-7 h-7 rounded-full"
                                    onError={e => {
                                      (e.target as HTMLImageElement).src = "";
                                      (e.target as HTMLImageElement).style.display = "none";
                                      const parent = (e.target as HTMLImageElement).parentElement;
                                      if (parent) {
                                        const fallback = document.createElement("div");
                                        fallback.className =
                                          "w-7 h-7 flex items-center justify-center text-xs font-bold absolute inset-0";
                                        fallback.style.backgroundColor = "#111111";
                                        fallback.style.border = "1px solid rgba(201, 168, 76, 0.2)";
                                        fallback.style.color = "#C9A84C";
                                        fallback.textContent = asset.tokenSymbol.slice(0, 2);
                                        parent.appendChild(fallback);
                                      }
                                    }}
                                  />
                                ) : (
                                  <div
                                    className="w-7 h-7 flex items-center justify-center text-xs font-[family-name:var(--font-cinzel)] font-semibold"
                                    style={{
                                      backgroundColor: "#111111",
                                      border: "1px solid rgba(201, 168, 76, 0.2)",
                                      color: "#C9A84C",
                                    }}
                                  >
                                    {asset.tokenSymbol.slice(0, 1)}
                                  </div>
                                )}
                                {CHAIN_ICONS[asset.blockchain] && (
                                  <img
                                    src={CHAIN_ICONS[asset.blockchain]}
                                    alt={asset.blockchain}
                                    className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2"
                                    style={{ borderColor: "#111111" }}
                                  />
                                )}
                              </div>
                              <div>
                                <div className="text-sm" style={{ color: "#E8E4DC" }}>
                                  {asset.tokenSymbol}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div
                                className="font-[family-name:var(--font-jetbrains)] text-sm"
                                style={{ color: "#E8E4DC" }}
                              >
                                {formatUsdValue(asset.balanceUsd)}
                              </div>
                            </div>
                          </div>
                        ))}

                        {!showAllAssets && hiddenCount > 0 && (
                          <button
                            className="w-full text-center text-sm py-2 transition-colors"
                            style={{ color: "#C9A84C" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "#B8963E")}
                            onMouseLeave={e => (e.currentTarget.style.color = "#C9A84C")}
                            onClick={() => setShowAllAssets(true)}
                          >
                            and {hiddenCount} more...
                          </button>
                        )}
                        {showAllAssets && hiddenCount > 0 && (
                          <button
                            className="w-full text-center text-sm py-2 transition-colors"
                            style={{ color: "#C9A84C" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "#B8963E")}
                            onMouseLeave={e => (e.currentTarget.style.color = "#C9A84C")}
                            onClick={() => setShowAllAssets(false)}
                          >
                            Show less
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* PORTFOLIO (DeFi) section */}
                  {defiPositions.length > 0 && (
                    <>
                      <div className="h-px" style={{ backgroundColor: "rgba(201, 168, 76, 0.15)" }} />
                      <div>
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs tracking-[0.2em] uppercase" style={{ color: "#8A8578" }}>
                            Portfolio
                          </span>
                          <span
                            className="font-[family-name:var(--font-jetbrains)] text-sm"
                            style={{ color: "#8A8578" }}
                          >
                            {formatUsdValue(defiTotal)}
                          </span>
                        </div>
                        <div className="space-y-0">
                          {defiPositions.map((pos, i) => (
                            <div
                              key={`defi-${pos.blockchain}-${pos.contractAddress || pos.tokenSymbol}-${i}`}
                              className="flex items-center justify-between py-1.5 px-2 -mx-2 transition-colors duration-300 hover:bg-white/[0.02] cursor-pointer"
                              style={{
                                borderBottom: "1px solid rgba(201, 168, 76, 0.06)",
                              }}
                              onClick={() =>
                                openModal({
                                  type: "portfolio_position",
                                  symbol: pos.tokenSymbol,
                                  chain: pos.blockchain,
                                  balanceUsd: pos.balanceUsd,
                                  protocol: pos.protocol ?? undefined,
                                })
                              }
                            >
                              <div className="flex items-center gap-2">
                                <div className="relative w-7 h-7 shrink-0">
                                  {pos.thumbnail ? (
                                    <img
                                      src={pos.thumbnail}
                                      alt={pos.tokenSymbol}
                                      className="w-7 h-7 rounded-full"
                                      onError={e => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className="w-7 h-7 flex items-center justify-center text-xs font-[family-name:var(--font-cinzel)] font-semibold"
                                      style={{
                                        backgroundColor: "#111111",
                                        border: "1px solid rgba(201, 168, 76, 0.2)",
                                        color: "#C9A84C",
                                      }}
                                    >
                                      {pos.tokenSymbol.slice(0, 1)}
                                    </div>
                                  )}
                                  {CHAIN_ICONS[pos.blockchain] && (
                                    <img
                                      src={CHAIN_ICONS[pos.blockchain]}
                                      alt={pos.blockchain}
                                      className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                                      style={{ borderColor: "#111111" }}
                                    />
                                  )}
                                </div>
                                <div>
                                  <div className="text-xs" style={{ color: "#E8E4DC" }}>
                                    {pos.tokenSymbol}
                                  </div>
                                  <div className="text-[10px] capitalize" style={{ color: "#8A8578" }}>
                                    {pos.positionType}
                                    {pos.protocol ? ` · ${pos.protocol}` : ""}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div
                                  className="font-[family-name:var(--font-jetbrains)] text-xs"
                                  style={{ color: "#E8E4DC" }}
                                >
                                  {formatUsdValue(pos.balanceUsd)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* CENTER: Chat */}
              <div className="flex-1 min-w-0 flex flex-col">
                {/* Chat header with clear button */}
                {messages.length > 0 && (
                  <div className="flex justify-end pb-2">
                    <button
                      className="btn btn-ghost btn-xs transition-colors"
                      style={{ color: "#8A8578" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#9B3D3D")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#8A8578")}
                      onClick={() => {
                        setMessages([]);
                        if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
                      }}
                    >
                      Clear chat
                    </button>
                  </div>
                )}
                {/* Chat messages — scrollable */}
                <div className="flex-1 overflow-y-auto space-y-2 pb-4" ref={chatScrollRef}>
                  {messages.length === 0 && (
                    <div className="text-center mt-20">
                      <p className="text-lg" style={{ color: "#8A8578" }}>
                        Ask anything about your wallet
                      </p>
                      <p className="text-sm mt-2" style={{ color: "rgba(138, 133, 120, 0.6)" }}>
                        or say &quot;swap 0.1 ETH for USDC&quot; to make a move
                      </p>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[85%] px-3 py-1.5"
                        style={
                          msg.role === "user"
                            ? {
                                backgroundColor: "rgba(201, 168, 76, 0.15)",
                                border: "1px solid rgba(201, 168, 76, 0.2)",
                                color: "#E8E4DC",
                              }
                            : {
                                backgroundColor: "#111111",
                                border: "1px solid rgba(201, 168, 76, 0.08)",
                                color: "#E8E4DC",
                              }
                        }
                      >
                        {msg.role === "assistant" ? (
                          <ChatMessageRenderer content={msg.content} portfolio={portfolio} />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap leading-snug m-0">{msg.content}</p>
                        )}

                        {msg.transaction && (
                          <TransactionCard
                            tx={msg.transaction}
                            address={address!}
                            onTxHash={(hash: `0x${string}`) => {
                              setMessages(prev =>
                                prev.map((m, idx) =>
                                  idx === i && m.transaction
                                    ? { ...m, transaction: { ...m.transaction, txHash: hash } }
                                    : m,
                                ),
                              );
                            }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                  {isProcessing && (
                    <div className="flex justify-start">
                      <div
                        className="px-3 py-1.5"
                        style={{
                          backgroundColor: "#111111",
                          border: "1px solid rgba(201, 168, 76, 0.08)",
                        }}
                      >
                        <span className="loading loading-dots loading-sm" style={{ color: "#C9A84C" }}></span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input — sticky bottom */}
                <div className="sticky bottom-0 pb-4 pt-2" style={{ backgroundColor: "#0a0a0a" }}>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Your wealth awaits instruction. What is your will, ser?"
                      className="flex-1 text-base px-4 py-2"
                      style={{
                        backgroundColor: "#111111",
                        border: "1px solid rgba(201, 168, 76, 0.15)",
                        color: "#E8E4DC",
                        outline: "none",
                      }}
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !isProcessing && handleSubmit()}
                      disabled={isProcessing}
                    />
                    <button
                      className="px-6 py-2 transition-colors duration-300"
                      style={{
                        backgroundColor: "#C9A84C",
                        color: "#0a0a0a",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#B8963E")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#C9A84C")}
                      onClick={handleSubmit}
                      disabled={isProcessing || !message.trim()}
                    >
                      {isProcessing ? (
                        <span className="loading loading-spinner loading-sm"></span>
                      ) : (
                        <span className="font-[family-name:var(--font-cinzel)] text-sm">→</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT SIDEBAR: Activity */}
              <div className="w-full lg:w-80 shrink-0 overflow-y-auto">
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
