"use client";

import { useCallback, useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { useAccount, useConnectorClient, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
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
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
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
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [showAllAssets, setShowAllAssets] = useState(false);

  const { sendTransactionAsync } = useSendTransaction();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const { data: connectorClient } = useConnectorClient();

  // Fetch portfolio on wallet connect
  useEffect(() => {
    if (!address) {
      setPortfolio([]);
      setTotalBalanceUsd("0");
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
      // Execute first transaction (multi-tx support is a future step)
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

  const displayedAssets = showAllAssets ? portfolio : portfolio.slice(0, MAX_DISPLAY_ASSETS);
  const hiddenCount = portfolio.length - MAX_DISPLAY_ASSETS;

  return (
    <div className="flex items-center flex-col flex-grow pt-10">
      <div className="px-5 w-full max-w-2xl">
        <h1 className="text-center">
          <span className="block text-4xl font-bold">Talk to Your Wallet</span>
          <span className="block text-lg mt-2 text-base-content/70">
            Swap, bridge, send, wrap — just say what you want
          </span>
        </h1>

        {!isConnected ? (
          <div className="flex flex-col items-center mt-10 gap-4">
            <RainbowKitCustomConnectButton />
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            {/* Connected address */}
            <div className="flex justify-center">
              <div className="flex items-center gap-2">
                <span className="text-sm text-base-content/60">Connected:</span>
                <Address address={address} />
              </div>
            </div>

            {/* Portfolio */}
            <div className="bg-base-200 rounded-xl p-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-semibold text-base-content/60">Portfolio</span>
                {isLoadingPortfolio ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  <span className="text-lg font-bold">{formatUsdValue(totalBalanceUsd)}</span>
                )}
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
                        {/* Token icon with chain badge overlay */}
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

            {/* Chat input */}
            <div className="space-y-3">
              <input
                type="text"
                placeholder='Try: "swap 0.1 ETH to USDC" or "bridge 100 USDC to Base"'
                className="input input-bordered w-full text-lg"
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !isProcessing && handleSubmit()}
                disabled={isProcessing}
              />
              <button
                className="btn btn-primary w-full"
                onClick={handleSubmit}
                disabled={isProcessing || !message.trim()}
              >
                {isProcessing ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Building transaction...
                  </>
                ) : (
                  "Submit"
                )}
              </button>
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
                {/* AI message */}
                {intentResult.aiMessage && (
                  <div className="bg-base-200 rounded-xl p-4 text-sm">
                    <div className="text-base-content/60 text-xs mb-1">AI</div>
                    <div>{intentResult.aiMessage}</div>
                  </div>
                )}

                {/* Effects panel */}
                {intentResult.effects && (
                  <div className="bg-base-200 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-base-content/60">You send</span>
                      <span className="font-bold text-error">− {intentResult.effects.send}</span>
                    </div>
                    <div className="border-t border-base-300" />
                    <div className="flex justify-between items-center">
                      <span className="text-base-content/60">You receive</span>
                      <span className="font-bold text-success">+ {intentResult.effects.receive}</span>
                    </div>
                  </div>
                )}

                {/* Description */}
                {intentResult.description && (
                  <div className="text-center text-sm text-base-content/60">{intentResult.description}</div>
                )}

                {/* Execute button */}
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

                {/* Tx result */}
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
        )}
      </div>
    </div>
  );
};

export default Home;
