"use client";

import { useCallback, useState } from "react";
import AddressChip from "./AddressChip";
import AssetChip from "./AssetChip";
import ChatMessageRenderer from "./ChatMessageRenderer";
import NetworkChip from "./NetworkChip";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";

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

const TransactionCard = ({ tx, address }: TransactionCardProps) => {
  const [showModal, setShowModal] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [execError, setExecError] = useState("");

  const { sendTransactionAsync } = useSendTransaction();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const explorerBase = EXPLORER_URLS[tx.chainId] || "https://etherscan.io/tx/";
  const chainName = CHAIN_NAMES[tx.chainId];

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
          <div className="space-y-2 text-sm">
            {outChanges.map((c, i) => (
              <div key={`out-${i}`} className="flex justify-between items-center">
                <span className="text-base-content/60 text-xs">You send</span>
                <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
              </div>
            ))}
            {outChanges.length > 0 && inChanges.length > 0 && <div className="border-t border-base-content/10" />}
            {inChanges.map((c, i) => (
              <div key={`in-${i}`} className="flex justify-between items-center">
                <span className="text-base-content/60 text-xs">You receive</span>
                <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        {tx.description && (
          <div className="text-xs text-base-content/50">
            <ChatMessageRenderer content={tx.description} />
          </div>
        )}

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
              <div className="bg-base-200 rounded-xl p-4 space-y-3 mb-4">
                {outChanges.map((c, i) => (
                  <div key={`modal-out-${i}`} className="flex justify-between items-center">
                    <span className="text-base-content/60 text-sm">You send</span>
                    <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
                  </div>
                ))}
                {outChanges.length > 0 && inChanges.length > 0 && <div className="border-t border-base-300" />}
                {inChanges.map((c, i) => (
                  <div key={`modal-in-${i}`} className="flex justify-between items-center">
                    <span className="text-base-content/60 text-sm">You receive</span>
                    <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
                  </div>
                ))}
                {tx.simulation.verified && (
                  <div className="text-xs text-success/70 text-center mt-1">✓ Simulation verified on-chain</div>
                )}
              </div>
            )}

            {/* Tx details */}
            <div className="bg-base-200 rounded-xl p-4 space-y-3 text-sm mb-4">
              <div className="flex justify-between items-center">
                <span className="text-base-content/60">From</span>
                <AddressChip address={address} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-base-content/60">To</span>
                <AddressChip address={tx.to} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-base-content/60">Network</span>
                {chainName ? (
                  <NetworkChip chain={chainName} />
                ) : (
                  <span className="text-xs font-mono">Chain {tx.chainId}</span>
                )}
              </div>
              {tx.description && (
                <div className="text-base-content/60 text-xs border-t border-base-300 pt-2">
                  <ChatMessageRenderer content={tx.description} />
                </div>
              )}
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
