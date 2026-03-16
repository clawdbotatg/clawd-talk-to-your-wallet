"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

// This is the exact message larv.ai verifies on-chain — must match CV_SPEND_MESSAGE in clawdviction
export const CV_SPEND_MESSAGE = "larv.ai CV Spend";
const STORAGE_KEY_PREFIX = "denarai_cv_sig_";
const LARV_AI_BALANCE_URL = "https://larv.ai/api/cv/balance";

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

  // Fetch live CV balance from larv.ai
  const fetchCvBalance = useCallback(async (wallet: string) => {
    try {
      const res = await fetch(`${LARV_AI_BALANCE_URL}?address=${wallet}`);
      const data = await res.json();
      if (data.success && typeof data.balance === "number") {
        setState(prev => ({ ...prev, balance: data.balance }));
      }
    } catch {
      // ignore — balance display is best-effort
    }
  }, []);

  // Load persisted signature + fetch live balance on connect
  useEffect(() => {
    if (!address || !isConnected) {
      setState({ signature: null, isSigning: false, error: null, balance: null });
      return;
    }

    try {
      const key = STORAGE_KEY_PREFIX + address.toLowerCase();
      const stored = localStorage.getItem(key);
      if (stored) {
        setState(prev => ({ ...prev, signature: stored }));
        fetchCvBalance(address);
        return;
      }
    } catch {
      // ignore
    }

    setState({ signature: null, isSigning: false, error: null, balance: null });
  }, [address, isConnected, fetchCvBalance]);

  // Auto-prompt CV signing once wallet is connected and no sig stored
  useEffect(() => {
    if (!isConnected || !address || !walletClient || state.signature || state.isSigning) return;

    const doSign = async () => {
      setState(prev => ({ ...prev, isSigning: true, error: null }));
      try {
        const signature = await walletClient.signMessage({ message: CV_SPEND_MESSAGE });
        const key = STORAGE_KEY_PREFIX + address.toLowerCase();
        localStorage.setItem(key, signature);
        setState(prev => ({ ...prev, signature, isSigning: false, error: null }));
        fetchCvBalance(address);
      } catch {
        setState(prev => ({ ...prev, isSigning: false, error: "CV signing rejected" }));
      }
    };

    doSign();
  }, [isConnected, address, walletClient, state.signature, state.isSigning, fetchCvBalance]);

  const resignCv = useCallback(async () => {
    if (!walletClient || !address) return;
    setState(prev => ({ ...prev, isSigning: true, error: null }));
    try {
      const signature = await walletClient.signMessage({ message: CV_SPEND_MESSAGE });
      const key = STORAGE_KEY_PREFIX + address.toLowerCase();
      localStorage.setItem(key, signature);
      setState(prev => ({ ...prev, signature, isSigning: false, error: null }));
      fetchCvBalance(address);
    } catch {
      setState(prev => ({ ...prev, isSigning: false, error: "CV signing rejected" }));
    }
  }, [walletClient, address, fetchCvBalance]);

  // Call after a successful spend to reflect the new balance immediately
  const updateCvBalance = useCallback((newBalance: number) => {
    setState(prev => ({ ...prev, balance: newBalance }));
  }, []);

  return {
    cvSignature: state.signature,
    isCvSigning: state.isSigning,
    cvSignError: state.error,
    cvBalance: state.balance,
    resignCv,
    updateCvBalance,
    fetchCvBalance,
    hasCvSig: !!state.signature,
  };
}
