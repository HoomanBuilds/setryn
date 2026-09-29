"use client";

import { DEFAULT_SLIPPAGE_BPS, SLIPPAGE_PRESETS_BPS } from "@/lib/terminal/economics";
import { usePersistentState } from "@/lib/terminal/use-persistent-state";

/*
 * Per-viewer trading and privacy preferences. Each lives in this browser only. The slippage key is the one the
 * trade terminal already reads, so a change here is the terminal's default on its next render.
 */

export const SLIPPAGE_KEY = "setryn:ticket-slippage-bps";
export const SIZE_UNIT_KEY = "setryn:prefs:size-unit";
export const CONFIRMATIONS_KEY = "setryn:prefs:confirmations";
export const DISCLOSURE_KEY = "setryn:prefs:rfq-disclosure";

export type SizeUnit = "LOTS" | "NOTIONAL";

export interface ConfirmationPrefs {
  orders: boolean;
  cancels: boolean;
  rfqSelection: boolean;
  collateral: boolean;
}

export interface DisclosurePrefs {
  /** Where a new ticket routes first. */
  route: "PUBLIC_BOOK" | "PRIVATE_RFQ";
  /** Whether invited makers see the requesting account or only an anonymous session. */
  identity: "ANONYMOUS" | "ACCOUNT";
  /** Whether invited makers see the exact size or a size band. */
  size: "EXACT" | "BANDED";
}

export const DEFAULT_SIZE_UNIT: SizeUnit = "LOTS";
export const DEFAULT_CONFIRMATIONS: ConfirmationPrefs = { orders: true, cancels: false, rfqSelection: true, collateral: true };
export const DEFAULT_DISCLOSURE: DisclosurePrefs = { route: "PUBLIC_BOOK", identity: "ANONYMOUS", size: "EXACT" };

export { DEFAULT_SLIPPAGE_BPS, SLIPPAGE_PRESETS_BPS };

/** Same acceptance rule the terminal applies, so both sides agree on what a stored value means. */
export function parseSlippageBps(value: unknown): number | undefined {
  return typeof value === "number" && (SLIPPAGE_PRESETS_BPS as readonly number[]).includes(value) ? value : undefined;
}

export function parseSizeUnit(value: unknown): SizeUnit | undefined {
  return value === "LOTS" || value === "NOTIONAL" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfirmations(value: unknown): ConfirmationPrefs | undefined {
  if (!isRecord(value)) return undefined;
  const pick = (key: keyof ConfirmationPrefs) => (typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULT_CONFIRMATIONS[key]);
  return { orders: pick("orders"), cancels: pick("cancels"), rfqSelection: pick("rfqSelection"), collateral: pick("collateral") };
}

export function parseDisclosure(value: unknown): DisclosurePrefs | undefined {
  if (!isRecord(value)) return undefined;
  return {
    route: value.route === "PRIVATE_RFQ" ? "PRIVATE_RFQ" : "PUBLIC_BOOK",
    identity: value.identity === "ACCOUNT" ? "ACCOUNT" : "ANONYMOUS",
    size: value.size === "BANDED" ? "BANDED" : "EXACT",
  };
}

export function useSlippagePreference() {
  return usePersistentState(SLIPPAGE_KEY, DEFAULT_SLIPPAGE_BPS, parseSlippageBps);
}

export function useSizeUnit() {
  return usePersistentState<SizeUnit>(SIZE_UNIT_KEY, DEFAULT_SIZE_UNIT, parseSizeUnit);
}

export function useConfirmationPrefs() {
  return usePersistentState(CONFIRMATIONS_KEY, DEFAULT_CONFIRMATIONS, parseConfirmations);
}

export function useDisclosurePrefs() {
  return usePersistentState(DISCLOSURE_KEY, DEFAULT_DISCLOSURE, parseDisclosure);
}

/** Every key the platform writes for this viewer, for the clear-local-data control. */
export const LOCAL_KEYS: { key: string; label: string; owner: string }[] = [
  { key: SLIPPAGE_KEY, label: "Market-order slippage", owner: "Trade terminal" },
  { key: SIZE_UNIT_KEY, label: "Default size unit", owner: "Home, Exposures" },
  { key: CONFIRMATIONS_KEY, label: "Confirmation prompts", owner: "Settings" },
  { key: DISCLOSURE_KEY, label: "RFQ disclosure defaults", owner: "Settings" },
  { key: "setryn:exposures:book", label: "Exposure book", owner: "Exposures" },
  { key: "setryn:alerts:rules", label: "Alert rules", owner: "Alerts" },
  { key: "setryn:alerts:ledger", label: "Alert acknowledgements", owner: "Alerts" },
  { key: "setryn:chart-prefs", label: "Chart style and indicators", owner: "Trade terminal" },
  { key: "setryn:markets:favourites", label: "Favourite markets", owner: "Markets" },
  { key: "setryn:markets:view", label: "Markets view", owner: "Markets" },
  { key: "setryn:markets:category", label: "Markets category", owner: "Markets" },
];
