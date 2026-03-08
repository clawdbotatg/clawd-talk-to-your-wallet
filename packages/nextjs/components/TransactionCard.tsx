"use client";

import { useCallback, useState } from "react";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";

interface SimulationChange {
  direction: "in" | "out";
  symbol: string;
  amount: string;
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
}

interface TransactionCardProps {
  tx: TransactionData;
  address: string;
}

const EXPLORER_URLS: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  137: "https://polygonscan.com/tx/",
};

const TransactionCard = ({ tx }: TransactionCardProps) => {
  const [showModal, setShowModal] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [execError, setExecError] = useState("");

  const { sendTransactionAsync } = useSendTransaction();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const explorerBase = EXPLORER_URLS[tx.chainId] || "https://etherscan.io/tx/";

  // Mobile deep-link to wallet
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
      const promise = sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: (tx.data && tx.data !== "0x" ? tx.data : undefined) as `0x${string}` | undefined,
        value: BigInt(tx.value || "0"),
      });
      setTimeout(openWallet, 2000);
      const hash = await promise;
      setTxHash(hash);
    } catch (e: unknown) {
      setExecError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setIsExecuting(false);
    }
  };

  const outChanges = tx.simulation?.changes?.filter(c => c.direction === "out") || [];
  const inChanges = tx.simulation?.changes?.filter(c => c.direction === "in") || [];

  return (
    <>
      {/* Inline card within the chat bubble */}
      <div className="mt-3 bg-base-300/50 rounded-xl p-3 space-y-2">
        {/* Simulation preview */}
        {tx.simulation && tx.simulation.changes.length > 0 && (
          <div className="space-y-1 text-sm">
            {outChanges.map((c, i) => (
              <div key={`out-${i}`} className="flex justify-between">
                <span className="text-base-content/60">Send</span>
                <span className="font-semibold text-error">
                  − {c.amount} {c.symbol}
                </span>
              </div>
            ))}
            {outChanges.length > 0 && inChanges.length > 0 && <div className="border-t border-base-content/10" />}
            {inChanges.map((c, i) => (
              <div key={`in-${i}`} className="flex justify-between">
                <span className="text-base-content/60">Receive</span>
                <span className="font-semibold text-success">
                  + {c.amount} {c.symbol}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        {tx.description && <p className="text-xs text-base-content/50">{tx.description}</p>}

        {/* Tx confirmed inline */}
        {txHash && isTxConfirmed && (
          <div className="text-sm text-success flex items-center gap-1">
            ✅ Confirmed —{" "}
            <a
              href={`${explorerBase}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="link link-primary"
            >
              view tx
            </a>
          </div>
        )}

        {txHash && isTxConfirming && !isTxConfirmed && (
          <div className="text-sm text-base-content/60 flex items-center gap-2">
            <span className="loading loading-spinner loading-xs"></span>
            Confirming...
          </div>
        )}

        {/* Execute button — opens confirmation modal */}
        {!txHash && (
          <button className="btn btn-success btn-sm w-full" onClick={() => setShowModal(true)}>
            Execute
          </button>
        )}
      </div>

      {/* Confirmation modal */}
      {showModal && (
        <dialog className="modal modal-open" onClick={() => !isExecuting && setShowModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">Confirm Transaction</h3>

            {/* Full simulation details */}
            {tx.simulation && tx.simulation.changes.length > 0 && (
              <div className="bg-base-200 rounded-xl p-4 space-y-2 mb-4">
                {outChanges.map((c, i) => (
                  <div key={`modal-out-${i}`} className="flex justify-between items-center">
                    <span className="text-base-content/60">You send</span>
                    <span className="font-bold text-error">
                      − {c.amount} {c.symbol}
                    </span>
                  </div>
                ))}
                {outChanges.length > 0 && inChanges.length > 0 && <div className="border-t border-base-300" />}
                {inChanges.map((c, i) => (
                  <div key={`modal-in-${i}`} className="flex justify-between items-center">
                    <span className="text-base-content/60">You receive</span>
                    <span className="font-bold text-success">
                      + {c.amount} {c.symbol}
                    </span>
                  </div>
                ))}
                {tx.simulation.verified && (
                  <div className="text-xs text-success/70 text-center mt-1">✓ Simulation verified</div>
                )}
              </div>
            )}

            {/* Tx details */}
            <div className="space-y-1 text-sm text-base-content/60 mb-4">
              <div className="flex justify-between">
                <span>To</span>
                <span className="font-mono text-xs">
                  {tx.to.slice(0, 6)}...{tx.to.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Chain ID</span>
                <span>{tx.chainId}</span>
              </div>
              {tx.description && <p className="mt-2 text-base-content/80">{tx.description}</p>}
            </div>

            {execError && (
              <div className="alert alert-error mb-4 text-sm">
                <span>{execError}</span>
              </div>
            )}

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)} disabled={isExecuting}>
                Cancel
              </button>
              <button className="btn btn-success" onClick={handleExecute} disabled={isExecuting}>
                {isExecuting ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Sending...
                  </>
                ) : (
                  "Confirm & Send"
                )}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
};

export default TransactionCard;
