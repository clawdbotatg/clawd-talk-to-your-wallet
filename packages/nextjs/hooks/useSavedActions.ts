"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";

// A saved action is a named requote descriptor — the deterministic {tool, args}
// a build tool emitted. Re-running it through /api/requote rebuilds the same
// transaction at the current market price in ~2s, no agent turn, no charge.
// `edit` names the amount arg so a chip can re-run at a different size:
// decimals is the token's (args hold raw units), or null when the arg is
// already human units (buildTransfer).
export type ActionEdit = { arg: string; decimals: number | null; symbol: string };

export type SavedAction = {
  id: string;
  label: string;
  requote: { tool: string; args: Record<string, unknown>; edit?: ActionEdit };
  chainId?: number;
  description?: string;
  savedAt: number;
};

const MAX_ACTIONS = 12;

const storageKey = (address?: string) => (address ? `denarai-actions-${address.toLowerCase()}` : null);

// Identity is the descriptor itself: same tool + same args = same action.
export const actionIdFor = (requote: SavedAction["requote"]) => `${requote.tool}:${JSON.stringify(requote.args)}`;

export const useSavedActions = (address?: string) => {
  const [savedActions, setSavedActions] = useState<SavedAction[]>([]);

  useEffect(() => {
    const key = storageKey(address);
    if (!key) {
      setSavedActions([]);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      setSavedActions(raw ? (JSON.parse(raw) as SavedAction[]) : []);
    } catch {
      setSavedActions([]);
    }
  }, [address]);

  const persist = useCallback(
    (actions: SavedAction[]) => {
      const key = storageKey(address);
      setSavedActions(actions);
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify(actions));
      } catch {
        /* storage full — the in-memory list still works this session */
      }
    },
    [address],
  );

  const saveAction = useCallback(
    (action: Omit<SavedAction, "id" | "savedAt">) => {
      const id = actionIdFor(action.requote);
      persist([{ ...action, id, savedAt: Date.now() }, ...savedActions.filter(a => a.id !== id)].slice(0, MAX_ACTIONS));
    },
    [savedActions, persist],
  );

  const removeAction = useCallback(
    (id: string) => persist(savedActions.filter(a => a.id !== id)),
    [savedActions, persist],
  );

  const isSaved = useCallback(
    (requote: SavedAction["requote"]) => savedActions.some(a => a.id === actionIdFor(requote)),
    [savedActions],
  );

  return { savedActions, saveAction, removeAction, isSaved };
};

/** The descriptor's amount in human units, or null when it isn't editable. */
export const actionAmount = (requote: SavedAction["requote"]): string | null => {
  const e = requote.edit;
  const raw = e ? requote.args[e.arg] : undefined;
  if (!e || raw == null) return null;
  if (e.decimals == null) return String(raw);
  try {
    return formatUnits(BigInt(String(raw)), e.decimals);
  } catch {
    return null;
  }
};

/** A copy of the descriptor at a new human amount, or null if it doesn't parse. */
export const withAmount = (requote: SavedAction["requote"], human: string): SavedAction["requote"] | null => {
  const e = requote.edit;
  const v = human.trim();
  if (!e || !/^\d*\.?\d+$/.test(v) || Number(v) <= 0) return null;
  try {
    const value = e.decimals == null ? v : parseUnits(v, e.decimals).toString();
    return { ...requote, args: { ...requote.args, [e.arg]: value } };
  } catch {
    return null;
  }
};
