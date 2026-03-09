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
          content: "SOMETHING WENT WRONG. TRY AGAIN.",
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
    <div className="flex items-center flex-col flex-grow pt-2" style={{ backgroundColor: "#1a1a1a" }}>
      <div className="px-5 w-full max-w-7xl">
        {!isConnected ? (
          <div className="flex flex-col items-center mt-20 gap-6">
            <h1
              className="font-[family-name:var(--font-space-grotesk)] text-7xl sm:text-9xl font-bold uppercase leading-[0.85] tracking-tight text-center"
              style={{ color: "#FFFFFF" }}
            >
              DENARAI
            </h1>
            <div className="h-1" style={{ backgroundColor: "#FF4500", width: "120px" }} />
            <p
              className="font-[family-name:var(--font-space-grotesk)] text-sm uppercase tracking-[0.2em] font-bold"
              style={{ color: "#FF4500" }}
            >
              YOUR MONEY. DEFENDED.
            </p>
            <RainbowKitCustomConnectButton />
          </div>
        ) : (
          <div className="mt-2">
            <div className="flex flex-col lg:flex-row gap-4" style={{ height: "calc(100vh - 80px)" }}>
              {/* LEFT SIDEBAR: Portfolio */}
              <div className="w-full lg:w-72 shrink-0 space-y-0 overflow-y-auto">
                {/* Total portfolio block */}
                <div className="p-6 border-2" style={{ backgroundColor: "#0d0d0d", borderColor: "#FFFFFF" }}>
                  <p
                    className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase tracking-[0.15em] mb-4"
                    style={{ color: "#666666" }}
                  >
                    TOTAL PORTFOLIO VALUE
                  </p>
                  {isLoadingPortfolio ? (
                    <div className="flex items-center gap-2">
                      <span className="loading loading-spinner loading-sm"></span>
                      <span
                        className="font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase"
                        style={{ color: "#666666" }}
                      >
                        LOADING...
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-end gap-4">
                      <span className="font-[family-name:var(--font-ibm-plex-mono)] text-3xl font-bold uppercase">
                        {formatUsdValue(grandTotal)}
                      </span>
                      {changeUsd !== 0 && (
                        <span
                          className="font-[family-name:var(--font-ibm-plex-mono)] text-lg font-bold uppercase mb-0.5"
                          style={{ color: isChangeNegative ? "#FF4500" : "#00FF41" }}
                        >
                          {isChangeNegative ? "" : "+"}
                          {changePct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Wallet assets */}
                <div className="border-2 -mt-0.5" style={{ backgroundColor: "#0d0d0d", borderColor: "#FFFFFF" }}>
                  <div
                    className="flex items-center justify-between px-6 py-3"
                    style={{ borderBottom: "2px solid #FFFFFF" }}
                  >
                    <span
                      className="font-[family-name:var(--font-space-grotesk)] text-sm uppercase font-bold tracking-wider"
                      style={{ color: "#E8E8E8" }}
                    >
                      WALLET
                    </span>
                    <span className="font-[family-name:var(--font-ibm-plex-mono)] text-sm font-bold uppercase">
                      {formatUsdValue(walletTotal)}
                    </span>
                  </div>

                  {isLoadingPortfolio ? (
                    <div
                      className="text-center py-4 font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase"
                      style={{ color: "#666666" }}
                    >
                      LOADING ASSETS...
                    </div>
                  ) : portfolio.length === 0 ? (
                    <div
                      className="text-center py-4 font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase"
                      style={{ color: "#666666" }}
                    >
                      NO ASSETS FOUND
                    </div>
                  ) : (
                    <div>
                      {displayedAssets.map((asset, i) => (
                        <div
                          key={`${asset.blockchain}-${asset.contractAddress || "native"}-${i}`}
                          className="flex items-center justify-between px-6 py-2 transition-colors duration-150 hover:bg-white/5"
                          style={{
                            borderBottom: i < displayedAssets.length - 1 ? "1px solid #333333" : "none",
                          }}
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
                                        "w-7 h-7 flex items-center justify-center text-xs font-bold absolute inset-0 uppercase";
                                      fallback.style.backgroundColor = "#333333";
                                      fallback.style.color = "#FFFFFF";
                                      fallback.textContent = asset.tokenSymbol.slice(0, 2);
                                      parent.appendChild(fallback);
                                    }
                                  }}
                                />
                              ) : (
                                <div
                                  className="w-7 h-7 flex items-center justify-center text-xs font-bold uppercase"
                                  style={{ backgroundColor: "#333333", color: "#FFFFFF" }}
                                >
                                  {asset.tokenSymbol.slice(0, 2)}
                                </div>
                              )}
                              {CHAIN_ICONS[asset.blockchain] && (
                                <img
                                  src={CHAIN_ICONS[asset.blockchain]}
                                  alt={asset.blockchain}
                                  className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2"
                                  style={{ borderColor: "#0d0d0d" }}
                                />
                              )}
                            </div>
                            <div>
                              <div className="font-[family-name:var(--font-space-grotesk)] text-sm font-bold uppercase">
                                {asset.tokenSymbol}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-[family-name:var(--font-ibm-plex-mono)] text-sm font-bold uppercase">
                              {formatUsdValue(asset.balanceUsd)}
                            </div>
                          </div>
                        </div>
                      ))}

                      {!showAllAssets && hiddenCount > 0 && (
                        <button
                          className="w-full text-center font-[family-name:var(--font-ibm-plex-mono)] text-sm font-bold uppercase py-2 transition-colors duration-150"
                          style={{ color: "#FF4500" }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#FFFFFF")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#FF4500")}
                          onClick={() => setShowAllAssets(true)}
                        >
                          AND {hiddenCount} MORE...
                        </button>
                      )}
                      {showAllAssets && hiddenCount > 0 && (
                        <button
                          className="w-full text-center font-[family-name:var(--font-ibm-plex-mono)] text-sm font-bold uppercase py-2 transition-colors duration-150"
                          style={{ color: "#FF4500" }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#FFFFFF")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#FF4500")}
                          onClick={() => setShowAllAssets(false)}
                        >
                          SHOW LESS
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* PORTFOLIO (DeFi) section */}
                {defiPositions.length > 0 && (
                  <div className="border-2 -mt-0.5" style={{ backgroundColor: "#0d0d0d", borderColor: "#FFFFFF" }}>
                    <div
                      className="flex items-center justify-between px-6 py-3"
                      style={{ borderBottom: "2px solid #FFFFFF" }}
                    >
                      <span
                        className="font-[family-name:var(--font-space-grotesk)] text-sm uppercase font-bold tracking-wider"
                        style={{ color: "#E8E8E8" }}
                      >
                        PORTFOLIO
                      </span>
                      <span className="font-[family-name:var(--font-ibm-plex-mono)] text-sm font-bold uppercase">
                        {formatUsdValue(defiTotal)}
                      </span>
                    </div>
                    <div>
                      {defiPositions.map((pos, i) => (
                        <div
                          key={`defi-${pos.blockchain}-${pos.contractAddress || pos.tokenSymbol}-${i}`}
                          className="flex items-center justify-between px-6 py-2 transition-colors duration-150 hover:bg-white/5"
                          style={{
                            borderBottom: i < defiPositions.length - 1 ? "1px solid #333333" : "none",
                          }}
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
                                  className="w-7 h-7 flex items-center justify-center text-xs font-bold uppercase"
                                  style={{ backgroundColor: "#333333", color: "#FFFFFF" }}
                                >
                                  {pos.tokenSymbol.slice(0, 2)}
                                </div>
                              )}
                              {CHAIN_ICONS[pos.blockchain] && (
                                <img
                                  src={CHAIN_ICONS[pos.blockchain]}
                                  alt={pos.blockchain}
                                  className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                                  style={{ borderColor: "#0d0d0d" }}
                                />
                              )}
                            </div>
                            <div>
                              <div className="font-[family-name:var(--font-space-grotesk)] text-xs font-bold uppercase">
                                {pos.tokenSymbol}
                              </div>
                              <div
                                className="font-[family-name:var(--font-ibm-plex-mono)] text-[10px] uppercase"
                                style={{ color: "#666666" }}
                              >
                                {pos.positionType}
                                {pos.protocol ? ` · ${pos.protocol}` : ""}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-[family-name:var(--font-ibm-plex-mono)] text-xs font-bold uppercase">
                              {formatUsdValue(pos.balanceUsd)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* CENTER: Chat */}
              <div className="flex-1 min-w-0 flex flex-col">
                {/* Chat header with clear button */}
                {messages.length > 0 && (
                  <div className="flex justify-end pb-2">
                    <button
                      className="btn btn-ghost btn-xs font-bold uppercase transition-colors duration-150"
                      style={{ color: "#666666" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#FF4500")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#666666")}
                      onClick={() => {
                        setMessages([]);
                        if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
                      }}
                    >
                      CLEAR CHAT
                    </button>
                  </div>
                )}
                {/* Chat messages — scrollable */}
                <div className="flex-1 overflow-y-auto space-y-2 pb-4" ref={chatScrollRef}>
                  {messages.length === 0 && (
                    <div className="text-center mt-20">
                      <p
                        className="font-[family-name:var(--font-space-grotesk)] text-lg font-bold uppercase"
                        style={{ color: "#666666" }}
                      >
                        ASK ANYTHING ABOUT YOUR WALLET
                      </p>
                      <p
                        className="font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase mt-2"
                        style={{ color: "#333333" }}
                      >
                        OR SAY &quot;SWAP 0.1 ETH FOR USDC&quot; TO MAKE A MOVE
                      </p>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[85%] px-4 py-2 border-2"
                        style={
                          msg.role === "user"
                            ? {
                                backgroundColor: "#FF4500",
                                borderColor: "#FF4500",
                                color: "#000000",
                              }
                            : {
                                backgroundColor: "#0d0d0d",
                                borderColor: "#FFFFFF",
                                color: "#FFFFFF",
                              }
                        }
                      >
                        {msg.role === "assistant" ? (
                          <ChatMessageRenderer content={msg.content} portfolio={portfolio} />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap leading-snug m-0 font-[family-name:var(--font-ibm-plex-mono)] font-bold uppercase">
                            {msg.content}
                          </p>
                        )}

                        {msg.transaction && <TransactionCard tx={msg.transaction} address={address!} />}
                      </div>
                    </div>
                  ))}
                  {isProcessing && (
                    <div className="flex justify-start">
                      <div
                        className="px-4 py-2 border-2"
                        style={{ backgroundColor: "#0d0d0d", borderColor: "#FFFFFF" }}
                      >
                        <span className="loading loading-dots loading-sm"></span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input — sticky bottom */}
                <div className="sticky bottom-0 pb-4 pt-2" style={{ backgroundColor: "#1a1a1a" }}>
                  <div className="flex gap-0">
                    <input
                      type="text"
                      placeholder="ASK ABOUT YOUR WALLET, OR SAY WHAT YOU WANT TO DO..."
                      className="flex-1 text-base px-4 py-2 font-[family-name:var(--font-ibm-plex-mono)] font-bold uppercase border-2"
                      style={{
                        backgroundColor: "#0d0d0d",
                        borderColor: "#FFFFFF",
                        color: "#FFFFFF",
                        outline: "none",
                      }}
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !isProcessing && handleSubmit()}
                      disabled={isProcessing}
                    />
                    <button
                      className="px-6 py-2 border-2 -ml-0.5 font-bold uppercase transition-colors duration-150"
                      style={{
                        backgroundColor: "#FF4500",
                        color: "#000000",
                        borderColor: "#FF4500",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.backgroundColor = "#000000";
                        e.currentTarget.style.color = "#FF4500";
                        e.currentTarget.style.borderColor = "#FF4500";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.backgroundColor = "#FF4500";
                        e.currentTarget.style.color = "#000000";
                        e.currentTarget.style.borderColor = "#FF4500";
                      }}
                      onClick={handleSubmit}
                      disabled={isProcessing || !message.trim()}
                    >
                      {isProcessing ? (
                        <span className="loading loading-spinner loading-sm"></span>
                      ) : (
                        <span className="font-[family-name:var(--font-space-grotesk)] text-lg font-bold">→</span>
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
