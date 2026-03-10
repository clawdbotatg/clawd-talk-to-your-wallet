"use client";

import { useCallback, useEffect, useState } from "react";
import ChatMessageRenderer from "./ChatMessageRenderer";
import { useChainId, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt, useWalletClient } from "wagmi";

interface StepData {
  to: string;
  data: string;
  value: string;
  chainId: number;
  description: string;
  label: string;
}

interface MultiStepTransactionData {
  message: string;
  steps: StepData[];
  delay: number; // ms between steps
  priceEth?: string;
  priceWei?: string;
}

interface MultiStepTransactionCardProps {
  tx: MultiStepTransactionData;
  address?: string;
  onComplete?: (hashes: (`0x${string}` | undefined)[]) => void;
}

type MultiStepState =
  | "idle"
  | "step1_confirming"
  | "step1_pending"
  | "step1_confirmed"
  | "waiting"
  | "step2_confirming"
  | "step2_pending"
  | "step2_confirmed"
  | "done";

const EXPLORER_URLS: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  137: "https://polygonscan.com/tx/",
};

const CHAIN_NAMES: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon",
};

// Derive a stable key from the commit calldata (first 32 chars after selector is unique enough)
function deriveStorageKey(tx: MultiStepTransactionData): string {
  const commitData = tx.steps[0]?.data || "";
  return `ens-registration-${commitData.slice(0, 42)}`;
}

interface PersistedENSState {
  state: MultiStepState;
  step1Hash?: string;
  step2Hash?: string;
  commitTimestamp?: number; // unix ms when commit was confirmed
  delayMs: number;
}

function loadPersistedState(key: string): PersistedENSState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PersistedENSState) : null;
  } catch {
    return null;
  }
}

function savePersistedState(key: string, state: PersistedENSState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {}
}

function clearPersistedState(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

const MultiStepTransactionCard = ({ tx, onComplete }: MultiStepTransactionCardProps) => {
  const storageKey = deriveStorageKey(tx);

  // Restore from localStorage on mount
  const persisted = loadPersistedState(storageKey);

  // If we have a persisted state mid-flow, calculate remaining countdown
  const getInitialCountdown = (p: PersistedENSState | null): number => {
    if (!p || p.state !== "waiting" || !p.commitTimestamp) return 0;
    const elapsed = Date.now() - p.commitTimestamp;
    const remaining = Math.max(0, Math.ceil((p.delayMs - elapsed) / 1000));
    return remaining;
  };

  const getInitialState = (p: PersistedENSState | null): MultiStepState => {
    if (!p) return "idle";
    // If we were waiting and countdown has already elapsed, jump to step2_confirming
    if (p.state === "waiting" && p.commitTimestamp) {
      const elapsed = Date.now() - p.commitTimestamp;
      if (elapsed >= p.delayMs) return "step2_confirming";
    }
    return p.state;
  };

  const [state, setState] = useState<MultiStepState>(() => getInitialState(persisted));
  const [step1Hash, setStep1Hash] = useState<`0x${string}` | undefined>(
    persisted?.step1Hash as `0x${string}` | undefined,
  );
  const [step2Hash, setStep2Hash] = useState<`0x${string}` | undefined>(
    persisted?.step2Hash as `0x${string}` | undefined,
  );
  const [execError, setExecError] = useState("");
  const [countdown, setCountdown] = useState(() => getInitialCountdown(persisted));
  const [showModal, setShowModal] = useState(false);
  const [commitTimestamp, setCommitTimestamp] = useState<number | undefined>(persisted?.commitTimestamp);

  // Persist state whenever it changes
  useEffect(() => {
    if (state === "idle") return; // don't persist before anything happens
    if (state === "done") {
      clearPersistedState(storageKey); // clean up when done
      return;
    }
    savePersistedState(storageKey, {
      state,
      step1Hash,
      step2Hash,
      commitTimestamp,
      delayMs: tx.delay,
    });
  }, [state, step1Hash, step2Hash, commitTimestamp, storageKey, tx.delay]);

  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const currentChainId = useChainId();

  const { isLoading: isStep1Confirming, isSuccess: isStep1Confirmed } = useWaitForTransactionReceipt({
    hash: step1Hash,
  });
  const { isLoading: isStep2Confirming, isSuccess: isStep2Confirmed } = useWaitForTransactionReceipt({
    hash: step2Hash,
  });

  const step1 = tx.steps[0];
  const step2 = tx.steps[1];
  const chainName = step1 ? CHAIN_NAMES[step1.chainId] : undefined;
  const explorerBase = step1 ? EXPLORER_URLS[step1.chainId] || "https://etherscan.io/tx/" : "https://etherscan.io/tx/";

  // Track step 1 confirmation
  useEffect(() => {
    if (step1Hash && isStep1Confirming && state === "step1_pending") {
      // still pending, do nothing
    }
    if (step1Hash && isStep1Confirmed && (state === "step1_pending" || state === "step1_confirming")) {
      setState("step1_confirmed");
    }
  }, [step1Hash, isStep1Confirming, isStep1Confirmed, state]);

  // Start countdown after step 1 confirms
  useEffect(() => {
    if (state === "step1_confirmed") {
      const delaySeconds = Math.ceil(tx.delay / 1000);
      const ts = Date.now();
      setCommitTimestamp(ts);
      setCountdown(delaySeconds);
      setState("waiting");
    }
  }, [state, tx.delay]);

  // Countdown timer
  useEffect(() => {
    if (state !== "waiting") return;
    if (countdown <= 0) {
      setState("step2_confirming");
      return;
    }
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setState("step2_confirming");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [state, countdown]);

  // Track step 2 confirmation
  useEffect(() => {
    if (step2Hash && isStep2Confirmed && (state === "step2_pending" || state === "step2_confirming")) {
      setState("done");
      onComplete?.([step1Hash, step2Hash]);
    }
  }, [step2Hash, isStep2Confirming, isStep2Confirmed, state, step1Hash, onComplete]);

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

  const handleSwitchChain = async (targetChainId: number) => {
    setExecError("");
    try {
      await switchChainAsync({ chainId: targetChainId });
    } catch {
      try {
        const chainHex = `0x${targetChainId.toString(16)}`;
        await walletClient?.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainHex,
              chainName: CHAIN_NAMES[targetChainId] || `Chain ${targetChainId}`,
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://cloudflare-eth.com"],
              blockExplorerUrls: [],
            },
          ],
        });
      } catch {
        setExecError(`Could not switch to ${CHAIN_NAMES[targetChainId] || `chain ${targetChainId}`}. Switch manually.`);
      }
    }
  };

  const handleExecuteStep = async (step: StepData, stepNum: 1 | 2) => {
    setExecError("");
    setState(stepNum === 1 ? "step1_confirming" : "step2_confirming");

    try {
      if (step.chainId && currentChainId !== step.chainId) {
        try {
          await switchChainAsync({ chainId: step.chainId });
        } catch {
          setExecError(`Please switch to ${chainName || `chain ${step.chainId}`} and try again.`);
          setState(stepNum === 1 ? "idle" : "step2_confirming");
          return;
        }
      }

      const promise = sendTransactionAsync({
        to: step.to as `0x${string}`,
        data: (step.data && step.data !== "0x" ? step.data : undefined) as `0x${string}` | undefined,
        value: BigInt(step.value || "0"),
        chainId: step.chainId,
      });
      setTimeout(openWallet, 2000);
      const hash = await promise;

      if (stepNum === 1) {
        setStep1Hash(hash);
        setState("step1_pending");
        setShowModal(false); // close only after wallet confirms submission
      } else {
        setStep2Hash(hash);
        setState("step2_pending");
      }
    } catch (e: unknown) {
      // Wallet rejected or errored — stay on idle so user can retry
      setExecError(e instanceof Error ? e.message : "Transaction failed or rejected");
      setState(stepNum === 1 ? "idle" : "step2_confirming");
    }
  };

  // ─── Compute current step index and progress ────────────────────────────

  const getCurrentStepIndex = (): number => {
    if (state === "done" || state === "step2_confirmed") return 2;
    if (state === "step2_confirming" || state === "step2_pending" || state === "waiting" || state === "step1_confirmed")
      return 1;
    return 0;
  };

  const currentStep = getCurrentStepIndex();
  const delaySeconds = Math.ceil(tx.delay / 1000);
  const progress = state === "waiting" ? ((delaySeconds - countdown) / delaySeconds) * 100 : 0;

  // ─── Derive ENS name from step descriptions ─────────────────────────────

  const ensNameMatch =
    step1?.description?.match(/register\s+(\S+\.eth)/i) || step2?.description?.match(/register\s+(\S+\.eth)/i);
  const ensName = ensNameMatch?.[1] || "your name";

  // Needs chain switch?
  const needsSwitch = step1 && currentChainId !== step1.chainId;

  return (
    <>
      <div
        className="mt-3 p-4 space-y-3"
        style={{
          backgroundColor: "#111111",
          border: "1px solid rgba(201, 168, 76, 0.15)",
        }}
      >
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              style={{
                color: currentStep >= 1 ? "#C9A84C" : "rgba(201, 168, 76, 0.4)",
                fontSize: "10px",
              }}
            >
              {currentStep >= 1 ? "●" : "○"}
            </span>
            <span
              className="font-[family-name:var(--font-cinzel)] tracking-[0.1em] uppercase"
              style={{
                color: currentStep >= 1 ? "#C9A84C" : "#8A8578",
                fontSize: "10px",
              }}
            >
              {step1?.label || "Step 1"}
            </span>
          </div>
          <span style={{ color: "rgba(201, 168, 76, 0.3)" }}>──</span>
          <div className="flex items-center gap-1.5">
            <span
              style={{
                color: currentStep >= 2 ? "#C9A84C" : "rgba(201, 168, 76, 0.4)",
                fontSize: "10px",
              }}
            >
              {currentStep >= 2 ? "●" : "○"}
            </span>
            <span
              className="font-[family-name:var(--font-cinzel)] tracking-[0.1em] uppercase"
              style={{
                color: currentStep >= 2 ? "#C9A84C" : "#8A8578",
                fontSize: "10px",
              }}
            >
              {step2?.label || "Step 2"}
            </span>
          </div>
        </div>

        {/* Current step description */}
        {state === "idle" && step1 && (
          <div className="text-xs" style={{ color: "#8A8578" }}>
            <ChatMessageRenderer content={step1.description} />
          </div>
        )}

        {(state === "step1_pending" || state === "step1_confirming") && (
          <div className="text-sm flex items-center gap-2" style={{ color: "#8A8578" }}>
            <span className="loading loading-spinner loading-xs"></span>
            {state === "step1_confirming" ? "Confirm in wallet..." : "Confirming commit..."}
          </div>
        )}

        {state === "step1_confirmed" && (
          <div className="text-sm" style={{ color: "#C9A84C" }}>
            ✓ Commit confirmed —{" "}
            <a
              href={`${explorerBase}${step1Hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "#C9A84C" }}
            >
              view tx
            </a>
          </div>
        )}

        {/* Countdown waiting */}
        {state === "waiting" && (
          <div className="space-y-2">
            <div className="text-sm" style={{ color: "#C9A84C" }}>
              ✓ Commit confirmed —{" "}
              <a
                href={`${explorerBase}${step1Hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "#C9A84C" }}
              >
                view tx
              </a>
            </div>
            <div className="text-sm text-center" style={{ color: "#E8E4DC" }}>
              Waiting {countdown}s before registration...
            </div>
            <div className="w-full h-1.5" style={{ backgroundColor: "rgba(201, 168, 76, 0.1)" }}>
              <div
                className="h-full transition-all duration-1000 ease-linear"
                style={{
                  width: `${progress}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Step 2 states */}
        {state === "step2_confirming" && step2 && (
          <div className="space-y-2">
            <div className="text-sm" style={{ color: "#C9A84C" }}>
              ✓ Commit confirmed
            </div>
            <div className="text-xs" style={{ color: "#8A8578" }}>
              <ChatMessageRenderer content={step2.description} />
            </div>
          </div>
        )}

        {state === "step2_pending" && (
          <div className="space-y-2">
            <div className="text-sm" style={{ color: "#C9A84C" }}>
              ✓ Commit confirmed
            </div>
            <div className="text-sm flex items-center gap-2" style={{ color: "#8A8578" }}>
              <span className="loading loading-spinner loading-xs"></span>
              Confirming registration...
            </div>
          </div>
        )}

        {state === "done" && (
          <div className="space-y-2">
            <div className="text-sm" style={{ color: "#C9A84C" }}>
              ✓ {ensName} registered!
            </div>
            {step2Hash && (
              <div className="text-sm" style={{ color: "#C9A84C" }}>
                <a
                  href={`${explorerBase}${step2Hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "#C9A84C" }}
                >
                  View registration tx
                </a>
              </div>
            )}
          </div>
        )}

        {/* Error display */}
        {execError && (
          <div
            className="p-2 text-xs"
            style={{
              backgroundColor: "rgba(155, 61, 61, 0.1)",
              border: "1px solid rgba(155, 61, 61, 0.3)",
              color: "#9B3D3D",
            }}
          >
            {execError}
          </div>
        )}

        {/* Action buttons */}
        {state === "idle" && needsSwitch && (
          <button className="btn btn-sm w-full gold-btn" style={{}} onClick={() => handleSwitchChain(step1.chainId)}>
            <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase">
              Switch to {chainName || `Chain ${step1.chainId}`}
            </span>
          </button>
        )}

        {state === "idle" && !needsSwitch && (
          <button className="btn btn-sm w-full gold-btn" style={{}} onClick={() => setShowModal(true)}>
            <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase">
              {step1?.label || "Execute Step 1"}
            </span>
          </button>
        )}

        {state === "step2_confirming" && !needsSwitch && (
          <button className="btn btn-sm w-full gold-btn" style={{}} onClick={() => handleExecuteStep(step2, 2)}>
            <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase">
              {step2?.label || "Execute Step 2"}
            </span>
          </button>
        )}

        {state === "step2_confirming" && needsSwitch && (
          <button className="btn btn-sm w-full gold-btn" style={{}} onClick={() => handleSwitchChain(step2.chainId)}>
            <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase">
              Switch to {chainName || `Chain ${step2.chainId}`}
            </span>
          </button>
        )}
      </div>

      {/* Step 1 confirmation modal */}
      {showModal && (
        <dialog className="modal modal-open" onClick={() => state === "idle" && !execError && setShowModal(false)}>
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
              ENS Registration — Step 1 of 2
            </h3>

            <div
              className="p-4 space-y-3 text-sm mb-4"
              style={{
                backgroundColor: "#0a0a0a",
                border: "1px solid rgba(201, 168, 76, 0.08)",
              }}
            >
              <div className="flex justify-between items-center">
                <span style={{ color: "#8A8578" }}>Action</span>
                <span className="font-[family-name:var(--font-cinzel)] text-xs" style={{ color: "#E8E4DC" }}>
                  Commit
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: "#8A8578" }}>Cost</span>
                <span className="font-[family-name:var(--font-jetbrains)] text-xs" style={{ color: "#E8E4DC" }}>
                  Gas only
                </span>
              </div>
              <div
                className="text-xs pt-2"
                style={{ color: "#8A8578", borderTop: "1px solid rgba(201, 168, 76, 0.08)" }}
              >
                <ChatMessageRenderer content={step1?.description || ""} />
              </div>
              <div className="text-[10px]" style={{ color: "rgba(201, 168, 76, 0.5)" }}>
                After confirming, you will need to wait ~60 seconds before completing registration.
              </div>
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
                {execError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: "#8A8578" }}
                onClick={() => setShowModal(false)}
                disabled={state === "step1_confirming"}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm gold-btn"
                style={{}}
                onClick={() => handleExecuteStep(step1, 1)}
                disabled={state === "step1_confirming"}
              >
                {state === "step1_confirming" ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase ml-2">
                      Waiting for wallet...
                    </span>
                  </>
                ) : (
                  <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.1em] uppercase">
                    Confirm &amp; Commit
                  </span>
                )}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
};

export default MultiStepTransactionCard;
