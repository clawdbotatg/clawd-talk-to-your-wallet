"use client";

import { useEffect, useRef, useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import ActivityPanel from "~~/components/ActivityPanel";
import ChatMessageRenderer from "~~/components/ChatMessageRenderer";
import NetworkChip from "~~/components/NetworkChip";
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

// formatBalance removed — balance shown via NetworkChip subtitle instead

const MAX_DISPLAY_ASSETS = 8;

// ─── Component ───────────────────────────────────────────────────────────────

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Chat persistence — load from localStorage keyed by address
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
  const [totalBalanceUsd, setTotalBalanceUsd] = useState("0");
  const [totalPortfolioUsd, setTotalPortfolioUsd] = useState("0");
  const [change1dUsd, setChange1dUsd] = useState("0");
  const [change1dPct, setChange1dPct] = useState("0");
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [showAllAssets, setShowAllAssets] = useState(false);

  // Activity state (lifted from ActivityPanel for AI context)
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  // Chat scroll ref
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (!STORAGE_KEY || messages.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // quota exceeded — trim oldest messages
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

  // Auto-scroll on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

  // Fetch portfolio + activity on wallet connect
  useEffect(() => {
    if (!address) {
      setPortfolio([]);
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
    // Stagger activity fetch to avoid concurrent Zerion calls
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
          recentActivity: activity.slice(0, 20),
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
    <div className="flex items-center flex-col flex-grow pt-2">
      <div className="px-5 w-full max-w-7xl">
        {!isConnected ? (
          <div className="flex flex-col items-center mt-10 gap-4">
            <RainbowKitCustomConnectButton />
          </div>
        ) : (
          <div className="mt-2">
            <div className="flex flex-col lg:flex-row gap-4" style={{ height: "calc(100vh - 80px)" }}>
              {/* LEFT SIDEBAR: Portfolio */}
              <div className="w-full lg:w-72 shrink-0 space-y-4 overflow-y-auto">
                <div className="bg-base-200 rounded-xl p-4 space-y-4">
                  {/* Total + daily change header */}
                  <div>
                    {isLoadingPortfolio ? (
                      <div className="flex items-center gap-2">
                        <span className="loading loading-spinner loading-sm"></span>
                        <span className="text-sm text-base-content/50">Loading...</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-2xl font-bold">{formatUsdValue(grandTotal)}</span>
                        {changeUsd !== 0 && (
                          <span className={`text-sm font-medium ${isChangeNegative ? "text-error" : "text-success"}`}>
                            {isChangeNegative ? "▼" : "▲"} $
                            {Math.abs(changeUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })} (
                            {isChangeNegative ? "" : "+"}
                            {changePct.toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* WALLET section */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
                        Wallet
                      </span>
                      <span className="text-sm font-semibold text-base-content/70">{formatUsdValue(walletTotal)}</span>
                    </div>

                    {isLoadingPortfolio ? (
                      <div className="text-center py-4 text-base-content/50">Loading assets...</div>
                    ) : portfolio.length === 0 ? (
                      <div className="text-center py-4 text-base-content/50">No assets found</div>
                    ) : (
                      <div className="space-y-1">
                        {displayedAssets.map((asset, i) => (
                          <div
                            key={`${asset.blockchain}-${asset.contractAddress || "native"}-${i}`}
                            className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-base-300/50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="relative w-8 h-8 shrink-0">
                                {asset.thumbnail ? (
                                  <img
                                    src={asset.thumbnail}
                                    alt={asset.tokenSymbol}
                                    className="w-8 h-8 rounded-full"
                                    onError={e => {
                                      (e.target as HTMLImageElement).src = "";
                                      (e.target as HTMLImageElement).style.display = "none";
                                      const parent = (e.target as HTMLImageElement).parentElement;
                                      if (parent) {
                                        const fallback = document.createElement("div");
                                        fallback.className =
                                          "w-8 h-8 rounded-full bg-base-300 flex items-center justify-center text-xs font-bold absolute inset-0";
                                        fallback.textContent = asset.tokenSymbol.slice(0, 2);
                                        parent.appendChild(fallback);
                                      }
                                    }}
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-base-300 flex items-center justify-center text-xs font-bold">
                                    {asset.tokenSymbol.slice(0, 2)}
                                  </div>
                                )}
                                {CHAIN_ICONS[asset.blockchain] && (
                                  <img
                                    src={CHAIN_ICONS[asset.blockchain]}
                                    alt={asset.blockchain}
                                    className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-base-200"
                                  />
                                )}
                              </div>
                              <div>
                                <div className="font-medium text-sm">{asset.tokenSymbol}</div>
                                <div className="mt-0.5">
                                  <NetworkChip chain={asset.blockchain} />
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-medium">{formatUsdValue(asset.balanceUsd)}</div>
                            </div>
                          </div>
                        ))}

                        {!showAllAssets && hiddenCount > 0 && (
                          <button
                            className="w-full text-center text-sm text-primary hover:underline py-2"
                            onClick={() => setShowAllAssets(true)}
                          >
                            and {hiddenCount} more...
                          </button>
                        )}
                        {showAllAssets && hiddenCount > 0 && (
                          <button
                            className="w-full text-center text-sm text-primary hover:underline py-2"
                            onClick={() => setShowAllAssets(false)}
                          >
                            Show less
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* PORTFOLIO (DeFi) section — only shown when Zerion returns DeFi positions */}
                  {defiTotal >= 1 && (
                    <>
                      <div className="border-t border-base-300" />
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
                            Portfolio
                          </span>
                          <span className="text-sm font-semibold text-base-content/70">
                            {formatUsdValue(defiTotal)}
                          </span>
                        </div>
                        <div className="text-sm text-base-content/60 py-1">DeFi positions loaded</div>
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
                      className="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
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
                    <div className="text-center text-base-content/40 mt-20">
                      <p className="text-lg">Ask anything about your wallet</p>
                      <p className="text-sm mt-2">or say &quot;swap 0.1 ETH for USDC&quot; to make a move</p>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-content rounded-br-sm"
                            : "bg-base-200 text-base-content rounded-bl-sm"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <ChatMessageRenderer content={msg.content} portfolio={portfolio} />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap leading-snug m-0">{msg.content}</p>
                        )}

                        {/* Transaction card — only shown when msg has a transaction */}
                        {msg.transaction && <TransactionCard tx={msg.transaction} address={address!} />}
                      </div>
                    </div>
                  ))}
                  {isProcessing && (
                    <div className="flex justify-start">
                      <div className="bg-base-200 rounded-2xl rounded-bl-sm px-3 py-1.5">
                        <span className="loading loading-dots loading-sm"></span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input — sticky bottom */}
                <div className="sticky bottom-0 pb-4 pt-2 bg-base-100">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ask about your wallet, or say what you want to do..."
                      className="input input-bordered flex-1 text-base"
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !isProcessing && handleSubmit()}
                      disabled={isProcessing}
                    />
                    <button
                      className="btn btn-primary px-6"
                      onClick={handleSubmit}
                      disabled={isProcessing || !message.trim()}
                    >
                      {isProcessing ? <span className="loading loading-spinner loading-sm"></span> : "→"}
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
