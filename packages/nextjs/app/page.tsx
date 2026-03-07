"use client";

import { useCallback, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { useAccount, useBalance, useConnectorClient, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;

const formatUsd = (ethAmount: string, ethPrice: number): string => {
  const usd = parseFloat(ethAmount) * ethPrice;
  if (usd < 0.01) return "<$0.01";
  return `~$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [intentResult, setIntentResult] = useState<{
    action: string;
    amount: string;
    calldata: { to: string; data: string; value: string };
    explanation: string;
  } | null>(null);
  const [securityResult, setSecurityResult] = useState<{
    safe: boolean;
    explanation: string;
    warnings: string[];
  } | null>(null);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  // ETH balance
  const { data: ethBalanceData } = useBalance({ address });

  // WETH balance via generic balance hook with token
  const { data: wethBalanceData } = useBalance({ address, token: WETH_ADDRESS });

  const { sendTransactionAsync } = useSendTransaction();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const { data: connectorClient } = useConnectorClient();
  const { price: ethPrice } = useFetchNativeCurrencyPrice();

  const ethBalance = ethBalanceData ? formatEther(ethBalanceData.value) : "0";
  const wethBalance = wethBalanceData ? formatEther(wethBalanceData.value) : "0";

  // Mobile deep linking — fire TX first, then open wallet app
  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile || window.ethereum) return; // Skip desktop or in-app browser

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
    setSecurityResult(null);
    setTxHash(undefined);

    try {
      // Step 1: Intent parsing
      const intentRes = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, address, ethBalance, wethBalance }),
      });
      const intent = await intentRes.json();
      if (intent.error) {
        setError(intent.error);
        setIsProcessing(false);
        return;
      }
      setIntentResult(intent);

      // Step 2: Security check
      const secRes = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calldata: intent.calldata, action: intent.action, amount: intent.amount }),
      });
      const sec = await secRes.json();
      if (sec.error) {
        setError(sec.error);
        setIsProcessing(false);
        return;
      }
      setSecurityResult(sec);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecute = async () => {
    if (!intentResult?.calldata) return;
    setIsExecuting(true);
    setError("");

    try {
      const hash = await writeAndOpen(() =>
        sendTransactionAsync({
          to: intentResult.calldata.to as `0x${string}`,
          data: intentResult.calldata.data as `0x${string}`,
          value: BigInt(intentResult.calldata.value),
        }),
      );
      setTxHash(hash);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex items-center flex-col flex-grow pt-10">
      <div className="px-5 w-full max-w-2xl">
        <h1 className="text-center">
          <span className="block text-4xl font-bold">Talk to Your Wallet</span>
          <span className="block text-lg mt-2 text-base-content/70">Wrap and unwrap ETH using natural language</span>
        </h1>

        {!isConnected ? (
          <div className="flex flex-col items-center mt-10 gap-4">
            <RainbowKitCustomConnectButton />
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            {/* Balances */}
            <div className="flex gap-4 justify-center">
              <div className="bg-base-200 rounded-xl p-4 flex-1 text-center">
                <div className="text-sm text-base-content/60">ETH Balance</div>
                <div className="text-2xl font-bold">{parseFloat(ethBalance).toFixed(4)} ETH</div>
                {ethPrice > 0 && <div className="text-sm text-base-content/50">{formatUsd(ethBalance, ethPrice)}</div>}
              </div>
              <div className="bg-base-200 rounded-xl p-4 flex-1 text-center">
                <div className="text-sm text-base-content/60">WETH Balance</div>
                <div className="text-2xl font-bold">{parseFloat(wethBalance).toFixed(4)} WETH</div>
                {ethPrice > 0 && <div className="text-sm text-base-content/50">{formatUsd(wethBalance, ethPrice)}</div>}
              </div>
            </div>

            {/* Connected address & WETH contract */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-base-content/60">Your wallet:</span>
                <Address address={address} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-base-content/60">WETH contract:</span>
                <Address address={WETH_ADDRESS} />
              </div>
            </div>

            {/* Chat input */}
            <div className="space-y-3">
              <input
                type="text"
                placeholder='Try: "wrap 0.5 ETH" or "unwrap 0.1 WETH"'
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
                    Analyzing...
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

            {/* Security result */}
            {securityResult && intentResult && (
              <div className="space-y-4">
                <div className={`alert ${securityResult.safe ? "alert-success" : "alert-warning"}`}>
                  <div>
                    <div className="font-bold">
                      Security Check: {securityResult.safe ? "✅ Safe" : "⚠️ Review Carefully"}
                    </div>
                    <div className="mt-1">{securityResult.explanation}</div>
                    {securityResult.warnings.length > 0 && (
                      <ul className="mt-2 list-disc list-inside">
                        {securityResult.warnings.map((w, i) => (
                          <li key={i} className="text-warning-content">
                            {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Calldata preview */}
                <div className="bg-base-200 rounded-xl p-4 font-mono text-sm break-all">
                  <div className="flex items-center gap-1">
                    <span className="text-base-content/60">to:</span>{" "}
                    <Address address={intentResult.calldata.to as `0x${string}`} />
                  </div>
                  <div>
                    <span className="text-base-content/60">value:</span>{" "}
                    {intentResult.calldata.value === "0x0"
                      ? "0 ETH"
                      : `${formatEther(BigInt(intentResult.calldata.value))} ETH`}
                    {intentResult.calldata.value !== "0x0" && ethPrice > 0 && (
                      <span className="text-base-content/50">
                        {" "}
                        ({formatUsd(formatEther(BigInt(intentResult.calldata.value)), ethPrice)})
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-base-content/60">data:</span> {intentResult.calldata.data}
                  </div>
                </div>

                {/* Execute button */}
                {!txHash && securityResult.safe && (
                  <button className="btn btn-success w-full text-lg" onClick={handleExecute} disabled={isExecuting}>
                    {isExecuting ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Sending Transaction...
                      </>
                    ) : (
                      `Execute: ${intentResult.action} ${intentResult.amount} ${intentResult.action === "wrap" ? "ETH" : "WETH"}`
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
