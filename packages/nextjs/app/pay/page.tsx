"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { erc20Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import GoldParticles from "~~/components/GoldParticles";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useCvAuth } from "~~/hooks/useCvAuth";
import { formatUsdc, useUsdcCredits } from "~~/hooks/useUsdcCredits";

type PayConfig = {
  chainId: number;
  usdcAddress: `0x${string}`;
  treasury: `0x${string}` | null;
  operator: `0x${string}` | null;
  costs: { pageLoadMicro: number; chatMicro: number };
  tiers: { tier: string; price: string; amountMicro: number }[];
};

type Status =
  | { kind: "idle" }
  | { kind: "busy"; text: string }
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string }
  | { kind: "needFunds"; text: string };

const GOLD = "#C9A84C";
const CREAM = "#E8E4DC";
const MUTED = "#8A8578";

const PayPage = () => {
  const { address, isConnected, chainId: connectedChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { cvSignature, cvWallet, hasCvSig, isCvSigning, signCv } = useCvAuth();

  const creditWallet = (cvWallet || address || "").toLowerCase();
  const { usdcMicro, autoTopup, refresh } = useUsdcCredits(isConnected ? creditWallet : null);

  const isAuthed = hasCvSig && !!cvSignature;
  const authHeaders = useMemo(
    () =>
      isAuthed && cvWallet && cvSignature
        ? {
            "x-denarai-cv-wallet": cvWallet,
            "x-denarai-cv-sig": cvSignature,
            "x-denarai-address": address || cvWallet,
          }
        : null,
    [isAuthed, cvWallet, cvSignature, address],
  );

  const [config, setConfig] = useState<PayConfig | null>(null);
  // Pin reads to the payment chain (Base). The default client follows whatever
  // chain the wallet is on — on mainnet the Base USDC address isn't a contract,
  // so balanceOf "returns no data (0x)" and every pre-flight check explodes.
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const [topupStatus, setTopupStatus] = useState<Status>({ kind: "idle" });
  const [customAmount, setCustomAmount] = useState("");
  const [autoStatus, setAutoStatus] = useState<Status>({ kind: "idle" });
  const [autoAmount, setAutoAmount] = useState("5");
  // Wallet's spendable USDC on Base — what top-ups are actually paid from. Shown
  // because a $0 balance is the most common reason a top-up can't settle.
  const [walletUsdcMicro, setWalletUsdcMicro] = useState<number | null>(null);
  // Auto top-up needs a server-side operator wallet to pull funds; without one
  // the API returns 503, so don't present it as usable.
  const autoAvailable = !!config?.operator;

  useEffect(() => {
    fetch("/api/credits/config")
      .then(r => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const refreshWalletUsdc = useCallback(async () => {
    if (!publicClient || !config || !address) return setWalletUsdcMicro(null);
    try {
      const bal = (await publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      setWalletUsdcMicro(Number(bal));
    } catch {
      setWalletUsdcMicro(null);
    }
  }, [publicClient, config, address]);

  useEffect(() => {
    refreshWalletUsdc();
  }, [refreshWalletUsdc]);

  // Prompt for the CV sig once connected — same ceremony the main page uses
  useEffect(() => {
    if (isConnected && walletClient && !hasCvSig && !isCvSigning) signCv();
  }, [isConnected, walletClient, hasCvSig, isCvSigning, signCv]);

  const ensureChain = useCallback(async () => {
    if (!config) throw new Error("config not loaded");
    if (connectedChainId !== config.chainId) {
      await switchChainAsync({ chainId: config.chainId });
    }
  }, [config, connectedChainId, switchChainAsync]);

  // ── Gasless x402 top-up: sign an EIP-3009 authorization, facilitator pays gas ──
  const payTier = useCallback(
    async (tier: string, price: string) => {
      if (!walletClient || !publicClient || !config) return;
      setTopupStatus({ kind: "busy", text: `Preparing ${price} top-up…` });
      try {
        await ensureChain();

        // Pre-flight the payer's USDC balance. Without this the facilitator
        // rejects the signed authorization and the only thing we can report is a
        // bare "402" — after asking the user to sign something that can't settle.
        // If the RPC read itself fails, skip the pre-flight rather than surface
        // raw viem internals; the 402 path below still catches a real shortfall.
        const amountMicro = BigInt(config.tiers.find(t => t.tier === tier)?.amountMicro ?? 0);
        let usdcBalance: bigint | null = null;
        try {
          usdcBalance = (await publicClient.readContract({
            address: config.usdcAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletClient.account.address],
          })) as bigint;
        } catch {
          /* balance unknown — proceed and let the facilitator decide */
        }
        if (usdcBalance !== null && usdcBalance < amountMicro) {
          const have = (Number(usdcBalance) / 1e6).toFixed(2);
          setTopupStatus({
            kind: "needFunds",
            text: `You have $${have} USDC on Base — a ${price} top-up needs more.`,
          });
          return;
        }

        const [{ x402Client, wrapFetchWithPayment }, { registerExactEvmScheme }, { toClientEvmSigner }] =
          await Promise.all([import("@x402/fetch"), import("@x402/evm/exact/client"), import("@x402/evm")]);

        const signer = toClientEvmSigner(
          {
            address: walletClient.account.address as `0x${string}`,
            signTypedData: m =>
              walletClient.signTypedData({ ...m, account: walletClient.account } as Parameters<
                typeof walletClient.signTypedData
              >[0]) as Promise<`0x${string}`>,
          },
          publicClient,
        );

        const client = new x402Client();
        registerExactEvmScheme(client, { signer });
        const fetchWithPay = wrapFetchWithPayment(fetch, client);

        setTopupStatus({ kind: "busy", text: "Waiting for signature…" });
        const res = await fetchWithPay(`/api/credits/topup/x402/${tier}?creditWallet=${creditWallet}`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          // x402 v2 carries the reason in a base64 `payment-required` header; the
          // JSON body is empty, so body.error alone leaves the user with "(402)".
          let headerError: string | undefined;
          try {
            const raw = res.headers.get("payment-required");
            if (raw) headerError = JSON.parse(atob(raw))?.error;
          } catch {
            /* header absent or unparseable — fall through */
          }
          throw new Error(body.error || headerError || `payment failed (${res.status})`);
        }
        setTopupStatus({ kind: "ok", text: `${price} credited — no gas needed.` });
        setTimeout(refresh, 1500);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "payment failed";
        // The facilitator's own shortfall rejection deserves the same friendly
        // path as our pre-flight, not a raw error string.
        if (/insufficient|not enough/i.test(msg)) {
          setTopupStatus({ kind: "needFunds", text: "Not enough USDC on Base for this top-up." });
        } else {
          setTopupStatus({ kind: "error", text: msg });
        }
      }
    },
    [walletClient, publicClient, config, ensureChain, creditWallet, refresh],
  );

  // ── Plain USDC transfer top-up (any amount; costs gas) ──
  const payCustom = useCallback(async () => {
    if (!walletClient || !publicClient || !config?.treasury || !authHeaders) return;
    const dollars = parseFloat(customAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setTopupStatus({ kind: "error", text: "enter a valid USDC amount" });
      return;
    }
    setTopupStatus({ kind: "busy", text: `Sending ${dollars.toFixed(2)} USDC…` });
    try {
      await ensureChain();
      const micro = parseUnits(dollars.toFixed(6), 6);

      const txHash = await walletClient.writeContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [config.treasury, micro],
        account: walletClient.account,
        chain: walletClient.chain,
      });

      setTopupStatus({ kind: "busy", text: "Waiting for confirmation…" });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // If paying from a different wallet than the credited one, sign the delegation
      let senderSig: string | undefined;
      if (address && address.toLowerCase() !== creditWallet) {
        setTopupStatus({ kind: "busy", text: "Sign to credit your Denarai account…" });
        senderSig = await walletClient.signMessage({
          account: walletClient.account,
          message: `denar.ai USDC credit to ${creditWallet}`,
        });
      }

      setTopupStatus({ kind: "busy", text: "Crediting your balance…" });
      // The server wants a couple of confirmations — retry briefly
      for (let attempt = 0; attempt < 8; attempt++) {
        const res = await fetch("/api/credits/topup/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ txHash, senderSig }),
        });
        const data = await res.json();
        if (data.success) {
          setTopupStatus({ kind: "ok", text: `${dollars.toFixed(2)} USDC credited.` });
          setCustomAmount("");
          setTimeout(refresh, 1000);
          return;
        }
        if (!data.retry) throw new Error(data.error || "verification failed");
        await new Promise(r => setTimeout(r, 2500));
      }
      throw new Error("verification timed out — your funds are safe; retry from this page");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "transfer failed";
      setTopupStatus({ kind: "error", text: msg });
    }
  }, [walletClient, publicClient, config, authHeaders, customAmount, ensureChain, address, creditWallet, refresh]);

  // ── Auto top-up: approve the operator, then store prefs ──
  const enableAutoTopup = useCallback(async () => {
    if (!walletClient || !publicClient || !config?.operator || !authHeaders || !address) return;
    const dollars = parseFloat(autoAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setAutoStatus({ kind: "error", text: "enter a valid top-up amount" });
      return;
    }
    setAutoStatus({ kind: "busy", text: "Checking allowance…" });
    try {
      await ensureChain();
      const amountMicro = Number(parseUnits(dollars.toFixed(6), 6));
      // Approve 20 top-ups worth so the approval doesn't need constant renewal
      const approvalMicro = BigInt(amountMicro) * 20n;

      const allowance = await publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, config.operator],
      });

      if (allowance < BigInt(amountMicro)) {
        setAutoStatus({ kind: "busy", text: "Approve USDC in your wallet…" });
        const txHash = await walletClient.writeContract({
          address: config.usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [config.operator, approvalMicro],
          account: walletClient.account,
          chain: walletClient.chain,
        });
        setAutoStatus({ kind: "busy", text: "Waiting for approval confirmation…" });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      setAutoStatus({ kind: "busy", text: "Saving…" });
      const res = await fetch("/api/credits/autotopup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ enabled: true, amountMicro, fromWallet: address }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "failed to save");
      setAutoStatus({ kind: "ok", text: `Auto top-up on: $${dollars.toFixed(2)} whenever your balance runs out.` });
      setTimeout(refresh, 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed to enable";
      setAutoStatus({ kind: "error", text: msg });
    }
  }, [walletClient, publicClient, config, authHeaders, address, autoAmount, ensureChain, refresh]);

  const disableAutoTopup = useCallback(async () => {
    if (!authHeaders) return;
    setAutoStatus({ kind: "busy", text: "Disabling…" });
    try {
      const res = await fetch("/api/credits/autotopup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ enabled: false }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "failed to disable");
      setAutoStatus({ kind: "ok", text: "Auto top-up disabled." });
      setTimeout(refresh, 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed to disable";
      setAutoStatus({ kind: "error", text: msg });
    }
  }, [authHeaders, refresh]);

  const statusLine = (s: Status) =>
    s.kind === "idle" ? null : (
      <p
        className="text-xs font-[family-name:var(--font-jetbrains)]"
        style={{
          color: s.kind === "error" ? "#c96b4c" : s.kind === "ok" ? GOLD : s.kind === "needFunds" ? CREAM : MUTED,
        }}
      >
        {s.kind === "busy" ? "⏳ " : s.kind === "ok" ? "✓ " : s.kind === "needFunds" ? "💸 " : "⚠️ "}
        {s.text}
      </p>
    );

  // One-click paths to actually getting USDC on Base — shown wherever we'd
  // otherwise just tell the user their wallet is empty.
  const uniswapUrl = `https://app.uniswap.org/swap?chain=base&inputCurrency=NATIVE&outputCurrency=${
    config?.usdcAddress ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  }`;
  const getUsdcCta = (
    <div className="flex flex-col gap-2">
      <a
        href={uniswapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full py-3 text-center font-[family-name:var(--font-cinzel)] text-sm font-bold tracking-[0.1em] no-underline transition-opacity hover:opacity-90"
        style={{ backgroundColor: GOLD, color: "#0a0a0a" }}
      >
        GET USDC ON UNISWAP ↗
      </a>
      <Link
        href={`/?ask=${encodeURIComponent("Swap some of my ETH into USDC on Base so I can top up my Denarai balance")}`}
        className="block w-full py-3 text-center font-[family-name:var(--font-cinzel)] text-sm tracking-[0.1em] no-underline transition-opacity hover:opacity-90"
        style={{ color: GOLD, border: `1px solid ${GOLD}` }}
      >
        OR ASK DENARAI TO SWAP FOR YOU
      </Link>
    </div>
  );

  const card = (children: React.ReactNode) => (
    <div className="p-6 space-y-4" style={{ backgroundColor: "#111111", border: "1px solid rgba(201, 168, 76, 0.15)" }}>
      {children}
    </div>
  );

  return (
    <div className="flex flex-col items-center flex-grow pt-6 px-5 pb-16" style={{ backgroundColor: "#0a0a0a" }}>
      <GoldParticles foreground={false} />
      <div className="w-full max-w-lg space-y-6 relative z-10">
        <div className="flex items-baseline justify-between">
          <h1
            className="font-[family-name:var(--font-cinzel)] text-2xl font-bold tracking-[0.2em]"
            style={{ color: GOLD }}
          >
            PAY WITH USDC
          </h1>
          <Link href="/" className="text-sm no-underline hover:underline" style={{ color: MUTED }}>
            ← back
          </Link>
        </div>

        {!isConnected ? (
          card(
            <div className="flex flex-col items-center gap-4 py-6">
              <p className="text-sm text-center" style={{ color: MUTED }}>
                Connect your wallet to top up your Denarai balance.
              </p>
              <RainbowKitCustomConnectButton />
            </div>,
          )
        ) : (
          <>
            {/* Balance */}
            {card(
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm" style={{ color: MUTED }}>
                    Your Denarai balance
                  </span>
                  <span className="font-[family-name:var(--font-jetbrains)] text-3xl font-bold" style={{ color: GOLD }}>
                    {usdcMicro !== null ? formatUsdc(usdcMicro) : "—"}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs" style={{ color: MUTED }}>
                    In your wallet (USDC on Base)
                  </span>
                  <span className="font-[family-name:var(--font-jetbrains)] text-sm" style={{ color: CREAM }}>
                    {walletUsdcMicro !== null ? formatUsdc(walletUsdcMicro) : "—"}
                  </span>
                </div>
                {walletUsdcMicro === 0 && (
                  <>
                    <p className="text-xs" style={{ color: MUTED }}>
                      Top-ups are paid from this. You&apos;ll need USDC on Base before one can go through:
                    </p>
                    {getUsdcCta}
                  </>
                )}
                {config && (
                  <p className="text-xs" style={{ color: MUTED }}>
                    Usage costs {formatUsdc(config.costs.pageLoadMicro)} per page load and{" "}
                    {formatUsdc(config.costs.chatMicro)} per chat request — charged only when you have no CV. A $5
                    top-up covers ~{Math.floor(5_000_000 / config.costs.chatMicro).toLocaleString()} requests.
                  </p>
                )}
                {/* Funded — send them to the thing they paid for. */}
                {!!usdcMicro && usdcMicro > 0 && (
                  <Link
                    href="/"
                    className="block w-full py-4 text-center font-[family-name:var(--font-cinzel)] text-base font-bold tracking-[0.15em] no-underline transition-opacity hover:opacity-90"
                    style={{ backgroundColor: GOLD, color: "#0a0a0a" }}
                  >
                    GO TALK TO YOUR COINS →
                  </Link>
                )}
              </>,
            )}

            {/* Gasless x402 tiers */}
            {card(
              <>
                <h2
                  className="font-[family-name:var(--font-cinzel)] text-sm tracking-[0.15em]"
                  style={{ color: CREAM }}
                >
                  TOP UP — GASLESS
                </h2>
                <p className="text-xs" style={{ color: MUTED }}>
                  Pays via x402: you sign once, no ETH needed. USDC on Base.
                </p>
                <div className="flex gap-3">
                  {(config?.tiers || []).map(t => (
                    <button
                      key={t.tier}
                      onClick={() => payTier(t.tier, t.price)}
                      disabled={topupStatus.kind === "busy" || !walletClient}
                      className="flex-1 py-3 font-[family-name:var(--font-cinzel)] font-bold tracking-[0.1em] disabled:opacity-40"
                      style={{ color: "#0a0a0a", backgroundColor: GOLD, border: `1px solid ${GOLD}` }}
                    >
                      {t.price}
                    </button>
                  ))}
                </div>
                {statusLine(topupStatus)}
                {topupStatus.kind === "needFunds" && getUsdcCta}
              </>,
            )}

            {/* Custom amount via plain transfer */}
            {card(
              <>
                <h2
                  className="font-[family-name:var(--font-cinzel)] text-sm tracking-[0.15em]"
                  style={{ color: CREAM }}
                >
                  CUSTOM AMOUNT
                </h2>
                <p className="text-xs" style={{ color: MUTED }}>
                  Sends a normal USDC transfer on Base (costs a little gas), then credits your balance.
                </p>
                <div className="flex gap-3">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="USDC amount"
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    className="flex-1 px-3 py-2 bg-transparent font-[family-name:var(--font-jetbrains)] text-sm outline-none"
                    style={{ border: "1px solid rgba(201, 168, 76, 0.3)", color: CREAM }}
                  />
                  <button
                    onClick={payCustom}
                    disabled={topupStatus.kind === "busy" || !walletClient || !config?.treasury}
                    className="px-6 py-2 font-[family-name:var(--font-cinzel)] text-sm font-bold tracking-[0.1em] disabled:opacity-40"
                    style={{ color: GOLD, backgroundColor: "transparent", border: `1px solid ${GOLD}` }}
                  >
                    SEND
                  </button>
                </div>
              </>,
            )}

            {/* Auto top-up — unavailable until an operator wallet is configured
                server-side, so the whole section greys out rather than offering
                a flow that can only fail. */}
            {card(
              <div
                className={`space-y-4${autoAvailable ? "" : " opacity-40 pointer-events-none select-none"}`}
                aria-disabled={!autoAvailable}
              >
                <div className="flex items-center justify-between">
                  <h2
                    className="font-[family-name:var(--font-cinzel)] text-sm tracking-[0.15em]"
                    style={{ color: CREAM }}
                  >
                    AUTO TOP-UP
                  </h2>
                  {!autoAvailable ? (
                    <span className="text-xs font-[family-name:var(--font-jetbrains)]" style={{ color: MUTED }}>
                      COMING SOON
                    </span>
                  ) : (
                    autoTopup?.enabled && (
                      <span className="text-xs font-[family-name:var(--font-jetbrains)]" style={{ color: GOLD }}>
                        ON · {formatUsdc(autoTopup.amountMicro)}
                      </span>
                    )
                  )}
                </div>
                <p className="text-xs" style={{ color: MUTED }}>
                  Approve our operator to pull USDC from your wallet automatically whenever your balance runs out. You
                  can revoke the approval on-chain at any time.
                </p>
                {autoTopup?.enabled ? (
                  <button
                    onClick={disableAutoTopup}
                    disabled={autoStatus.kind === "busy"}
                    className="px-6 py-2 font-[family-name:var(--font-cinzel)] text-sm tracking-[0.1em] disabled:opacity-40"
                    style={{ color: MUTED, backgroundColor: "transparent", border: `1px solid ${MUTED}` }}
                  >
                    DISABLE
                  </button>
                ) : (
                  <div className="flex gap-3">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="USDC per top-up"
                      value={autoAmount}
                      onChange={e => setAutoAmount(e.target.value)}
                      className="flex-1 px-3 py-2 bg-transparent font-[family-name:var(--font-jetbrains)] text-sm outline-none"
                      style={{ border: "1px solid rgba(201, 168, 76, 0.3)", color: CREAM }}
                    />
                    <button
                      onClick={enableAutoTopup}
                      disabled={autoStatus.kind === "busy" || !walletClient || !config?.operator}
                      className="px-6 py-2 font-[family-name:var(--font-cinzel)] text-sm font-bold tracking-[0.1em] disabled:opacity-40"
                      style={{ color: GOLD, backgroundColor: "transparent", border: `1px solid ${GOLD}` }}
                    >
                      ENABLE
                    </button>
                  </div>
                )}
                {statusLine(autoStatus)}
              </div>,
            )}

            <p className="text-xs text-center" style={{ color: MUTED }}>
              Every top-up buys and burns 🔥 $CLAWD — your USDC is swapped to CLAWD and sent to the dead address, never
              to a treasury.
            </p>

            <p className="text-xs text-center" style={{ color: MUTED }}>
              Prefer staking? Earn CV (used before USDC) by staking $CLAWD on{" "}
              <a
                href="https://larv.ai/stake"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: GOLD, textDecoration: "underline" }}
              >
                larv.ai
              </a>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default PayPage;
