"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

const STORAGE_KEY = "denarai_auth";
const EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

interface StoredAuth {
  address: string;
  signature: string;
  message: string;
  expiry: number;
}

export function useDanaraiAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [authData, setAuthData] = useState<StoredAuth | null>(null);
  const [isSigning, setIsSigning] = useState(false);

  // Load from localStorage on mount / address change
  useEffect(() => {
    if (!isConnected || !address) {
      // Don't delete localStorage here — wagmi may still be reconnecting on page load.
      // Just clear in-memory state; the data will be re-read once the wallet reconnects.
      setAuthData(null);
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored: StoredAuth = JSON.parse(raw);
        if (stored.address.toLowerCase() === address.toLowerCase() && stored.expiry > Date.now()) {
          setAuthData(stored);
          return;
        }
      }
    } catch {
      // ignore parse errors
    }

    // Need to sign — will be triggered when walletClient is available
    setAuthData(null);
  }, [address, isConnected]);

  // Auto-prompt signing when needed
  useEffect(() => {
    if (!isConnected || !address || !walletClient || authData || isSigning) return;

    const doSign = async () => {
      setIsSigning(true);
      try {
        const expiry = Date.now() + EXPIRY_MS;
        const expiryISO = new Date(expiry).toISOString();
        const message = `I want to use Denarai - expires: ${expiryISO}`;

        const signature = await walletClient.signMessage({ message });

        const stored: StoredAuth = {
          address,
          signature,
          message,
          expiry,
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        setAuthData(stored);
      } catch (err) {
        console.error("Denarai auth signing failed:", err);
        // User rejected — don't retry automatically
      } finally {
        setIsSigning(false);
      }
    };

    doSign();
  }, [isConnected, address, walletClient, authData, isSigning]);

  const reauth = useCallback(async () => {
    if (!walletClient || !address) return;

    setIsSigning(true);
    try {
      const expiry = Date.now() + EXPIRY_MS;
      const expiryISO = new Date(expiry).toISOString();
      const message = `I want to use Denarai - expires: ${expiryISO}`;

      const signature = await walletClient.signMessage({ message });

      const stored: StoredAuth = {
        address,
        signature,
        message,
        expiry,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      setAuthData(stored);
    } catch (err) {
      console.error("Denarai reauth signing failed:", err);
    } finally {
      setIsSigning(false);
    }
  }, [walletClient, address]);

  const isAuthed = !!authData && authData.expiry > Date.now();

  // Stable reference — must not recreate on every render or it breaks useCallback deps in consumers
  const authHeaders = useMemo<Record<string, string> | null>(
    () =>
      isAuthed && authData
        ? {
            "x-denarai-address": authData.address,
            "x-denarai-sig": authData.signature,
            "x-denarai-msg": authData.message,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authData?.address, authData?.signature, authData?.message, isAuthed],
  );

  return { isAuthed, isSigning, authHeaders, reauth };
}
