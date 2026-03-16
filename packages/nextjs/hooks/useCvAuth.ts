"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

// This is the exact message larv.ai verifies on-chain — must match CV_SPEND_MESSAGE in clawdviction
export const CV_SPEND_MESSAGE = "larv.ai CV Spend";
const STORAGE_KEY_PREFIX = "denarai_cv_sig_";

interface CvAuthState {
  signature: string | null;
  isSigning: boolean;
  error: string | null;
}

export function useCvAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [state, setState] = useState<CvAuthState>({
    signature: null,
    isSigning: false,
    error: null,
  });

  // Load persisted signature for this wallet
  useEffect(() => {
    if (!address || !isConnected) {
      setState({ signature: null, isSigning: false, error: null });
      return;
    }

    try {
      const key = STORAGE_KEY_PREFIX + address.toLowerCase();
      const stored = localStorage.getItem(key);
      if (stored) {
        setState(prev => ({ ...prev, signature: stored }));
        return;
      }
    } catch {
      // ignore
    }

    setState({ signature: null, isSigning: false, error: null });
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
        setState({ signature, isSigning: false, error: null });
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
      setState({ signature, isSigning: false, error: null });
    } catch {
      setState(prev => ({ ...prev, isSigning: false, error: "CV signing rejected" }));
    }
  }, [walletClient, address]);

  return {
    cvSignature: state.signature,
    isCvSigning: state.isSigning,
    cvSignError: state.error,
    resignCv,
    hasCvSig: !!state.signature,
  };
}
