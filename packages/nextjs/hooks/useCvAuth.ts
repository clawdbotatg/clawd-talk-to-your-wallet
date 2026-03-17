"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

// This is the exact message larv.ai verifies on-chain — must match CV_SPEND_MESSAGE in clawdviction
export const CV_SPEND_MESSAGE = "larv.ai CV Spend";
// Single global key — one CV sig covers all connected wallets
const STORAGE_KEY = "denarai_cv_auth";
const CV_BALANCE_URL = "/api/cv/balance"; // proxy — avoids CORS

interface StoredCvAuth {
  signature: string;
  cvWallet: string; // the address that actually signed — may differ from operating wallet
}

interface CvAuthState {
  signature: string | null;
  cvWallet: string | null;
  isSigning: boolean;
  error: string | null;
  balance: number | null;
}

export function useCvAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [state, setState] = useState<CvAuthState>({
    signature: null,
    cvWallet: null,
    isSigning: false,
    error: null,
    balance: null,
  });

  // True once the load effect has checked localStorage — auto-sign must wait for this
  const loadedRef = useRef(false);

  const fetchCvBalance = useCallback(async (wallet: string) => {
    try {
      const res = await fetch(`${CV_BALANCE_URL}?address=${wallet}`);
      const data = await res.json();
      if (data.success && typeof data.balance === "number") {
        setState(prev => ({ ...prev, balance: data.balance }));
      }
    } catch {
      // ignore — balance display is best-effort
    }
  }, []);

  // Load persisted global CV sig on connect (one sig covers all wallets).
  // Sets loadedRef AFTER setState so auto-sign effect can't race ahead of it.
  useEffect(() => {
    if (!isConnected) {
      loadedRef.current = false;
      setState({ signature: null, cvWallet: null, isSigning: false, error: null, balance: null });
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        let parsed: StoredCvAuth | null = null;
        try {
          parsed = JSON.parse(stored) as StoredCvAuth;
        } catch {
          // Legacy bare string — treat cvWallet as current address
          parsed = { signature: stored, cvWallet: address ?? "" };
        }
        setState(prev => ({ ...prev, signature: parsed!.signature, cvWallet: parsed!.cvWallet }));
        fetchCvBalance(parsed!.cvWallet);
        loadedRef.current = true;
        return;
      }
    } catch {
      // ignore
    }

    // No stored sig found
    setState(prev => ({ ...prev, signature: null, cvWallet: null }));
    loadedRef.current = true;
  }, [isConnected, address, fetchCvBalance]);

  // Auto-prompt — only fires if:
  // 1. loadedRef is true (load effect already checked localStorage)
  // 2. no sig in state (localStorage was empty)
  // 3. not already signing
  // 4. no prior rejection error
  useEffect(() => {
    if (!isConnected || !address || !walletClient) return;
    if (!loadedRef.current) return;
    if (state.signature || state.isSigning || state.error) return;

    const doSign = async () => {
      setState(prev => ({ ...prev, isSigning: true, error: null }));
      try {
        const signature = await walletClient.signMessage({ message: CV_SPEND_MESSAGE });
        const cvWallet = address;
        const stored: StoredCvAuth = { signature, cvWallet };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        setState(prev => ({ ...prev, signature, cvWallet, isSigning: false, error: null }));
        fetchCvBalance(cvWallet);
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
      const cvWallet = address;
      const stored: StoredCvAuth = { signature, cvWallet };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      setState(prev => ({ ...prev, signature, cvWallet, isSigning: false, error: null }));
      fetchCvBalance(cvWallet);
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
