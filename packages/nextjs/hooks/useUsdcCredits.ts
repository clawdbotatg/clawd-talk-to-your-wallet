"use client";

import { useCallback, useEffect, useState } from "react";

export function formatUsdc(micro: number): string {
  const dollars = micro / 1_000_000;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: dollars > 0 && dollars < 0.01 ? 4 : 2,
  });
}

export type AutoTopupPrefs = { enabled: boolean; amountMicro: number; fromWallet: string | null };

/** USDC credit balance for a wallet, polled every 30s (same cadence as useCvAuth).
 * usdcMicro === null means the ledger is unreachable / not live — hide the UI. */
export function useUsdcCredits(wallet: string | null) {
  const [usdcMicro, setUsdcMicro] = useState<number | null>(null);
  const [autoTopup, setAutoTopup] = useState<AutoTopupPrefs | null>(null);
  const [topupsEnabled, setTopupsEnabled] = useState(false);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/credits/balance?address=${wallet}`);
      const data = await res.json();
      if (data.success) {
        setUsdcMicro(typeof data.usdcMicro === "number" ? data.usdcMicro : null);
        setAutoTopup(data.autoTopup ?? null);
        setTopupsEnabled(!!data.topupsEnabled);
      }
    } catch {
      // keep last known state
    }
  }, [wallet]);

  useEffect(() => {
    if (!wallet) {
      setUsdcMicro(null);
      setAutoTopup(null);
      return;
    }
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [wallet, refresh]);

  return { usdcMicro, autoTopup, topupsEnabled, refresh };
}
