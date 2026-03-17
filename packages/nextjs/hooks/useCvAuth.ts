"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

export const CV_SPEND_MESSAGE = "larv.ai CV Spend";
const STORAGE_KEY = "denarai_cv_auth";
const CV_BALANCE_URL = "/api/cv/balance";

interface StoredCvAuth {
  signature: string;
  cvWallet: string;
}

interface CvAuthState {
  signature: string | null;
  cvWallet: string | null;
  isSigning: boolean;
  error: string | null;
  balance: number | null;
}

function readStoredAuth(): StoredCvAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredCvAuth;
    } catch {
      return { signature: raw, cvWallet: "" };
    }
  } catch {
    return null;
  }
}

function writeStoredAuth(auth: StoredCvAuth) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // ignore
  }
}

export function useCvAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  // Synchronous localStorage read — state.signature is set on first render, no race possible
  const [state, setState] = useState<CvAuthState>(() => {
    const stored = readStoredAuth();
    return {
      signature: stored?.signature ?? null,
      cvWallet: stored?.cvWallet ?? null,
      isSigning: false,
      error: null,
      balance: null,
    };
  });

  const fetchCvBalance = useCallback(async (wallet: string) => {
    if (!wallet) return;
    try {
      const res = await fetch(`${CV_BALANCE_URL}?address=${wallet}`);
      const data = await res.json();
      if (data.success && typeof data.balance === "number") {
        setState(prev => ({ ...prev, balance: data.balance }));
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch balance on connect
  useEffect(() => {
    if (!isConnected || !state.cvWallet) return;
    fetchCvBalance(state.cvWallet);
    const interval = setInterval(() => fetchCvBalance(state.cvWallet!), 30_000);
    return () => clearInterval(interval);
  }, [isConnected, state.cvWallet, fetchCvBalance]);

  // Clear balance on disconnect (keep sig — it's global and reusable)
  useEffect(() => {
    if (!isConnected) {
      setState(prev => ({ ...prev, balance: null }));
    }
  }, [isConnected]);

  // signCv: called explicitly by one component only (page.tsx) — NOT auto-called by the hook
  const signCv = useCallback(async () => {
    if (!walletClient || !address || state.isSigning) return;
    // Check storage one more time before prompting
    const existing = readStoredAuth();
    if (existing?.signature) {
      setState(prev => ({ ...prev, signature: existing.signature, cvWallet: existing.cvWallet || address }));
      return;
    }
    setState(prev => ({ ...prev, isSigning: true, error: null }));
    try {
      const signature = await walletClient.signMessage({ message: CV_SPEND_MESSAGE });
      const auth: StoredCvAuth = { signature, cvWallet: address };
      writeStoredAuth(auth);
      setState(prev => ({ ...prev, signature, cvWallet: address, isSigning: false, error: null }));
      fetchCvBalance(address);
    } catch {
      setState(prev => ({ ...prev, isSigning: false, error: "CV signing rejected" }));
    }
  }, [walletClient, address, state.isSigning, fetchCvBalance]);

  const updateCvBalance = useCallback((newBalance: number) => {
    setState(prev => ({ ...prev, balance: newBalance }));
  }, []);

  return {
    cvSignature: state.signature,
    cvWallet: state.cvWallet,
    isCvSigning: state.isSigning,
    cvSignError: state.error,
    cvBalance: state.balance,
    signCv,
    resignCv: signCv, // same thing — kept for any existing call sites
    updateCvBalance,
    fetchCvBalance,
    hasCvSig: !!state.signature,
  };
}
