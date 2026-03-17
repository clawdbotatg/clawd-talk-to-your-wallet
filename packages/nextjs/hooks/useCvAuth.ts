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
      // legacy bare string — cvWallet unknown at this point, will be patched on connect
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

  // Read localStorage synchronously so state.signature is populated on the FIRST render.
  // This means the auto-sign effect sees state.signature immediately and never races.
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

  // Fetch balance whenever we have a cvWallet
  useEffect(() => {
    if (!isConnected || !state.cvWallet) return;
    fetchCvBalance(state.cvWallet);
    const interval = setInterval(() => fetchCvBalance(state.cvWallet!), 30_000);
    return () => clearInterval(interval);
  }, [isConnected, state.cvWallet, fetchCvBalance]);

  // Reset on disconnect
  useEffect(() => {
    if (!isConnected) {
      setState(prev => ({ ...prev, balance: null }));
    }
  }, [isConnected]);

  // Auto-prompt ONLY if: connected, no sig anywhere (state OR localStorage), not already signing, no prior rejection
  useEffect(() => {
    if (!isConnected || !address || !walletClient) return;
    if (state.isSigning || state.error) return;

    // Always re-check localStorage directly — never trust stale state alone
    const stored = readStoredAuth();
    if (stored?.signature) {
      // Found one in storage but not in state (e.g. written by another tab) — sync it
      if (!state.signature) {
        setState(prev => ({ ...prev, signature: stored.signature, cvWallet: stored.cvWallet || address }));
      }
      return;
    }

    if (state.signature) return;

    // Truly no sig anywhere — prompt once
    const doSign = async () => {
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
    };

    doSign();
  }, [isConnected, address, walletClient, state.signature, state.isSigning, state.error, fetchCvBalance]);

  const resignCv = useCallback(async () => {
    if (!walletClient || !address) return;
    setState(prev => ({ ...prev, isSigning: true, error: null, signature: null }));
    try {
      const signature = await walletClient.signMessage({ message: CV_SPEND_MESSAGE });
      const auth: StoredCvAuth = { signature, cvWallet: address };
      writeStoredAuth(auth);
      setState(prev => ({ ...prev, signature, cvWallet: address, isSigning: false, error: null }));
      fetchCvBalance(address);
    } catch {
      setState(prev => ({ ...prev, isSigning: false, error: "CV signing rejected" }));
    }
  }, [walletClient, address, fetchCvBalance]);

  const updateCvBalance = useCallback((newBalance: number) => {
    setState(prev => ({ ...prev, balance: newBalance }));
  }, []);

  return {
    cvSignature: state.signature,
    cvWallet: state.cvWallet,
    isCvSigning: state.isSigning,
    cvSignError: state.error,
    cvBalance: state.balance,
    resignCv,
    updateCvBalance,
    fetchCvBalance,
    hasCvSig: !!state.signature,
  };
}
