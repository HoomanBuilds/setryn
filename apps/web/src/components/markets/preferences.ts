"use client";

import { useCallback, useMemo } from "react";
import { usePersistentState } from "@/lib/terminal/use-persistent-state";

/* Per-viewer conveniences only: favourites, the chosen view, and the category. */

const FAVOURITES_KEY = "setryn:markets:favourites";
const VIEW_KEY = "setryn:markets:view";
const CATEGORY_KEY = "setryn:markets:category";

const NO_FAVOURITES: string[] = [];

function parseIds(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

export function useFavourites(): {
  favourites: ReadonlySet<string>;
  toggle: (id: string) => void;
} {
  const [ids, setIds] = usePersistentState(FAVOURITES_KEY, NO_FAVOURITES, parseIds);
  const favourites = useMemo(() => new Set(ids), [ids]);
  const toggle = useCallback(
    (id: string) =>
      setIds((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
      ),
    [setIds],
  );
  return { favourites, toggle };
}

export type ViewId = "table" | "ladder" | "curve";

const DEFAULT_VIEW: ViewId = "table";

function parseView(value: unknown): ViewId | undefined {
  return value === "table" || value === "ladder" || value === "curve" ? value : undefined;
}

export function useMarketsView() {
  return usePersistentState<ViewId>(VIEW_KEY, DEFAULT_VIEW, parseView);
}

/** "ALL", "FAVOURITES", or a strategy kind. Unknown kinds fall back to ALL at render. */
const DEFAULT_CATEGORY = "ALL";

function parseCategory(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length < 64 ? value : undefined;
}

export function useMarketsCategory() {
  return usePersistentState<string>(CATEGORY_KEY, DEFAULT_CATEGORY, parseCategory);
}
