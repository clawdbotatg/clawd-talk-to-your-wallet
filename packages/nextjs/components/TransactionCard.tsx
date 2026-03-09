"use client";

import { useCallback, useState } from "react";
import AddressChip from "./AddressChip";
import AssetChip from "./AssetChip";
import ChatMessageRenderer from "./ChatMessageRenderer";
import NetworkChip from "./NetworkChip";
import { useChainId, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt } from "wagmi";

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
  const { switchChainAsync } = useSwitchChain();
  const currentChainId = useChainId();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const explorerBase = EXPLORER_URLS[tx.chainId] || "https://etherscan.io/tx/";
  const chainName = CHAIN_NAMES[tx.chainId];

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
        to: tx.to as `0x${string}`,
        data: (tx.data && tx.data !== "0x" ? tx.data : undefined) as `0x${string}` | undefined,
        value: BigInt(tx.value || "0"),
        chainId: tx.chainId,
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
      {/* Inline card — gazette style */}
      <div className="mt-3 p-3 space-y-2" style={{ backgroundColor: "#FFF4E6", border: "1px solid #DDD5C8" }}>
        {/* Simulation preview */}
        {tx.simulation && tx.simulation.changes.length > 0 && (
          <div className="space-y-2">
            {outChanges.map((c, i) => (
              <div key={`out-${i}`} className="flex justify-between items-center">
                <span
                  className="font-[family-name:var(--font-newsreader)] italic"
                  style={{ fontSize: "12px", color: "#8B8680" }}
                >
                  You send
                </span>
                <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
              </div>
            ))}
            {outChanges.length > 0 && inChanges.length > 0 && (
              <div style={{ borderTop: "1px solid #DDD5C8" }} />
            )}
            {inChanges.map((c, i) => (
              <div key={`in-${i}`} className="flex justify-between items-center">
                <span
                  className="font-[family-name:var(--font-newsreader)] italic"
                  style={{ fontSize: "12px", color: "#8B8680" }}
                >
                  You receive
                </span>
                <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        {tx.description && (
          <div style={{ fontSize: "12px", color: "#8B8680" }}>
            <ChatMessageRenderer content={tx.description} />
          </div>
        )}

        {/* Tx confirmed */}
        {txHash && isTxConfirmed && (
          <div style={{ fontSize: "13px", color: "#2C2C2C" }} className="flex items-center gap-1">
            ✓ Confirmed —{" "}
            <a
              href={`${explorerBase}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#2C2C2C", textDecoration: "underline" }}
            >
              view tx
            </a>
          </div>
        )}

        {txHash && isTxConfirming && !isTxConfirmed && (
          <div style={{ fontSize: "13px", color: "#8B8680" }} className="flex items-center gap-2">
            <span className="loading loading-spinner loading-xs"></span>
            Confirming...
          </div>
        )}

        {/* Execute button */}
        {!txHash && (
          <button
            className="w-full py-2 mt-1"
            style={{
              backgroundColor: "#2C2C2C",
              color: "#FFF8EE",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-literata)",
              fontSize: "13px",
              fontWeight: 600,
            }}
            onClick={() => setShowModal(true)}
          >
            Execute
          </button>
        )}
      </div>

      {/* Confirmation modal — gazette style */}
      {showModal && (
        <dialog className="modal modal-open" onClick={() => !isExecuting && setShowModal(false)}>
          <div
            className="modal-box"
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: "#FFF4E6",
              border: "2px solid #2C2C2C",
              borderRadius: 0,
              boxShadow: "none",
            }}
          >
            <h3
              className="font-[family-name:var(--font-newsreader)] italic mb-4"
              style={{ fontSize: "1.25rem", color: "#2C2C2C" }}
            >
              Confirm Transaction
            </h3>

            {/* Simulation details */}
            {tx.simulation && tx.simulation.changes.length > 0 && (
              <div className="p-4 space-y-3 mb-4" style={{ backgroundColor: "#FFF8EE", border: "1px solid #DDD5C8" }}>
                {outChanges.map((c, i) => (
                  <div key={`modal-out-${i}`} className="flex justify-between items-center">
                    <span
                      className="font-[family-name:var(--font-newsreader)] italic"
                      style={{ fontSize: "13px", color: "#8B8680" }}
                    >
                      You send
                    </span>
                    <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
                  </div>
                ))}
                {outChanges.length > 0 && inChanges.length > 0 && (
                  <div style={{ borderTop: "1px solid #DDD5C8" }} />
                )}
                {inChanges.map((c, i) => (
                  <div key={`modal-in-${i}`} className="flex justify-between items-center">
                    <span
                      className="font-[family-name:var(--font-newsreader)] italic"
                      style={{ fontSize: "13px", color: "#8B8680" }}
                    >
                      You receive
                    </span>
                    <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
                  </div>
                ))}
                {tx.simulation.verified && (
                  <div
                    className="text-center mt-1 font-[family-name:var(--font-victor-mono)]"
                    style={{ fontSize: "10px", color: "#8B8680" }}
                  >
                    ✓ Simulation verified onchain
                  </div>
                )}
              </div>
            )}

            {/* Tx details */}
            <div className="p-4 space-y-3 mb-4" style={{ backgroundColor: "#FFF8EE", border: "1px solid #DDD5C8", fontSize: "13px" }}>
              <div className="flex justify-between items-center">
                <span style={{ color: "#8B8680" }}>From</span>
                <AddressChip address={address} />
              </div>
              {!tx.data || tx.data === "0x" ? (
                <div className="flex justify-between items-center">
                  <span style={{ color: "#8B8680" }}>To</span>
                  <AddressChip address={tx.to} />
                </div>
              ) : outChanges.length > 0 ? (
                <div className="flex justify-between items-center">
                  <span style={{ color: "#8B8680" }}>Contract</span>
                  <AssetChip symbol={outChanges[0].symbol} chain={outChanges[0].chain || chainName} />
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <span style={{ color: "#8B8680" }}>To</span>
                  <AddressChip address={tx.to} />
                </div>
              )}
              <div className="flex justify-between items-center">
                <span style={{ color: "#8B8680" }}>Network</span>
                {chainName ? (
                  <NetworkChip chain={chainName} />
                ) : (
                  <span className="font-[family-name:var(--font-victor-mono)]" style={{ fontSize: "12px" }}>
                    Chain {tx.chainId}
                  </span>
                )}
              </div>
              {tx.description && (
                <div style={{ borderTop: "1px solid #DDD5C8", paddingTop: "0.5rem", color: "#8B8680", fontSize: "12px" }}>
                  <ChatMessageRenderer content={tx.description} />
                </div>
              )}
            </div>

            {execError && (
              <div className="mb-4 p-3" style={{ border: "1px solid #C41E3A", backgroundColor: "#FFF8EE", fontSize: "13px", color: "#C41E3A" }}>
                {execError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                style={{
                  background: "none",
                  border: "1px solid #DDD5C8",
                  padding: "0.5rem 1rem",
                  cursor: "pointer",
                  fontSize: "13px",
                  color: "#8B8680",
                }}
                onClick={() => setShowModal(false)}
                disabled={isExecuting}
              >
                Cancel
              </button>
              <button
                style={{
                  backgroundColor: "#2C2C2C",
                  color: "#FFF8EE",
                  border: "none",
                  padding: "0.5rem 1.5rem",
                  cursor: isExecuting ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: 600,
                  opacity: isExecuting ? 0.6 : 1,
                }}
                onClick={handleExecute}
                disabled={isExecuting}
              >
                {isExecuting ? (
                  <>
                    <span className="loading loading-spinner loading-sm mr-1"></span>
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
