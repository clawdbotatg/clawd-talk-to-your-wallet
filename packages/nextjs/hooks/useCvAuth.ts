"use client";

import { useCallback, useEffect, useState } from "react";
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
  cvWallet: string | null; // address that signed — this is what larv.ai charges
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

  // Fetch live CV balance from larv.ai (always fetch for the CV wallet, not operating wallet)
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

  // Load persisted global CV sig on connect (one sig covers all wallets)
  useEffect(() => {
    if (!isConnected) {
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
          // Legacy per-address bare string — treat cvWallet as current address
          parsed = { signature: stored, cvWallet: address ?? "" };
        }
        setState(prev => ({ ...prev, signature: parsed!.signature, cvWallet: parsed!.cvWallet }));
        fetchCvBalance(parsed!.cvWallet);
        return;
      }
    } catch {
      // ignore
    }

    setState({ signature: null, cvWallet: null, isSigning: false, error: null, balance: null });
  }, [isConnected, address, fetchCvBalance]);

  // Auto-prompt CV signing once wallet is connected and no sig stored.
  // If the user already rejected (state.error is set), don't re-prompt — wait for explicit resignCv().
  useEffect(() => {
    if (!isConnected || !address || !walletClient || state.signature || state.isSigning || state.error) return;

    const doSign = async () => {
      setState(prev => ({ ...prev, isSigning: true, error: null }));
      try {
        const signature = await walletClient.signMessage({ message: CV_SPEND_MESSAGE });
        // The currently connected wallet IS the CV wallet
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

  // Call after a successful spend to reflect the new balance immediately
  const updateCvBalance = useCallback((newBalance: number) => {
    setState(prev => ({ ...prev, balance: newBalance }));
  }, []);

  return {
    cvSignature: state.signature,
    cvWallet: state.cvWallet, // the address larv.ai should charge — send this to the API
    isCvSigning: state.isSigning,
    cvSignError: state.error,
    cvBalance: state.balance,
    resignCv,
    updateCvBalance,
    fetchCvBalance,
    hasCvSig: !!state.signature,
  };
}
