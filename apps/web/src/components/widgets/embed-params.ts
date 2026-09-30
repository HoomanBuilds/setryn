import { MARKETS } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";

export type EmbedTheme = "dark" | "light";
export type EmbedWidgetKind = "ticker" | "market" | "trade";

export interface EmbedParams {
  theme: EmbedTheme;
  /** Partner attribution code from `data-partner`, validated; null when absent or malformed. */
  partner: string | null;
  /** Console previews render without recording usage. */
  preview: boolean;
  /** Id the loader script uses to match resize messages to its iframe. */
  frameId: string | null;
  side: "LONG" | "SHORT";
  lots: number;
  markets: PackageMarket[];
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function parseEmbedParams(search: SearchParams): EmbedParams {
  const theme = first(search.theme) === "light" ? "light" : "dark";
  const rawPartner = first(search.partner);
  const partner = rawPartner && /^[a-z0-9][a-z0-9-]{2,31}$/.test(rawPartner) ? rawPartner : null;
  const rawFrame = first(search.fid);
  const frameId = rawFrame && /^[A-Za-z0-9_-]{1,64}$/.test(rawFrame) ? rawFrame : null;
  const side = first(search.side)?.toLowerCase() === "short" ? "SHORT" : "LONG";
  const rawLots = Number(first(search.lots) ?? 1);
  const lots = Number.isInteger(rawLots) && rawLots >= 1 && rawLots <= 1_000 ? rawLots : 1;
  const wanted = (first(search.markets) ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const selected = wanted.length > 0 ? MARKETS.filter((market) => wanted.includes(market.id)) : [];
  return {
    theme,
    partner,
    preview: first(search.preview) === "1",
    frameId,
    side,
    lots,
    markets: selected.length > 0 ? selected : MARKETS.slice(0, 8),
  };
}

/**
 * Link out to the platform. With a partner code the click goes through the attribution redirect, which records it
 * and lands on the same trade route with the partner reference.
 */
export function platformTradeHref(
  marketId: string,
  partner: string | null,
  widget: EmbedWidgetKind,
  handoff: { side?: "LONG" | "SHORT"; lots?: number } = {},
): string {
  const query = new URLSearchParams();
  if (handoff.side) query.set("direction", handoff.side.toLowerCase());
  if (handoff.lots) query.set("lots", String(handoff.lots));
  const target = `/trade/${encodeURIComponent(marketId)}${query.size > 0 ? `?${query.toString()}` : ""}`;
  if (!partner) return target;
  return `/api/v1/partners/r/${partner}?${new URLSearchParams({ to: target, widget }).toString()}`;
}
