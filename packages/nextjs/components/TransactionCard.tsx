"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AddressChip from "./AddressChip";
import AssetChip from "./AssetChip";
import ChatMessageRenderer from "./ChatMessageRenderer";
import NetworkChip from "./NetworkChip";
import { useChainId, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt, useWalletClient } from "wagmi";

interface SimulationChange {
  direction: "in" | "out";
  symbol: string;
  amount: string;
  chain?: string;
}

interface TransactionData {
  to: string;
  data: string;
  value: string;
  chainId: number;
  description: string;
  simulation?: {
    verified: boolean;
    changes: SimulationChange[];
  };
  // Deterministic re-build descriptor from the swap tool. When present the
  // card can re-price itself via /api/requote — fresh calldata + simulation
  // in ~2s, no agent turn.
  requote?: { tool: string; args: Record<string, unknown> };
  quote?: { amountOut?: string; amountOutMinimum?: string; slippagePct?: number };
  txHash?: `0x${string}`;
}

// Raw tool output shape returned by /api/requote (bridge runs the build tool directly)
type RequoteResult = {
  to?: string;
  data?: string;
  value?: string;
  quote?: TransactionData["quote"];
  requote?: TransactionData["requote"];
  simulation?: { success?: boolean; changes?: (SimulationChange & { direction: string })[] };
  error?: string;
};

interface ConfirmedTxInfo {
  txHash: string;
  chainId: number;
  type: "swap" | "bridge" | "send" | "wrap" | "other";
  outToken?: { symbol: string; amount: string };
  inToken?: { symbol: string; amount: string };
  isCrossChain?: boolean;
  toChainId?: number;
}

interface TransactionCardProps {
  tx: TransactionData;
  address: string;
  onTxHash?: (hash: `0x${string}`) => void;
  onConfirmed?: (info: ConfirmedTxInfo) => void;
}

const EXPLORER_URLS: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  137: "https://polygonscan.com/tx/",
  100: "https://gnosisscan.io/tx/",
  324: "https://explorer.zksync.io/tx/",
  534352: "https://scrollscan.com/tx/",
  59144: "https://lineascan.build/tx/",
  5000: "https://explorer.mantle.xyz/tx/",
};

const CHAIN_NAMES: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon",
  100: "xdai",
  324: "zksync-era",
  534352: "scroll",
  59144: "linea",
  5000: "mantle",
};

const TransactionCard = ({ tx, address, onTxHash, onConfirmed }: TransactionCardProps) => {
  const [showModal, setShowModal] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(tx.txHash);
  const [execError, setExecError] = useState("");

  // The mutable half of the transaction: a requote replaces calldata, amounts
  // and simulation while the card keeps its identity (description, chain).
  const [live, setLive] = useState<TransactionData>(tx);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quotedAt, setQuotedAt] = useState(() => Date.now());
  const [quoteAge, setQuoteAge] = useState(0);
  const [refreshError, setRefreshError] = useState("");
  const mountedAtRef = useRef(Date.now());

  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const currentChainId = useChainId();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const explorerBase = EXPLORER_URLS[tx.chainId] || "https://etherscan.io/tx/";
  const chainName = CHAIN_NAMES[tx.chainId];

  // Fire onConfirmed when tx is confirmed
  const confirmedFiredRef = useRef(false);
  useEffect(() => {
    if (isTxConfirmed && txHash && onConfirmed && !confirmedFiredRef.current) {
      confirmedFiredRef.current = true;
      const outChanges = live.simulation?.changes?.filter(c => c.direction === "out") || [];
      const inChanges = live.simulation?.changes?.filter(c => c.direction === "in") || [];
      // Derive type from simulation
      let txType: "swap" | "bridge" | "send" | "wrap" | "other" = "other";
      if (outChanges.length > 0 && inChanges.length > 0) txType = "swap";
      else if (outChanges.length > 0) txType = "send";
      onConfirmed({
        txHash,
        chainId: tx.chainId,
        type: txType,
        outToken: outChanges[0] ? { symbol: outChanges[0].symbol, amount: outChanges[0].amount } : undefined,
        inToken: inChanges[0] ? { symbol: inChanges[0].symbol, amount: inChanges[0].amount } : undefined,
      });
    }
  }, [isTxConfirmed, txHash, onConfirmed, live.simulation, tx.chainId]);

  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile || window.ethereum) return;

    const search = [localStorage.getItem("wagmi.recentConnectorId")].filter(Boolean).join(" ").toLowerCase();

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
  }, []);

  const handleExecute = async () => {
    setIsExecuting(true);
    setExecError("");

    try {
      if (tx.chainId && currentChainId !== tx.chainId) {
        try {
          await switchChainAsync({ chainId: tx.chainId });
        } catch {
          setExecError(`Please switch your wallet to ${chainName || `chain ${tx.chainId}`} and try again.`);
          setIsExecuting(false);
          return;
        }
      }

      const promise = sendTransactionAsync({
        to: live.to as `0x${string}`,
        data: (live.data && live.data !== "0x" ? live.data : undefined) as `0x${string}` | undefined,
        value: BigInt(live.value || "0"),
        chainId: tx.chainId,
      });
      setTimeout(openWallet, 2000);
      const hash = await promise;
      setTxHash(hash);
      onTxHash?.(hash);
      setShowModal(false);
    } catch (e: unknown) {
      setExecError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setIsExecuting(false);
    }
  };

  const refreshQuote = useCallback(async () => {
    if (!live.requote || isRefreshing || isExecuting || txHash) return;
    setIsRefreshing(true);
    setRefreshError("");
    try {
      const res = await fetch("/api/requote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requote: live.requote }),
      });
      const fresh: RequoteResult = await res.json();
      if (!res.ok || fresh.error || !fresh.data) throw new Error(fresh.error || "requote failed");
      setLive(prev => ({
        ...prev,
        to: fresh.to ?? prev.to,
        data: fresh.data!,
        value: fresh.value ?? prev.value,
        quote: fresh.quote ?? prev.quote,
        requote: fresh.requote ?? prev.requote,
        simulation: fresh.simulation
          ? {
              verified: !!fresh.simulation.success,
              changes: (fresh.simulation.changes || []).filter(
                (c): c is SimulationChange => c.direction === "in" || c.direction === "out",
              ),
            }
          : prev.simulation,
      }));
      setQuotedAt(Date.now());
      setQuoteAge(0);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : "Could not refresh the price");
    } finally {
      setIsRefreshing(false);
    }
  }, [live.requote, isRefreshing, isExecuting, txHash]);

  const canRequote = !!live.requote && !txHash;

  // Tick the quote's age every second; auto-requote every 30s so the price
  // moves with the market while the card sits unsigned. Auto stops when the
  // tab is hidden, a tx is in flight, or the card is >15 min old (the manual
  // ↻ button keeps working).
  useEffect(() => {
    if (!canRequote) return;
    const t = setInterval(() => {
      const age = Math.round((Date.now() - quotedAt) / 1000);
      setQuoteAge(age);
      if (
        age >= 30 &&
        !isRefreshing &&
        !isExecuting &&
        !refreshError &&
        document.visibilityState === "visible" &&
        Date.now() - mountedAtRef.current < 15 * 60_000
      ) {
        refreshQuote();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [canRequote, quotedAt, isRefreshing, isExecuting, refreshError, refreshQuote]);

  const outChanges = live.simulation?.changes?.filter(c => c.direction === "out") || [];
  const inChanges = live.simulation?.changes?.filter(c => c.direction === "in") || [];

  return (
    <>
      {/* Inline card within the chat bubble */}
      <div
        className="mt-3 p-4 space-y-2"
        style={{
          backgroundColor: "#111111",
          border: "1px solid rgba(201, 168, 76, 0.15)",
        }}
      >
        {/* Simulation preview */}
        {live.simulation && live.simulation.changes.length > 0 && (
          <div className="space-y-2 text-sm">
            {outChanges.map((c, i) => (
              <div key={`out-${i}`} className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "#8A8578" }}>
                  You send
                </span>
                <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
              </div>
            ))}
            {outChanges.length > 0 && inChanges.length > 0 && (
              <div className="h-px" style={{ backgroundColor: "rgba(201, 168, 76, 0.08)" }} />
            )}
            {inChanges.map((c, i) => (
              <div key={`in-${i}`} className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "#8A8578" }}>
                  You receive
                </span>
                <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        {tx.description && (
          <div className="text-xs" style={{ color: "#8A8578" }}>
            <ChatMessageRenderer content={tx.description} />
          </div>
        )}

        {/* Tx confirmed inline */}
        {txHash && isTxConfirmed && (
          <div className="text-sm flex items-center gap-1" style={{ color: "#C9A84C" }}>
            ✓ Confirmed —{" "}
            <a
              href={`${explorerBase}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "#C9A84C" }}
            >
              view tx
            </a>
          </div>
        )}

        {txHash && isTxConfirming && !isTxConfirmed && (
          <div className="text-sm flex items-center gap-2" style={{ color: "#8A8578" }}>
            <span className="loading loading-spinner loading-xs"></span>
            Confirming...
          </div>
        )}

        {/* Live-quote freshness + manual refresh */}
        {canRequote && (
          <div className="flex items-center justify-between text-xs" style={{ color: "#8A8578" }}>
            <span className="font-[family-name:var(--font-jetbrains)]">
              {isRefreshing
                ? "Refreshing price…"
                : refreshError
                  ? "Price refresh failed — tap ↻ to retry"
                  : `Live quote · updated ${quoteAge < 3 ? "just now" : `${quoteAge}s ago`}`}
            </span>
            <button
              className="btn btn-ghost btn-xs px-2"
              style={{ color: "#C9A84C" }}
              onClick={refreshQuote}
              disabled={isRefreshing}
              title="Refresh price"
              aria-label="Refresh price"
            >
              {isRefreshing ? <span className="loading loading-spinner loading-xs"></span> : "↻"}
            </button>
          </div>
        )}

        {/* Execute button */}
        {!txHash && (
          <button className="btn btn-sm w-full gold-btn" style={{}} onClick={() => setShowModal(true)}>
            <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase">Execute</span>
          </button>
        )}
      </div>

      {/* Confirmation modal */}
      {showModal && (
        <dialog className="modal modal-open" onClick={() => !isExecuting && setShowModal(false)}>
          <div
            className="modal-box"
            style={{
              backgroundColor: "#111111",
              border: "1px solid rgba(201, 168, 76, 0.15)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3
              className="font-[family-name:var(--font-cinzel)] text-sm tracking-[0.15em] uppercase mb-6"
              style={{ color: "#C9A84C" }}
            >
              Confirm Transaction
            </h3>

            {/* Full simulation details */}
            {live.simulation && live.simulation.changes.length > 0 && (
              <div
                className="p-4 space-y-3 mb-4"
                style={{
                  backgroundColor: "#0a0a0a",
                  border: "1px solid rgba(201, 168, 76, 0.08)",
                }}
              >
                {outChanges.map((c, i) => (
                  <div key={`modal-out-${i}`} className="flex justify-between items-center">
                    <span className="text-sm" style={{ color: "#8A8578" }}>
                      You send
                    </span>
                    <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
                  </div>
                ))}
                {outChanges.length > 0 && inChanges.length > 0 && (
                  <div className="h-px" style={{ backgroundColor: "rgba(201, 168, 76, 0.08)" }} />
                )}
                {inChanges.map((c, i) => (
                  <div key={`modal-in-${i}`} className="flex justify-between items-center">
                    <span className="text-sm" style={{ color: "#8A8578" }}>
                      You receive
                    </span>
                    <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
                  </div>
                ))}
                {live.simulation.verified && (
                  <div className="text-xs text-center mt-1" style={{ color: "rgba(201, 168, 76, 0.6)" }}>
                    ✓ Simulation verified onchain
                  </div>
                )}
              </div>
            )}

            {/* Tx details */}
            <div
              className="p-4 space-y-3 text-sm mb-4"
              style={{
                backgroundColor: "#0a0a0a",
                border: "1px solid rgba(201, 168, 76, 0.08)",
              }}
            >
              <div className="flex justify-between items-center">
                <span style={{ color: "#8A8578" }}>From</span>
                <AddressChip address={address} />
              </div>
              {!tx.data || tx.data === "0x" ? (
                <div className="flex justify-between items-center">
                  <span style={{ color: "#8A8578" }}>To</span>
                  <AddressChip address={tx.to} />
                </div>
              ) : outChanges.length > 0 ? (
                <div className="flex justify-between items-center">
                  <span style={{ color: "#8A8578" }}>Contract</span>
                  <AssetChip symbol={outChanges[0].symbol} chain={outChanges[0].chain || chainName} />
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <span style={{ color: "#8A8578" }}>To</span>
                  <AddressChip address={tx.to} />
                </div>
              )}
              <div className="flex justify-between items-center">
                <span style={{ color: "#8A8578" }}>Network</span>
                {chainName ? (
                  <NetworkChip chain={chainName} />
                ) : (
                  <span className="font-[family-name:var(--font-jetbrains)] text-xs">Chain {tx.chainId}</span>
                )}
              </div>
              {tx.description && (
                <div
                  className="text-xs pt-2"
                  style={{ color: "#8A8578", borderTop: "1px solid rgba(201, 168, 76, 0.08)" }}
                >
                  <ChatMessageRenderer content={tx.description} />
                </div>
              )}
            </div>

            {execError && (
              <div
                className="mb-4 p-3 text-sm"
                style={{
                  backgroundColor: "rgba(155, 61, 61, 0.1)",
                  border: "1px solid rgba(155, 61, 61, 0.3)",
                  color: "#9B3D3D",
                }}
              >
                <span>{execError}</span>
              </div>
            )}

            {tx.chainId && currentChainId !== tx.chainId ? (
              <div className="space-y-3">
                <button
                  className="btn btn-sm w-full gold-btn"
                  style={{}}
                  onClick={async () => {
                    setExecError("");
                    try {
                      await switchChainAsync({ chainId: tx.chainId! });
                    } catch {
                      // Fallback: wallet_addEthereumChain works even if chain isn't pre-configured
                      try {
                        const chainHex = `0x${tx.chainId!.toString(16)}`;
                        const explorerUrl = EXPLORER_URLS[tx.chainId!]?.replace("/tx/", "") || undefined;
                        await walletClient?.request({
                          method: "wallet_addEthereumChain",
                          params: [
                            {
                              chainId: chainHex,
                              chainName: chainName || `Chain ${tx.chainId}`,
                              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                              rpcUrls: [
                                tx.chainId === 8453
                                  ? "https://mainnet.base.org"
                                  : tx.chainId === 42161
                                    ? "https://arb1.arbitrum.io/rpc"
                                    : tx.chainId === 10
                                      ? "https://mainnet.optimism.io"
                                      : tx.chainId === 137
                                        ? "https://polygon-rpc.com"
                                        : "https://cloudflare-eth.com",
                              ],
                              blockExplorerUrls: explorerUrl ? [explorerUrl] : [],
                            },
                          ],
                        });
                      } catch {
                        setExecError(
                          `Could not switch to ${chainName || `chain ${tx.chainId}`}. Please switch manually in your wallet.`,
                        );
                      }
                    }
                  }}
                >
                  <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase">
                    Switch to {chainName || `Chain ${tx.chainId}`}
                  </span>
                </button>
                <div className="flex justify-end">
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: "#8A8578" }}
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-3">
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: "#8A8578" }}
                  onClick={() => setShowModal(false)}
                  disabled={isExecuting}
                >
                  Cancel
                </button>
                <button className="btn btn-sm gold-btn" style={{}} onClick={handleExecute} disabled={isExecuting}>
                  {isExecuting ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Sending...
                    </>
                  ) : (
                    <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase">
                      Confirm &amp; Send
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        </dialog>
      )}
    </>
  );
};

export default TransactionCard;
