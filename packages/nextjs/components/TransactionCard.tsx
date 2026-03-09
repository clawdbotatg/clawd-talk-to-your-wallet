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
          setExecError(`SWITCH YOUR WALLET TO ${chainName?.toUpperCase() || `CHAIN ${tx.chainId}`} AND TRY AGAIN.`);
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
      setExecError(e instanceof Error ? e.message : "TRANSACTION FAILED");
    } finally {
      setIsExecuting(false);
    }
  };

  const outChanges = tx.simulation?.changes?.filter(c => c.direction === "out") || [];
  const inChanges = tx.simulation?.changes?.filter(c => c.direction === "in") || [];

  return (
    <>
      {/* Inline card within the chat bubble */}
      <div
        className="mt-3 p-4 space-y-2 border-2"
        style={{
          backgroundColor: "#0d0d0d",
          borderColor: "#FFFFFF",
        }}
      >
        {/* Simulation preview */}
        {tx.simulation && tx.simulation.changes.length > 0 && (
          <div className="space-y-2 text-sm">
            {outChanges.map((c, i) => (
              <div key={`out-${i}`} className="flex justify-between items-center">
                <span
                  className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase font-bold"
                  style={{ color: "#666666" }}
                >
                  YOU SEND
                </span>
                <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
              </div>
            ))}
            {outChanges.length > 0 && inChanges.length > 0 && (
              <div className="h-0.5" style={{ backgroundColor: "#FFFFFF" }} />
            )}
            {inChanges.map((c, i) => (
              <div key={`in-${i}`} className="flex justify-between items-center">
                <span
                  className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase font-bold"
                  style={{ color: "#666666" }}
                >
                  YOU RECEIVE
                </span>
                <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        {tx.description && (
          <div className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase" style={{ color: "#666666" }}>
            <ChatMessageRenderer content={tx.description} />
          </div>
        )}

        {/* Tx confirmed inline */}
        {txHash && isTxConfirmed && (
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)] text-sm font-bold uppercase flex items-center gap-1"
            style={{ color: "#00FF41" }}
          >
            ✓ CONFIRMED —{" "}
            <a
              href={`${explorerBase}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "#00FF41" }}
            >
              VIEW TX
            </a>
          </div>
        )}

        {txHash && isTxConfirming && !isTxConfirmed && (
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase flex items-center gap-2"
            style={{ color: "#FFFFFF" }}
          >
            <span className="loading loading-spinner loading-xs"></span>
            CONFIRMING...
          </div>
        )}

        {/* Execute button */}
        {!txHash && (
          <button
            className="btn btn-sm w-full border-2 font-bold uppercase transition-colors duration-150"
            style={{
              backgroundColor: "#FF4500",
              color: "#000000",
              borderColor: "#FF4500",
              borderRadius: "0",
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
            onClick={() => setShowModal(true)}
          >
            <span className="font-[family-name:var(--font-space-grotesk)] text-sm tracking-wider">EXECUTE</span>
          </button>
        )}
      </div>

      {/* Confirmation modal */}
      {showModal && (
        <dialog className="modal modal-open" onClick={() => !isExecuting && setShowModal(false)}>
          <div
            className="modal-box border-2"
            style={{
              backgroundColor: "#0d0d0d",
              borderColor: "#FFFFFF",
              borderRadius: "0",
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-[family-name:var(--font-space-grotesk)] text-xl font-bold uppercase tracking-wider mb-6">
              CONFIRM TRANSACTION
            </h3>

            {/* Full simulation details */}
            {tx.simulation && tx.simulation.changes.length > 0 && (
              <div
                className="p-4 space-y-3 mb-4 border-2"
                style={{ backgroundColor: "#1a1a1a", borderColor: "#FFFFFF" }}
              >
                {outChanges.map((c, i) => (
                  <div key={`modal-out-${i}`} className="flex justify-between items-center">
                    <span
                      className="font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase font-bold"
                      style={{ color: "#666666" }}
                    >
                      YOU SEND
                    </span>
                    <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
                  </div>
                ))}
                {outChanges.length > 0 && inChanges.length > 0 && (
                  <div className="h-0.5" style={{ backgroundColor: "#FFFFFF" }} />
                )}
                {inChanges.map((c, i) => (
                  <div key={`modal-in-${i}`} className="flex justify-between items-center">
                    <span
                      className="font-[family-name:var(--font-ibm-plex-mono)] text-sm uppercase font-bold"
                      style={{ color: "#666666" }}
                    >
                      YOU RECEIVE
                    </span>
                    <AssetChip symbol={c.symbol} amount={c.amount} chain={c.chain || chainName} />
                  </div>
                ))}
                {tx.simulation.verified && (
                  <div
                    className="font-[family-name:var(--font-ibm-plex-mono)] text-xs text-center mt-1 uppercase"
                    style={{ color: "#00FF41" }}
                  >
                    ✓ SIMULATION VERIFIED ONCHAIN
                  </div>
                )}
              </div>
            )}

            {/* Tx details */}
            <div
              className="p-4 space-y-3 text-sm mb-4 border-2"
              style={{ backgroundColor: "#1a1a1a", borderColor: "#FFFFFF" }}
            >
              <div className="flex justify-between items-center">
                <span
                  className="font-[family-name:var(--font-ibm-plex-mono)] uppercase font-bold"
                  style={{ color: "#666666" }}
                >
                  FROM
                </span>
                <AddressChip address={address} />
              </div>
              {!tx.data || tx.data === "0x" ? (
                <div className="flex justify-between items-center">
                  <span
                    className="font-[family-name:var(--font-ibm-plex-mono)] uppercase font-bold"
                    style={{ color: "#666666" }}
                  >
                    TO
                  </span>
                  <AddressChip address={tx.to} />
                </div>
              ) : outChanges.length > 0 ? (
                <div className="flex justify-between items-center">
                  <span
                    className="font-[family-name:var(--font-ibm-plex-mono)] uppercase font-bold"
                    style={{ color: "#666666" }}
                  >
                    CONTRACT
                  </span>
                  <AssetChip symbol={outChanges[0].symbol} chain={outChanges[0].chain || chainName} />
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <span
                    className="font-[family-name:var(--font-ibm-plex-mono)] uppercase font-bold"
                    style={{ color: "#666666" }}
                  >
                    TO
                  </span>
                  <AddressChip address={tx.to} />
                </div>
              )}
              <div className="flex justify-between items-center">
                <span
                  className="font-[family-name:var(--font-ibm-plex-mono)] uppercase font-bold"
                  style={{ color: "#666666" }}
                >
                  NETWORK
                </span>
                {chainName ? (
                  <NetworkChip chain={chainName} />
                ) : (
                  <span className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase">
                    CHAIN {tx.chainId}
                  </span>
                )}
              </div>
              {tx.description && (
                <div className="text-xs pt-2 uppercase" style={{ color: "#666666", borderTop: "2px solid #FFFFFF" }}>
                  <ChatMessageRenderer content={tx.description} />
                </div>
              )}
            </div>

            {execError && (
              <div
                className="mb-4 p-3 font-[family-name:var(--font-ibm-plex-mono)] text-sm font-bold uppercase border-2"
                style={{
                  backgroundColor: "rgba(255, 69, 0, 0.1)",
                  borderColor: "#FF4500",
                  color: "#FF4500",
                }}
              >
                <span>{execError}</span>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                className="btn btn-ghost btn-sm font-bold uppercase"
                style={{ color: "#666666" }}
                onClick={() => setShowModal(false)}
                disabled={isExecuting}
              >
                CANCEL
              </button>
              <button
                className="btn btn-sm border-2 font-bold uppercase transition-colors duration-150"
                style={{
                  backgroundColor: "#FF4500",
                  color: "#000000",
                  borderColor: "#FF4500",
                  borderRadius: "0",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = "#000000";
                  e.currentTarget.style.color = "#FF4500";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = "#FF4500";
                  e.currentTarget.style.color = "#000000";
                }}
                onClick={handleExecute}
                disabled={isExecuting}
              >
                {isExecuting ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    SENDING...
                  </>
                ) : (
                  <span className="font-[family-name:var(--font-space-grotesk)] tracking-wider">CONFIRM & SEND</span>
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
