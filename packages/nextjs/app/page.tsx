"use client";

import { useCallback, useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { useAccount, useConnectorClient, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import ActivityPanel from "~~/components/ActivityPanel";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

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

interface IntentTransaction {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

interface SimulatedChange {
  type: string;
  symbol: string;
  amount: string;
  logo: string;
  direction: "in" | "out";
}

interface SimulationResult {
  safe: boolean;
  explanation: string;
  warnings: string[];
  changes: SimulatedChange[];
}

interface IntentResult {
  transactions: IntentTransaction[];
  description: string;
  effects: { send: string; receive: string };
  aiMessage?: string;
  error?: string;
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

const formatUsdValue = (value: string | number): string => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num < 0.01) return "<$0.01";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
};

const formatBalance = (balance: string): string => {
  const num = parseFloat(balance);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const MAX_DISPLAY_ASSETS = 8;

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  // Portfolio state
  const [portfolio, setPortfolio] = useState<PortfolioAsset[]>([]);
  const [totalBalanceUsd, setTotalBalanceUsd] = useState("0");
  const [totalPortfolioUsd, setTotalPortfolioUsd] = useState("0");
  const [change1dUsd, setChange1dUsd] = useState("0");
  const [change1dPct, setChange1dPct] = useState("0");
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const { sendTransactionAsync } = useSendTransaction();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const { data: connectorClient } = useConnectorClient();

  // Fetch portfolio on wallet connect
  useEffect(() => {
    if (!address) {
      setPortfolio([]);
      setTotalBalanceUsd("0");
      setTotalPortfolioUsd("0");
      setChange1dUsd("0");
      setChange1dPct("0");
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

    fetchPortfolio();
  }, [address]);

  // Mobile deep linking
  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile || window.ethereum) return;

    const connector = connectorClient?.transport;
    const allIds = [connector?.name, localStorage.getItem("wagmi.recentConnectorId")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    let wcWallet = "";
    try {
      const wcKey = Object.keys(localStorage).find(k => k.startsWith("wc@2:client"));
      if (wcKey) wcWallet = (localStorage.getItem(wcKey) || "").toLowerCase();
    } catch {
      /* ignore */
    }
    const search = `${allIds} ${wcWallet}`;

    const schemes: [string[], string][] = [
      [["rainbow"], "rainbow://"],
      [["metamask"], "metamask://"],
      [["coinbase", "cbwallet"], "cbwallet://"],
      [["trust"], "trust://"],
      [["phantom"], "phantom://"],
    ];

    for (const [keywords, scheme] of schemes) {
      if (keywords.some(k => search.includes(k))) {
        window.location.href = scheme;
        return;
      }
    }
  }, [connectorClient]);

  const writeAndOpen = useCallback(
    <T,>(writeFn: () => Promise<T>): Promise<T> => {
      const promise = writeFn();
      setTimeout(openWallet, 2000);
      return promise;
    },
    [openWallet],
  );

  const handleSubmit = async () => {
    if (!message.trim() || !address) return;
    setIsProcessing(true);
    setError("");
    setIntentResult(null);
    setTxHash(undefined);

    try {
      const intentRes = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, address, portfolio }),
      });
      const intent = await intentRes.json();
      if (intent.error) {
        setError(intent.error);
        setIsProcessing(false);
        return;
      }
      setIntentResult(intent);
      // Run simulation in background after intent resolves
      if (intent.transactions?.length && address) {
        setSimulation(null);
        setIsSimulating(true);
        try {
          const tx = intent.transactions[0];
          const simRes = await fetch("/api/security", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ calldata: tx, address, chainId: tx.chainId || 1 }),
          });
          const simData = await simRes.json();
          setSimulation(simData);
        } catch {
          // simulation failure is non-blocking
        } finally {
          setIsSimulating(false);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecute = async () => {
    if (!intentResult?.transactions?.length) return;
    setIsExecuting(true);
    setError("");

    try {
      const tx = intentResult.transactions[0];
      const hash = await writeAndOpen(() =>
        sendTransactionAsync({
          to: tx.to as `0x${string}`,
          data: (tx.data && tx.data !== "0x" ? tx.data : undefined) as `0x${string}` | undefined,
          value: BigInt(tx.value || "0"),
        }),
      );
      setTxHash(hash);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setIsExecuting(false);
    }
  };

  // Computed: grand total = wallet + defi
  const walletTotal = parseFloat(totalBalanceUsd) || 0;
  const defiTotal = parseFloat(totalPortfolioUsd) || 0;
  const grandTotal = walletTotal + defiTotal;
  const changeUsd = parseFloat(change1dUsd) || 0;
  const changePct = parseFloat(change1dPct) || 0;
  const isChangeNegative = changeUsd < 0;

  const displayedAssets = showAllAssets ? portfolio : portfolio.slice(0, MAX_DISPLAY_ASSETS);
  const hiddenCount = portfolio.length - MAX_DISPLAY_ASSETS;

  return (
    <div className="flex items-center flex-col flex-grow pt-10">
      <div className="px-5 w-full max-w-7xl">
        {!isConnected ? (
          <div className="flex flex-col items-center mt-10 gap-4">
            <RainbowKitCustomConnectButton />
          </div>
        ) : (
          <div className="mt-8">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* LEFT SIDEBAR: Portfolio */}
              <div className="w-full lg:w-72 shrink-0 space-y-4">
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
                            className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-base-300/50 transition-colors"
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
                                <div className="text-xs text-base-content/50">{formatBalance(asset.balance)}</div>
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

                  {/* Divider */}
                  <div className="border-t border-base-300" />

                  {/* PORTFOLIO (DeFi) section */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
                        Portfolio
                      </span>
                      <span className="text-sm font-semibold text-base-content/70">{formatUsdValue(defiTotal)}</span>
                    </div>
                    {defiTotal < 1 ? (
                      <div className="text-sm text-base-content/40 py-2">No DeFi positions</div>
                    ) : (
                      <div className="text-sm text-base-content/60 py-2">DeFi positions loaded</div>
                    )}
                  </div>
                </div>
              </div>

              {/* CENTER: Chat + Intent */}
              <div className="flex-1 min-w-0 space-y-4">
                {/* Connected address indicator */}
                <div className="flex justify-center">
                  <div className="text-sm text-base-content/60">
                    <Address address={address} />
                  </div>
                </div>

                {/* Chat input — pinned to bottom */}
                <div className="sticky bottom-4 mt-auto">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Swap, bridge, send — just say what you want"
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

                {/* Error */}
                {error && (
                  <div className="alert alert-error">
                    <span>{error}</span>
                  </div>
                )}

                {/* Intent result */}
                {intentResult && intentResult.transactions && (
                  <div className="space-y-4">
                    {intentResult.aiMessage && (
                      <div className="bg-base-200 rounded-xl p-4 text-sm">
                        <div className="text-base-content/60 text-xs mb-1">AI</div>
                        <div>{intentResult.aiMessage}</div>
                      </div>
                    )}

                    {/* Simulation results */}
                    {isSimulating && (
                      <div className="bg-base-200 rounded-xl p-4 flex items-center gap-2 text-sm text-base-content/60">
                        <span className="loading loading-spinner loading-xs"></span>
                        Simulating transaction...
                      </div>
                    )}

                    {simulation && !isSimulating && (
                      <div
                        className={`rounded-xl p-4 space-y-2 text-sm ${simulation.safe ? "bg-base-200" : "bg-error/10 border border-error/30"}`}
                      >
                        {!simulation.safe && simulation.warnings.length > 0 && (
                          <div className="text-error font-medium text-xs mb-2">⚠️ {simulation.warnings[0]}</div>
                        )}
                        {simulation.changes
                          .filter(c => c.direction === "out")
                          .map((c, i) => (
                            <div key={i} className="flex justify-between items-center">
                              <span className="text-base-content/60">You send</span>
                              <span className="font-bold text-error">
                                − {c.amount} {c.symbol}
                              </span>
                            </div>
                          ))}
                        {simulation.changes.length > 0 && <div className="border-t border-base-300" />}
                        {simulation.changes
                          .filter(c => c.direction === "in")
                          .map((c, i) => (
                            <div key={i} className="flex justify-between items-center">
                              <span className="text-base-content/60">You receive</span>
                              <span className="font-bold text-success">
                                + {c.amount} {c.symbol}
                              </span>
                            </div>
                          ))}
                        {simulation.changes.length === 0 && (
                          <div className="text-base-content/50 text-center py-1">{simulation.explanation}</div>
                        )}
                      </div>
                    )}

                    {intentResult.description && (
                      <div className="text-center text-sm text-base-content/60">{intentResult.description}</div>
                    )}

                    {!txHash && (
                      <button className="btn btn-success w-full text-lg" onClick={handleExecute} disabled={isExecuting}>
                        {isExecuting ? (
                          <>
                            <span className="loading loading-spinner loading-sm"></span>
                            Sending Transaction...
                          </>
                        ) : (
                          `Execute Transaction`
                        )}
                      </button>
                    )}

                    {txHash && (
                      <div className="alert alert-info">
                        {isTxConfirming && (
                          <div className="flex items-center gap-2">
                            <span className="loading loading-spinner loading-sm"></span>
                            Waiting for confirmation...
                          </div>
                        )}
                        {isTxConfirmed && <div>✅ Transaction confirmed!</div>}
                        <div className="mt-2">
                          <a
                            href={`https://etherscan.io/tx/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link"
                          >
                            View on Etherscan →
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* RIGHT SIDEBAR: Activity */}
              <div className="w-full lg:w-80 shrink-0">
                <ActivityPanel address={address!} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
