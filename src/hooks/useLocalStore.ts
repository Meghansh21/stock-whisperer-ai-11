import { useCallback, useEffect, useState } from "react";

export type Holding = {
  symbol: string;
  name: string;
  qty: number;
  buyPrice: number;
  stopLoss: number;
  target: number;
  addedAt: number;
};

export type Settings = {
  capital: number;
  profile: "conservative" | "balanced" | "aggressive";
  horizon: "2-4 weeks" | "1-3 months" | "3-6 months";
};

const DEFAULTS: { settings: Settings; pinned: string[]; holdings: Holding[] } = {
  settings: { capital: 100000, profile: "balanced", horizon: "1-3 months" },
  pinned: ["SUZLON.NS", "SYRMA.NS", "OLECTRA.NS", "IRCON.NS"],
  holdings: [],
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...(fallback as object), ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setValue(Array.isArray(fallback) ? (readArray(key, fallback as unknown[]) as T) : read<T>(key, fallback));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );

  return [value, update, hydrated] as const;
}

function readArray<T>(key: string, fallback: T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export const useSettings = () => useStored<Settings>("sf.settings", DEFAULTS.settings);
export const usePinned = () => useStored<string[]>("sf.pinned", DEFAULTS.pinned);
export const useHoldings = () => useStored<Holding[]>("sf.holdings", DEFAULTS.holdings);
