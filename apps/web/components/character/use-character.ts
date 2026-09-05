"use client";

import { useCallback, useSyncExternalStore } from "react";

import { DEFAULT_CHARACTER, type CharacterConfig } from "./types";

const STORAGE_KEY = "recruitintel.character.v1";
const GREETED_KEY = "recruitintel.character.lastGreetedDate";

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedCharacter: CharacterConfig = DEFAULT_CHARACTER;

function readCharacterSnapshot(): CharacterConfig {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedCharacter;
  cachedRaw = raw;
  try {
    cachedCharacter = raw ? { ...DEFAULT_CHARACTER, ...(JSON.parse(raw) as Partial<CharacterConfig>) } : DEFAULT_CHARACTER;
  } catch {
    cachedCharacter = DEFAULT_CHARACTER;
  }
  return cachedCharacter;
}

function getServerCharacter(): CharacterConfig {
  return DEFAULT_CHARACTER;
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function writeCharacter(next: CharacterConfig) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private browsing, quota) — listeners still
    // get the update so the current session reflects it.
  }
  cachedRaw = undefined;
  cachedCharacter = next;
  for (const listener of listeners) listener();
}

/** True once mounted on the client, so localStorage-derived values are safe to trust. */
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function useCharacter() {
  const hydrated = useIsHydrated();
  const character = useSyncExternalStore(subscribe, readCharacterSnapshot, getServerCharacter);

  const setCharacter = useCallback((next: CharacterConfig) => writeCharacter(next), []);
  const updateCharacter = useCallback(
    (patch: Partial<CharacterConfig>) => writeCharacter({ ...character, ...patch }),
    [character],
  );

  return { character, hydrated, setCharacter, updateCharacter };
}

/** Whether today's greeting has already been shown automatically in this browser. */
export function hasGreetedToday(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(GREETED_KEY) === new Date().toDateString();
  } catch {
    return true;
  }
}

export function markGreetedToday() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GREETED_KEY, new Date().toDateString());
  } catch {
    // Ignore — worst case the auto-greeting reappears next load.
  }
}
