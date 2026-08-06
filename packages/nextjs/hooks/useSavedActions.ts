"use client";

import { useCallback, useEffect, useState } from "react";

// A saved action is a named requote descriptor — the deterministic {tool, args}
// a build tool emitted. Re-running it through /api/requote rebuilds the same
// transaction at the current market price in ~2s, no agent turn, no charge.
export type SavedAction = {
  id: string;
  label: string;
  requote: { tool: string; args: Record<string, unknown> };
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
