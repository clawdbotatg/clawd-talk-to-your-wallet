"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import ActivityPanel from "~~/components/ActivityPanel";
import ChatMessageRenderer from "~~/components/ChatMessageRenderer";
import { useDetailModal } from "~~/components/DetailModal";
import GoldParticles from "~~/components/GoldParticles";
import MultiStepTransactionCard from "~~/components/MultiStepTransactionCard";
import TransactionCard from "~~/components/TransactionCard";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useCvAuth } from "~~/hooks/useCvAuth";
import { type SavedAction, useSavedActions } from "~~/hooks/useSavedActions";

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

interface MultiStepTransactionData {
  message: string;
  steps: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    description: string;
    label: string;
  }[];
  delay: number;
  priceEth?: string;
  priceWei?: string;
  // Descriptor for re-pricing the final (swap) step after approvals confirm.
  requote?: { tool: string; args: Record<string, unknown> };
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
    // Deterministic re-build descriptor from the swap tool — lets the card
    // refresh price/calldata via /api/requote without another agent turn.
    requote?: { tool: string; args: Record<string, unknown> };
    quote?: { amountOut?: string; amountOutMinimum?: string; slippagePct?: number };
    txHash?: `0x${string}`;
  };
  multistepTransaction?: MultiStepTransactionData;
  timestamp: number;
}

interface PendingActivity {
  id: string;
  txHash: string;
  chainId: number;
  type: string;
  outToken?: { symbol: string; amount: string };
  inToken?: { symbol: string; amount: string };
  isCrossChain?: boolean;
  addedAt: number;
}

interface ConfirmedTxInfo {
  txHash: string;
  chainId: number;
  type: "swap" | "bridge" | "send" | "wrap" | "other";
  outToken?: { symbol: string; amount: string };
  inToken?: { symbol: string; amount: string };
  isCrossChain?: boolean;
  toChainId?: number;
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

const OWNER_SUGGESTIONS = [
  { category: "Portfolio", suggestions: ["how is ETH doing?", "show my recent trades"] },
  { category: "Swap & Bridge", suggestions: ["bridge 100 USDC to Base", "swap 0.1 ETH for USDC"] },
  { category: "DeFi", suggestions: ["deposit 100 USDC into Aave", "unwrap my WETH"] },
  { category: "History", suggestions: ["where did my ETH come from?", "what did I spend gas on?"] },
];

// Read-only prompts: everything is a question ABOUT the wallet, never an order to it.
const VIEW_SUGGESTIONS = [
  { category: "Holdings", suggestions: ["what is this wallet holding?", "what is its biggest position?"] },
  { category: "Behaviour", suggestions: ["what has this wallet been doing lately?", "is it accumulating or selling?"] },
  { category: "History", suggestions: ["when did it first buy ETH?", "where did its USDC come from?"] },
  { category: "Risk", suggestions: ["what approvals has it left open?", "which protocols is it exposed to?"] },
];
// Post-confirmation refetch schedule (ms). Zerion indexes a tx well after it
// confirms, so we re-poll with backoff rather than guessing one delay.
const TX_REFRESH_DELAYS = [8_000, 18_000, 35_000, 60_000, 90_000];

type IntentResponse = {
  type?: string;
  message?: string;
  transaction?: ChatMessage["transaction"];
  steps?: NonNullable<ChatMessage["multistepTransaction"]>["steps"];
  delay?: number;
  priceEth?: string;
  priceWei?: string;
  requote?: { tool: string; args: Record<string, unknown> };
  error?: string;
};

/** Read the agent's SSE progress stream, reporting each tool call as it lands and
 * resolving with the final result object. */
async function consumeIntentStream(
  body: ReadableStream<Uint8Array>,
  onStep: (label: string) => void,
): Promise<IntentResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: IntentResponse | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? ""; // keep the trailing partial frame
    for (const frame of frames) {
      const line = frame.split("\n").find(l => l.startsWith("data: "));
      if (!line) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "step" && evt.label) onStep(evt.label as string);
        else if (evt.type === "done") result = evt.result as IntentResponse;
        else if (evt.type === "error") result = { type: "chat", message: `Something went wrong: ${evt.error}` };
      } catch {
        /* ignore a malformed frame rather than losing the whole turn */
      }
    }
    // The final event IS the result — render it now rather than waiting for the
    // socket to close (a proxy holding the connection open once cost 4 minutes).
    if (result) {
      reader.cancel().catch(() => undefined);
      return result;
    }
  }
  return result ?? { type: "chat", message: "The agent stopped before finishing. Please try again." };
}

// ─── Component ───────────────────────────────────────────────────────────────

export type WalletWorkspaceProps = {
  /** The wallet being inspected. Omit for the owner view — it defaults to the
   * connected wallet. On /<ens-or-address> this is somebody else's wallet. */
  subjectAddress?: string;
  /** ENS name to show instead of the raw address, when we arrived via one. */
  subjectName?: string;
  /** Read-only: the visitor doesn't own this wallet, so the agent may not build
   * transactions and no signable card is ever rendered. */
  readOnly?: boolean;
};

const WalletWorkspace = ({ subjectAddress, subjectName, readOnly = false }: WalletWorkspaceProps) => {
  const { address, isConnected } = useAccount();
  const { cvSignature, cvWallet, hasCvSig, isCvSigning, cvBalance, updateCvBalance, fetchCvBalance, signCv } =
    useCvAuth();

  // `address` is the VIEWER (pays, signs). `subject` is the wallet on screen —
  // the same thing in the owner view, someone else's in read-only.
  const subject = subjectAddress ?? address;
  const isOwnWallet = !!address && !!subject && address.toLowerCase() === subject.toLowerCase();
  const subjectLabel = subjectName || (subject ? `${subject.slice(0, 6)}…${subject.slice(-4)}` : "");

  // Auth is now just the CV sig — no separate signing step
  const isAuthed = hasCvSig && !!cvSignature;
  const authHeaders = useMemo(
    () =>
      isAuthed && cvWallet && cvSignature
        ? {
            "x-denarai-cv-wallet": cvWallet,
            "x-denarai-cv-sig": cvSignature,
            "x-denarai-address": subject || cvWallet,
          }
        : null,
    [isAuthed, cvWallet, cvSignature, subject],
  );
  const { openModal } = useDetailModal();
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  // Tool calls reported by the agent while a turn runs (SSE), newest last.
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // /?ask=<text> prefills the chat box (used by /pay's "get USDC" button)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ask = params.get("ask");
    if (!ask) return;
    setMessage(ask);
    params.delete("ask");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // Single auto-sign trigger — only here, not in the hook, so it fires exactly once ever
  useEffect(() => {
    if (isConnected && !cvSignature && !hasCvSig && !isCvSigning) {
      signCv();
    }
  }, [isConnected, cvSignature, hasCvSig, isCvSigning, signCv]);

  // One thread per wallet on screen. Read-only threads live under their own
  // prefix so visiting your own address doesn't stomp your owner-view history.
  const chatKeyFor = useCallback(
    (who: string | undefined) => `clawd-chat-${readOnly ? "view-" : ""}${who?.toLowerCase() || "anon"}`,
    [readOnly],
  );
  const STORAGE_KEY = subject ? chatKeyFor(subject) : null;
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(`clawd-chat-${readOnly ? "view-" : ""}${subject?.toLowerCase() || "anon"}`);
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
  const [pendingActivities, setPendingActivities] = useState<PendingActivity[]>([]);
  // Tx hashes that have shown up in activity — used to cancel the remaining
  // post-confirmation refetches.
  const resolvedTxRef = useRef<Set<string>>(new Set());
  const [highlightedTokens, setHighlightedTokens] = useState<Set<string>>(new Set());

  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Global gold shimmer: track cursor on root, each .gold-btn reads from its own offset
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      document.querySelectorAll<HTMLElement>(".gold-btn").forEach(btn => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        btn.style.setProperty("--mx", `${x}px`);
        btn.style.setProperty("--my", `${y}px`);
      });
    };
    window.addEventListener("mousemove", handler, { passive: true });
    return () => window.removeEventListener("mousemove", handler);
  }, []);

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
    if (!subject) {
      setMessages([]);
      return;
    }
    try {
      const saved = localStorage.getItem(chatKeyFor(subject));
      setMessages(saved ? JSON.parse(saved) : []);
    } catch {
      setMessages([]);
    }
  }, [subject, chatKeyFor]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

  // cvCharged persists across wallet switches — we charge once per session, not per wallet
  const [cvCharged, setCvCharged] = useState(false);
  const [cvChargeError, setCvChargeError] = useState<string | null>(null);

  // Charge once per session (CV first, USDC credits fallback) as soon as we have
  // a sig — does NOT block portfolio on failure
  useEffect(() => {
    if (!address || !authHeaders || !cvSignature || !cvWallet || cvCharged) return;

    const charge = async () => {
      try {
        const cvRes = await fetch("/api/credits/spend", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ kind: "page_load" }),
        });
        const cvData = await cvRes.json();
        if (cvData.success) {
          if (typeof cvData.newBalance === "number") updateCvBalance(cvData.newBalance);
          fetchCvBalance(cvWallet);
          setCvCharged(true);
          setCvChargeError(null);
        } else {
          // Only hard-block if truly insufficient (402: no CV and no USDC) — other errors let the app load
          if (cvRes.status === 402) {
            setCvChargeError(cvData.error || "Insufficient balance");
          } else {
            // Soft fail — let the app load, log the issue
            console.error("[charge soft-fail]", cvData.error);
            setCvCharged(true);
          }
          fetchCvBalance(cvWallet);
        }
      } catch {
        // Network error — let the app load rather than hard-block
        console.error("[charge network error]");
        setCvCharged(true);
      }
    };

    charge();
  }, [address, authHeaders, cvSignature, cvWallet, cvCharged, updateCvBalance, fetchCvBalance]);

  const fetchPortfolio = useCallback(async () => {
    if (!subject || !authHeaders || (!cvCharged && !cvSignature)) return;
    setIsLoadingPortfolio(true);

    try {
      const res = await fetch(`/api/portfolio?address=${subject}`, {
        headers: { ...authHeaders },
      });
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
  }, [subject, authHeaders, cvCharged, cvSignature]);

  const fetchActivity = useCallback(async () => {
    if (!subject || !authHeaders) return;
    try {
      const res = await fetch(`/api/activity?address=${subject}`, {
        headers: { ...authHeaders },
      });
      const data = await res.json();
      setActivity(data.items || []);
    } catch (e) {
      console.error("Failed to fetch activity:", e);
    }
  }, [subject, authHeaders]);

  useEffect(() => {
    if (!subject) {
      setPortfolio([]);
      setDefiPositions([]);
      setTotalBalanceUsd("0");
      setTotalPortfolioUsd("0");
      setChange1dUsd("0");
      setChange1dPct("0");
      setActivity([]);
      return;
    }

    fetchPortfolio();
    setTimeout(fetchActivity, 1500);
  }, [subject, fetchPortfolio, fetchActivity]);

  // 60s portfolio poll
  useEffect(() => {
    if (!subject) return;
    const interval = setInterval(fetchPortfolio, 60_000);
    return () => clearInterval(interval);
  }, [subject, fetchPortfolio]);

  // ─── handleTxConfirmed ────────────────────────────────────────────────────

  const handleTxConfirmed = useCallback(
    (info: ConfirmedTxInfo) => {
      const pending: PendingActivity = {
        id: info.txHash,
        txHash: info.txHash,
        chainId: info.chainId,
        type: info.type === "swap" ? "trade" : info.type,
        outToken: info.outToken,
        inToken: info.inToken,
        isCrossChain: info.isCrossChain,
        addedAt: Date.now(),
      };
      setPendingActivities(prev => [pending, ...prev]);

      // Highlight affected tokens
      const affected = new Set<string>();
      if (info.outToken) affected.add(info.outToken.symbol.toUpperCase());
      if (info.inToken) affected.add(info.inToken.symbol.toUpperCase());
      setHighlightedTokens(affected);
      setTimeout(() => setHighlightedTokens(new Set()), 180_000);

      // Zerion's indexer routinely lags a confirmed tx by more than 15s, so one
      // refetch left the swap stuck as "in progress". Poll with backoff instead,
      // and stop as soon as the tx shows up in activity.
      TX_REFRESH_DELAYS.forEach(delay => {
        setTimeout(() => {
          if (resolvedTxRef.current.has(info.txHash.toLowerCase())) return;
          fetchPortfolio();
          fetchActivity();
        }, delay);
      });

      // Auto-drop pending after 2 minutes
      setTimeout(() => {
        setPendingActivities(prev => prev.filter(p => p.id !== info.txHash));
        setHighlightedTokens(new Set());
      }, 120_000);
    },
    [fetchPortfolio, fetchActivity],
  );

  const handlePendingMatched = useCallback((txHash: string) => {
    resolvedTxRef.current.add(txHash.toLowerCase()); // stops the backoff refetches
    setPendingActivities(prev => prev.filter(p => p.txHash.toLowerCase() !== txHash.toLowerCase()));
  }, []);

  // ─── Saved actions (re-runnable mini frontends) ──────────────────────────

  const { savedActions, saveAction, removeAction, isSaved } = useSavedActions(address);

  // The best human label for a card is what the user asked for — the last user
  // message before it in the chat.
  const labelForCard = useCallback(
    (cardIndex: number): string => {
      for (let j = cardIndex - 1; j >= 0; j--) {
        if (messages[j].role === "user") {
          const text = messages[j].content.replace(/^↻\s*/, "").replace(/\s+/g, " ").trim();
          return text.length > 48 ? `${text.slice(0, 45)}…` : text || "Saved action";
        }
      }
      return "Saved action";
    },
    [messages],
  );

  // Raw build-tool output from /api/requote: either a single transaction or a
  // multistep {steps} flow (an ERC-20 swap whose approvals were spent rebuilds
  // as a single tx — the tool sees the allowances and skips the approve steps).
  type RebuildResult = {
    to?: string;
    data?: string;
    value?: string;
    chainId?: number;
    steps?: MultiStepTransactionData["steps"];
    delay?: number;
    note?: string;
    quote?: NonNullable<ChatMessage["transaction"]>["quote"];
    requote?: { tool: string; args: Record<string, unknown> };
    simulation?: { success?: boolean; changes?: { direction: string; symbol: string; amount: string }[] };
    error?: string;
  };

  const runAction = useCallback(
    async (label: string, requote: SavedAction["requote"], description?: string) => {
      if (isProcessing) return;
      setMessages(prev => [...prev, { role: "user", content: `↻ ${label}`, timestamp: Date.now() }]);
      setIsProcessing(true);
      setProgressSteps(["Rebuilding at the current market price"]);
      try {
        const res = await fetch("/api/requote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requote }),
        });
        const fresh: RebuildResult = await res.json();
        if (!res.ok || fresh.error) throw new Error(fresh.error || "rebuild failed");

        let assistantMsg: ChatMessage;
        if (Array.isArray(fresh.steps) && fresh.steps.length > 0) {
          assistantMsg = {
            role: "assistant",
            content: fresh.note || "Ready — approvals first, then the swap.",
            multistepTransaction: {
              message: "",
              steps: fresh.steps,
              delay: fresh.delay || 3000,
              requote: fresh.requote ?? requote,
            },
            timestamp: Date.now(),
          };
        } else if (fresh.to && fresh.data) {
          assistantMsg = {
            role: "assistant",
            content: "Rebuilt at the current market price.",
            transaction: {
              to: fresh.to,
              data: fresh.data,
              value: fresh.value ?? "0",
              chainId: fresh.chainId ?? 1,
              description: description || label,
              simulation: fresh.simulation?.success
                ? {
                    verified: true,
                    changes: (fresh.simulation.changes || []).filter(
                      (c): c is { direction: "in" | "out"; symbol: string; amount: string } =>
                        c.direction === "in" || c.direction === "out",
                    ),
                  }
                : undefined,
              requote: fresh.requote ?? requote,
              quote: fresh.quote,
            },
            timestamp: Date.now(),
          };
        } else {
          throw new Error("the build tool returned no transaction");
        }
        setMessages(prev => [...prev, assistantMsg]);
      } catch (e) {
        setMessages(prev => [
          ...prev,
          {
            role: "assistant",
            content: `Couldn't rebuild "${label}" — ${e instanceof Error ? e.message : "unknown error"}. Ask me in chat and I'll build it fresh.`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsProcessing(false);
        setProgressSteps([]);
      }
    },
    [isProcessing],
  );

  // ─── handleSubmit ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!message.trim() || !address || !subject || !isAuthed || !hasCvSig) return;

    const userMsg: ChatMessage = { role: "user", content: message, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setMessage("");
    setIsProcessing(true);

    setProgressSteps([]);
    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          message,
          address: subject, // the wallet under discussion — not necessarily the viewer's
          viewOnly: readOnly, // server refuses to build calldata for a wallet you don't own
          portfolio,
          defiPositions,
          cvSignature,
          cvWallet, // the address larv.ai should charge (may differ from operating wallet)
          recentMessages: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          recentActivity: activity.slice(0, 50),
          stream: true, // ask for SSE progress; server falls back to JSON if it can't
        }),
      });

      // The server answers with SSE when the agent can report progress, and with
      // plain JSON otherwise (Bankr fallback, bridge down) — handle both.
      let data: IntentResponse;
      if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
        data = await consumeIntentStream(res.body, step => setProgressSteps(prev => [...prev, step]));
      } else {
        data = await res.json();
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.message || "Something went wrong",
        transaction: !readOnly && data.type === "transaction" ? data.transaction : undefined,
        multistepTransaction:
          !readOnly && data.type === "multistep_transaction" && data.steps
            ? {
                message: data.message || "Transaction ready",
                steps: data.steps,
                delay: data.delay || 65000,
                priceEth: data.priceEth,
                priceWei: data.priceWei,
                requote: data.requote,
              }
            : undefined,
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
    <div className="flex items-center flex-col flex-grow pt-2" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="px-5 w-full max-w-7xl">
        {!isConnected ? (
          <div
            className="fixed inset-0 flex flex-col items-center justify-center gap-8"
            style={{
              backgroundImage: "url('/coins-bg.jpg')",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {/* Dark overlay so text is readable */}
            <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.55)" }} />
            <GoldParticles foreground={true} />
            <div className="relative z-10 flex flex-col items-center gap-6">
              <h1
                className="font-[family-name:var(--font-cinzel)] text-5xl sm:text-7xl font-bold tracking-[0.3em] text-center"
                style={{ color: "#C9A84C", textShadow: "0 2px 24px rgba(0,0,0,0.8)" }}
              >
                DENARAI
              </h1>
              <p
                className="font-[family-name:var(--font-cinzel)] text-lg sm:text-xl tracking-[0.25em] text-center"
                style={{ color: "#E8E4DC", textShadow: "0 1px 12px rgba(0,0,0,0.9)" }}
              >
                {readOnly ? "talk to any wallet" : "talk to your coins"}
              </p>
              {readOnly && (
                <div className="flex flex-col items-center gap-2 text-center">
                  <span
                    className="font-[family-name:var(--font-jetbrains)] text-base sm:text-lg break-all px-4"
                    style={{ color: "#C9A84C", textShadow: "0 1px 12px rgba(0,0,0,0.9)" }}
                  >
                    {subjectLabel}
                  </span>
                  <span className="text-sm" style={{ color: "#8A8578", textShadow: "0 1px 12px rgba(0,0,0,0.9)" }}>
                    Connect a wallet with credits to inspect it
                  </span>
                </div>
              )}
              <div className="h-px w-48" style={{ backgroundColor: "rgba(201, 168, 76, 0.3)" }} />
              <RainbowKitCustomConnectButton />
              <Link
                href="/pay"
                className="text-sm no-underline hover:underline"
                style={{ color: "#8A8578", textShadow: "0 1px 12px rgba(0,0,0,0.9)" }}
              >
                or pay with <span style={{ color: "#C9A84C" }}>USDC</span>
              </Link>
            </div>
          </div>
        ) : cvChargeError ? (
          // Charge failed — block the app
          <div
            className="fixed inset-0 flex flex-col items-center justify-center gap-6"
            style={{ backgroundColor: "#0a0a0a" }}
          >
            <GoldParticles foreground={true} />
            <div className="relative z-10 flex flex-col items-center gap-4 text-center px-6 max-w-sm">
              <span style={{ fontSize: "3rem" }}>⚠️</span>
              <h2
                className="font-[family-name:var(--font-cinzel)] text-2xl font-bold tracking-[0.15em]"
                style={{ color: "#C9A84C" }}
              >
                Insufficient Balance
              </h2>
              <p className="text-sm" style={{ color: "#8A8578", lineHeight: "1.6" }}>
                Denarai costs <strong style={{ color: "#E8E4DC" }}>5,000 CV</strong> or{" "}
                <strong style={{ color: "#E8E4DC" }}>$0.001 USDC</strong> per page load.
              </p>
              <Link
                href="/pay"
                className="px-6 py-2 font-[family-name:var(--font-cinzel)] text-sm font-bold tracking-[0.15em] no-underline"
                style={{
                  color: "#0a0a0a",
                  backgroundColor: "#C9A84C",
                  border: "1px solid #C9A84C",
                }}
              >
                TOP UP WITH USDC
              </Link>
              <p className="text-sm" style={{ color: "#8A8578", lineHeight: "1.6" }}>
                or stake $CLAWD on{" "}
                <a
                  href="https://larv.ai/stake"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#C9A84C", textDecoration: "underline" }}
                >
                  larv.ai
                </a>{" "}
                to earn CV.
              </p>
              {cvBalance !== null && (
                <p className="text-xs" style={{ color: "#8A8578" }}>
                  Your balance: <strong style={{ color: "#E8E4DC" }}>{cvBalance.toLocaleString()} CV</strong>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <GoldParticles foreground={false} />
            {readOnly && (
              <div
                className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 mb-2"
                style={{ backgroundColor: "#111111", border: "1px solid rgba(201, 168, 76, 0.15)" }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="text-[10px] tracking-[0.2em] uppercase px-2 py-1 shrink-0"
                    style={{ color: "#C9A84C", border: "1px solid rgba(201, 168, 76, 0.35)" }}
                  >
                    Read only
                  </span>
                  <span
                    className="font-[family-name:var(--font-jetbrains)] text-sm truncate"
                    style={{ color: "#E8E4DC" }}
                    title={subject}
                  >
                    {subjectLabel}
                  </span>
                  {isOwnWallet && (
                    <span className="text-xs shrink-0" style={{ color: "#8A8578" }}>
                      (this is your wallet)
                    </span>
                  )}
                </div>
                <Link href="/" className="text-xs no-underline hover:underline shrink-0" style={{ color: "#C9A84C" }}>
                  {isOwnWallet ? "open the full assistant →" : "← your wallet"}
                </Link>
              </div>
            )}
            <div
              className="flex flex-col lg:flex-row gap-4"
              style={{ height: readOnly ? "calc(100vh - 126px)" : "calc(100vh - 80px)" }}
            >
              {/* LEFT SIDEBAR: Portfolio */}
              <div className="w-full lg:w-72 shrink-0 space-y-4 overflow-y-auto">
                <div
                  className="p-4 space-y-4"
                  style={{
                    backgroundColor: "#111111",
                    border: "1px solid rgba(201, 168, 76, 0.15)",
                  }}
                >
                  {/* Total + daily change header */}
                  <div>
                    {isLoadingPortfolio ? (
                      <div className="flex items-center gap-2">
                        <span className="loading loading-spinner loading-sm" style={{ color: "#C9A84C" }}></span>
                        <span className="text-sm" style={{ color: "#8A8578" }}>
                          Loading...
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-[family-name:var(--font-jetbrains)] text-2xl font-light"
                          style={{ color: "#E8E4DC" }}
                        >
                          {formatUsdValue(grandTotal)}
                        </span>
                        {changeUsd !== 0 && (
                          <span
                            className="font-[family-name:var(--font-jetbrains)] text-sm"
                            style={{ color: isChangeNegative ? "#9B3D3D" : "#C9A84C" }}
                          >
                            {isChangeNegative ? "" : "+"}
                            {changePct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* WALLET section */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs tracking-[0.2em] uppercase" style={{ color: "#8A8578" }}>
                        Wallet
                      </span>
                      <span className="font-[family-name:var(--font-jetbrains)] text-sm" style={{ color: "#8A8578" }}>
                        {formatUsdValue(walletTotal)}
                      </span>
                    </div>

                    {isLoadingPortfolio ? (
                      <div className="text-center py-4" style={{ color: "#8A8578" }}>
                        Loading assets...
                      </div>
                    ) : portfolio.length === 0 ? (
                      <div className="text-center py-4" style={{ color: "#8A8578" }}>
                        No assets found
                      </div>
                    ) : (
                      <div className="space-y-0">
                        {displayedAssets.map((asset, i) => {
                          const isHighlighted = highlightedTokens.has(asset.tokenSymbol.toUpperCase());
                          return (
                            <div
                              key={`${asset.blockchain}-${asset.contractAddress || "native"}-${i}`}
                              className="flex items-center justify-between py-2 px-2 -mx-2 transition-colors duration-300 hover:bg-white/[0.02] cursor-pointer"
                              style={{
                                borderBottom: "1px solid rgba(201, 168, 76, 0.06)",
                                backgroundColor: isHighlighted ? "rgba(201, 168, 76, 0.06)" : undefined,
                              }}
                              onClick={() =>
                                openModal({
                                  type: "portfolio_position",
                                  symbol: asset.tokenSymbol,
                                  tokenName: asset.tokenName,
                                  chain: asset.blockchain,
                                  balance: asset.balance,
                                  balanceUsd: asset.balanceUsd,
                                  contractAddress: asset.contractAddress,
                                  thumbnail: asset.thumbnail,
                                  protocol: asset.protocol ?? undefined,
                                  positionType: asset.positionType,
                                  walletAddress: subject,
                                })
                              }
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
                                            "w-7 h-7 flex items-center justify-center text-xs font-bold absolute inset-0";
                                          fallback.style.backgroundColor = "#111111";
                                          fallback.style.border = "1px solid rgba(201, 168, 76, 0.2)";
                                          fallback.style.color = "#C9A84C";
                                          fallback.textContent = asset.tokenSymbol.slice(0, 2);
                                          parent.appendChild(fallback);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className="w-7 h-7 flex items-center justify-center text-xs font-[family-name:var(--font-cinzel)] font-semibold"
                                      style={{
                                        backgroundColor: "#111111",
                                        border: "1px solid rgba(201, 168, 76, 0.2)",
                                        color: "#C9A84C",
                                      }}
                                    >
                                      {asset.tokenSymbol.slice(0, 1)}
                                    </div>
                                  )}
                                  {CHAIN_ICONS[asset.blockchain] && (
                                    <img
                                      src={CHAIN_ICONS[asset.blockchain]}
                                      alt={asset.blockchain}
                                      className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2"
                                      style={{ borderColor: "#111111" }}
                                    />
                                  )}
                                </div>
                                <div>
                                  <div className="text-sm" style={{ color: "#E8E4DC" }}>
                                    {asset.tokenSymbol}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right flex items-center gap-1 justify-end">
                                {isHighlighted && (
                                  <span
                                    className="loading loading-dots loading-xs"
                                    style={{ color: "#C9A84C", width: "12px" }}
                                  />
                                )}
                                <div
                                  className="font-[family-name:var(--font-jetbrains)] text-sm"
                                  style={{ color: "#E8E4DC" }}
                                >
                                  {formatUsdValue(asset.balanceUsd)}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {!showAllAssets && hiddenCount > 0 && (
                          <button
                            className="w-full text-center text-sm py-2 transition-colors cursor-pointer"
                            style={{ color: "#C9A84C" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "#B8963E")}
                            onMouseLeave={e => (e.currentTarget.style.color = "#C9A84C")}
                            onClick={() => setShowAllAssets(true)}
                          >
                            and {hiddenCount} more...
                          </button>
                        )}
                        {showAllAssets && hiddenCount > 0 && (
                          <button
                            className="w-full text-center text-sm py-2 transition-colors cursor-pointer"
                            style={{ color: "#C9A84C" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "#B8963E")}
                            onMouseLeave={e => (e.currentTarget.style.color = "#C9A84C")}
                            onClick={() => setShowAllAssets(false)}
                          >
                            Show less
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* PORTFOLIO (DeFi) section */}
                  {defiPositions.length > 0 && (
                    <>
                      <div className="h-px" style={{ backgroundColor: "rgba(201, 168, 76, 0.15)" }} />
                      <div>
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs tracking-[0.2em] uppercase" style={{ color: "#8A8578" }}>
                            Portfolio
                          </span>
                          <span
                            className="font-[family-name:var(--font-jetbrains)] text-sm"
                            style={{ color: "#8A8578" }}
                          >
                            {formatUsdValue(defiTotal)}
                          </span>
                        </div>
                        <div className="space-y-0">
                          {defiPositions.map((pos, i) => (
                            <div
                              key={`defi-${pos.blockchain}-${pos.contractAddress || pos.tokenSymbol}-${i}`}
                              className="flex items-center justify-between py-1.5 px-2 -mx-2 transition-colors duration-300 hover:bg-white/[0.02] cursor-pointer"
                              style={{
                                borderBottom: "1px solid rgba(201, 168, 76, 0.06)",
                              }}
                              onClick={() =>
                                openModal({
                                  type: "portfolio_position",
                                  symbol: pos.tokenSymbol,
                                  tokenName: pos.tokenName,
                                  chain: pos.blockchain,
                                  balance: pos.balance,
                                  balanceUsd: pos.balanceUsd,
                                  contractAddress: pos.contractAddress,
                                  thumbnail: pos.thumbnail,
                                  protocol: pos.protocol ?? undefined,
                                  positionType: pos.positionType,
                                  walletAddress: subject,
                                })
                              }
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
                                      className="w-7 h-7 flex items-center justify-center text-xs font-[family-name:var(--font-cinzel)] font-semibold"
                                      style={{
                                        backgroundColor: "#111111",
                                        border: "1px solid rgba(201, 168, 76, 0.2)",
                                        color: "#C9A84C",
                                      }}
                                    >
                                      {pos.tokenSymbol.slice(0, 1)}
                                    </div>
                                  )}
                                  {CHAIN_ICONS[pos.blockchain] && (
                                    <img
                                      src={CHAIN_ICONS[pos.blockchain]}
                                      alt={pos.blockchain}
                                      className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                                      style={{ borderColor: "#111111" }}
                                    />
                                  )}
                                </div>
                                <div>
                                  <div className="text-xs" style={{ color: "#E8E4DC" }}>
                                    {pos.tokenSymbol}
                                  </div>
                                  <div className="text-[10px] capitalize" style={{ color: "#8A8578" }}>
                                    {pos.positionType}
                                    {pos.protocol ? ` · ${pos.protocol}` : ""}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div
                                  className="font-[family-name:var(--font-jetbrains)] text-xs"
                                  style={{ color: "#E8E4DC" }}
                                >
                                  {formatUsdValue(pos.balanceUsd)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
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
                      className="btn btn-ghost btn-xs transition-colors cursor-pointer"
                      style={{ color: "#8A8578" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#9B3D3D")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#8A8578")}
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
                    <div className="text-center mt-20 flex flex-col items-center gap-6">
                      <p
                        className="font-[family-name:var(--font-cinzel)] text-xl tracking-[0.2em]"
                        style={{ color: "#8A8578" }}
                      >
                        {readOnly ? `Ask about ${subjectLabel}` : "Speak your desires"}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-4 w-full max-w-2xl">
                        {(readOnly ? VIEW_SUGGESTIONS : OWNER_SUGGESTIONS).map(group => (
                          <div key={group.category} className="flex flex-col gap-1.5">
                            <span
                              className="font-[family-name:var(--font-cinzel)] uppercase text-[10px] tracking-[0.2em] mb-1 text-left"
                              style={{ color: "#8A8578" }}
                            >
                              {group.category}
                            </span>
                            {group.suggestions.map(suggestion => (
                              <button
                                key={suggestion}
                                className="text-sm px-4 py-2.5 text-left transition-colors cursor-pointer"
                                style={{
                                  border: "1px solid rgba(201, 168, 76, 0.2)",
                                  color: "#8A8578",
                                  backgroundColor: "transparent",
                                  fontFamily: "var(--font-jetbrains)",
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.borderColor = "rgba(201, 168, 76, 0.5)";
                                  e.currentTarget.style.color = "#C9A84C";
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.borderColor = "rgba(201, 168, 76, 0.2)";
                                  e.currentTarget.style.color = "#8A8578";
                                }}
                                onClick={() => setMessage(suggestion)}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[85%] px-3 py-1.5"
                        style={
                          msg.role === "user"
                            ? {
                                backgroundColor: "rgba(201, 168, 76, 0.15)",
                                border: "1px solid rgba(201, 168, 76, 0.2)",
                                color: "#E8E4DC",
                              }
                            : {
                                backgroundColor: "#111111",
                                border: "1px solid rgba(201, 168, 76, 0.08)",
                                color: "#E8E4DC",
                              }
                        }
                      >
                        {msg.role === "assistant" ? (
                          <ChatMessageRenderer content={msg.content} portfolio={portfolio} />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap leading-snug m-0">{msg.content}</p>
                        )}

                        {msg.multistepTransaction && (
                          <MultiStepTransactionCard
                            tx={msg.multistepTransaction}
                            address={address!}
                            onConfirmed={handleTxConfirmed}
                            onSave={
                              msg.multistepTransaction.requote
                                ? () =>
                                    saveAction({
                                      label: labelForCard(i),
                                      requote: msg.multistepTransaction!.requote!,
                                      chainId: msg.multistepTransaction!.steps[0]?.chainId,
                                      description: msg.multistepTransaction!.steps.at(-1)?.description,
                                    })
                                : undefined
                            }
                            saved={msg.multistepTransaction.requote ? isSaved(msg.multistepTransaction.requote) : false}
                            onRerun={
                              msg.multistepTransaction.requote
                                ? () =>
                                    runAction(
                                      labelForCard(i),
                                      msg.multistepTransaction!.requote!,
                                      msg.multistepTransaction!.steps.at(-1)?.description,
                                    )
                                : undefined
                            }
                          />
                        )}

                        {msg.transaction && !msg.multistepTransaction && (
                          <TransactionCard
                            tx={msg.transaction}
                            address={address!}
                            onConfirmed={handleTxConfirmed}
                            onSave={
                              msg.transaction.requote
                                ? () =>
                                    saveAction({
                                      label: labelForCard(i),
                                      requote: msg.transaction!.requote!,
                                      chainId: msg.transaction!.chainId,
                                      description: msg.transaction!.description,
                                    })
                                : undefined
                            }
                            saved={msg.transaction.requote ? isSaved(msg.transaction.requote) : false}
                            onRerun={
                              msg.transaction.requote
                                ? () =>
                                    runAction(labelForCard(i), msg.transaction!.requote!, msg.transaction!.description)
                                : undefined
                            }
                            onTxHash={(hash: `0x${string}`) => {
                              setMessages(prev =>
                                prev.map((m, idx) =>
                                  idx === i && m.transaction
                                    ? { ...m, transaction: { ...m.transaction, txHash: hash } }
                                    : m,
                                ),
                              );
                            }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                  {isProcessing && (
                    <div className="flex justify-start">
                      <div
                        className="px-3 py-1.5 space-y-1"
                        style={{
                          backgroundColor: "#111111",
                          border: "1px solid rgba(201, 168, 76, 0.08)",
                        }}
                      >
                        {/* What it's actually doing — a swap is ~2min of tool calls */}
                        {progressSteps.map((step, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs font-[family-name:var(--font-jetbrains)]"
                            style={{ color: i === progressSteps.length - 1 ? "#C9A84C" : "rgba(232,224,208,0.35)" }}
                          >
                            <span>{i === progressSteps.length - 1 ? "▸" : "✓"}</span>
                            <span>{step}</span>
                          </div>
                        ))}
                        <span className="loading loading-dots loading-sm" style={{ color: "#C9A84C" }}></span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input — sticky bottom */}
                <div className="sticky bottom-0 pb-4 pt-2" style={{ backgroundColor: "#0a0a0a" }}>
                  {/* Saved actions rail — each chip rebuilds its transaction at
                      the current market price (no agent turn, no charge) */}
                  {!readOnly && savedActions.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                      {savedActions.map(a => (
                        <div
                          key={a.id}
                          className="flex items-center shrink-0"
                          style={{
                            border: "1px solid rgba(201, 168, 76, 0.25)",
                            backgroundColor: "#111111",
                          }}
                        >
                          <button
                            className="text-xs pl-3 pr-1.5 py-1.5 cursor-pointer disabled:opacity-40"
                            style={{ color: "#C9A84C", fontFamily: "var(--font-jetbrains)" }}
                            onClick={() => runAction(a.label, a.requote, a.description)}
                            disabled={isProcessing}
                            title={a.description || "Rebuild at the current market price"}
                          >
                            ▶ {a.label}
                          </button>
                          <button
                            className="text-xs px-2 py-1.5 cursor-pointer"
                            style={{ color: "rgba(138, 133, 120, 0.6)" }}
                            onClick={() => removeAction(a.id)}
                            title="Remove from saved actions"
                            aria-label={`Remove ${a.label}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={
                        mounted && isCvSigning
                          ? "Please sign the message in your wallet..."
                          : mounted && !isAuthed
                            ? "Connect your wallet to continue"
                            : readOnly
                              ? `Ask anything about ${subjectLabel} — read only, no transactions`
                              : "Your wealth awaits instruction. What is your will, ser?"
                      }
                      className="flex-1 text-base px-4 py-2"
                      style={{
                        backgroundColor: "#111111",
                        border: "1px solid rgba(201, 168, 76, 0.15)",
                        color: "#E8E4DC",
                        outline: "none",
                        opacity: mounted && !isAuthed ? 0.5 : 1,
                      }}
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !isProcessing && (!mounted || isAuthed) && handleSubmit()}
                      disabled={isProcessing || (mounted && !isAuthed)}
                    />
                    <button
                      className="px-6 py-2 relative overflow-hidden gold-btn cursor-pointer"
                      onClick={handleSubmit}
                      disabled={isProcessing || !message.trim()}
                    >
                      {isProcessing ? (
                        <span className="loading loading-spinner loading-sm"></span>
                      ) : (
                        <span className="font-[family-name:var(--font-cinzel)] text-sm relative z-10">→</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT SIDEBAR: Activity */}
              <div className="w-full lg:w-80 shrink-0 overflow-y-auto">
                <ActivityPanel
                  address={subject!}
                  initialItems={activity}
                  pendingActivities={pendingActivities}
                  onPendingMatched={handlePendingMatched}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WalletWorkspace;
