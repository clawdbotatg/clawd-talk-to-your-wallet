"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

// This is the exact message larv.ai verifies on-chain — must match CV_SPEND_MESSAGE in clawdviction
export const CV_SPEND_MESSAGE = "larv.ai CV Spend";
const STORAGE_KEY_PREFIX = "denarai_cv_sig_";
const BALANCE_KEY_PREFIX = "denarai_cv_balance_";

interface CvAuthState {
  signature: string | null;
  isSigning: boolean;
  error: string | null;
  balance: number | null;
}

export function useCvAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [state, setState] = useState<CvAuthState>({
    signature: null,
    isSigning: false,
    error: null,
    balance: null,
  });

  // Load persisted signature for this wallet
  useEffect(() => {
    if (!address || !isConnected) {
      setState({ signature: null, isSigning: false, error: null, balance: null });
      return;
    }

    try {
      const key = STORAGE_KEY_PREFIX + address.toLowerCase();
      const stored = localStorage.getItem(key);
      if (stored) {
        const balanceKey = BALANCE_KEY_PREFIX + address.toLowerCase();
        const storedBalance = localStorage.getItem(balanceKey);
        setState(prev => ({
          ...prev,
          signature: stored,
          balance: storedBalance !== null ? parseFloat(storedBalance) : null,
        }));
        return;
      }
    } catch {
      // ignore
    }

    setState({ signature: null, isSigning: false, error: null, balance: null });
  }, [address, isConnected]);

  // Auto-prompt CV signing once wallet is connected and no sig stored
  useEffect(() => {
    if (!isConnected || !address || !walletClient || state.signature || state.isSigning) return;

    const doSign = async () => {
      setState(prev => ({ ...prev, isSigning: true, error: null }));
      try {
        const signature = await walletClient.signMessage({ message: CV_SPEND_MESSAGE });
        const key = STORAGE_KEY_PREFIX + address.toLowerCase();
        localStorage.setItem(key, signature);
        setState({ signature, isSigning: false, error: null, balance: null });
      } catch {
        setState(prev => ({ ...prev, isSigning: false, error: "CV signing rejected" }));
      }
    };

    doSign();
  }, [isConnected, address, walletClient, state.signature, state.isSigning]);

  const resignCv = useCallback(async () => {
    if (!walletClient || !address) return;
    setState(prev => ({ ...prev, isSigning: true, error: null }));
    try {
      const signature = await walletClient.signMessage({ message: CV_SPEND_MESSAGE });
      const key = STORAGE_KEY_PREFIX + address.toLowerCase();
      localStorage.setItem(key, signature);
      setState(prev => ({ ...prev, signature, isSigning: false, error: null }));
    } catch {
      setState(prev => ({ ...prev, isSigning: false, error: "CV signing rejected" }));
    }
  }, [walletClient, address]);

  // Call this after a successful spend to update displayed balance
  const updateCvBalance = useCallback(
    (newBalance: number) => {
      if (!address) return;
      const balanceKey = BALANCE_KEY_PREFIX + address.toLowerCase();
      localStorage.setItem(balanceKey, String(newBalance));
      setState(prev => ({ ...prev, balance: newBalance }));
    },
    [address],
  );

  return {
    cvSignature: state.signature,
    isCvSigning: state.isSigning,
    cvSignError: state.error,
    cvBalance: state.balance,
    resignCv,
    updateCvBalance,
    hasCvSig: !!state.signature,
  };
}
