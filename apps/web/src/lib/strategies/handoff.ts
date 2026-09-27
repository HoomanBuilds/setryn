import { MARKETS } from "@/lib/terminal/markets";
import type { Guarantee } from "@/lib/terminal/types";
import type { PackageDirection } from "./types";

export interface StudioHandoffContext {
  present: boolean;
  key: string;
  marketId: string | null;
  direction: PackageDirection | null;
  lots: number | null;
  source: string | null;
  sourceLabel: string | null;
  exposureId: string | null;
  lifecycleId: string | null;
  intent: string | null;
  maxCloseCost: number | null;
  guarantee: Guarantee | null;
  valid: boolean;
}

type Query = {
  get(name: string): string | null;
  toString(): string;
};

function safeGet(query: Query, name: string): string | null {
  try {
    const value = query.get(name);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function cleanId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(trimmed)) return null;
  return trimmed;
}

function parseMarketId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  const exact = MARKETS.find((market) => market.id === trimmed);
  if (exact) return exact.id;
  const lowered = trimmed.toLowerCase();
  const insensitive = MARKETS.find((market) => market.id.toLowerCase() === lowered);
  return insensitive ? insensitive.id : null;
}

function parseDirection(value: string | null): PackageDirection | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "long") return "LONG";
  if (normalized === "short") return "SHORT";
  return null;
}

function parseLots(value: string | null): number | null {
  if (value === null) return null;
  if (value.length === 0) return null;
  if (/\s/.test(value)) return null;
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0 || parsed > 10000) return null;
  return parsed;
}

function parseCost(value: string | null): number | null {
  if (value === null) return null;
  if (value.length === 0) return null;
  if (/\s/.test(value)) return null;
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

function parseGuarantee(value: string | null): Guarantee | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "package_atomic") return "PACKAGE_ATOMIC";
  if (normalized === "leg_sequenced") return "LEG_SEQUENCED";
  if (normalized === "solver_bonded") return "SOLVER_BONDED";
  return null;
}

const KNOWN_PARAMS = [
  "market",
  "marketId",
  "direction",
  "lots",
  "source",
  "exposure",
  "exposureId",
  "lifecycle",
  "lifecycleId",
  "intent",
  "maxCloseCost",
  "guarantee",
];

export function parseStudioHandoff(query: Query): StudioHandoffContext {
  const empty: StudioHandoffContext = {
    present: false,
    key: "",
    marketId: null,
    direction: null,
    lots: null,
    source: null,
    sourceLabel: null,
    exposureId: null,
    lifecycleId: null,
    intent: null,
    maxCloseCost: null,
    guarantee: null,
    valid: false,
  };
  if (!query || typeof query.get !== "function") return empty;
  let key = "";
  try {
    const raw = query.toString();
    key = typeof raw === "string" ? raw : "";
  } catch {
    key = "";
  }
  let seen = false;
  for (const name of KNOWN_PARAMS) {
    if (safeGet(query, name) !== null) {
      seen = true;
      break;
    }
  }
  if (!seen) return { ...empty, key };

  const marketId = parseMarketId(safeGet(query, "market") ?? safeGet(query, "marketId"));
  const direction = parseDirection(safeGet(query, "direction"));
  const lots = parseLots(safeGet(query, "lots"));
  const source = cleanId(safeGet(query, "source"));
  const exposureId = cleanId(safeGet(query, "exposureId")) ?? cleanId(safeGet(query, "exposure"));
  const lifecycleId = cleanId(safeGet(query, "lifecycleId")) ?? cleanId(safeGet(query, "lifecycle"));
  const intent = cleanId(safeGet(query, "intent"));
  const maxCloseCost = parseCost(safeGet(query, "maxCloseCost"));
  const guarantee = parseGuarantee(safeGet(query, "guarantee"));

  let sourceLabel: string | null = null;
  const loweredSource = source !== null ? source.toLowerCase() : null;
  if (loweredSource === "hedges") sourceLabel = "Hedge Builder";
  else if (loweredSource === "lifecycle") sourceLabel = "Lifecycle";
  else if (loweredSource === "studio" || loweredSource === "strategies") sourceLabel = "Strategy Studio";
  else if (lifecycleId !== null) sourceLabel = "Lifecycle";
  else if (exposureId !== null) sourceLabel = "Hedge Builder";

  const valid = marketId !== null && direction !== null && lots !== null;

  return {
    present: true,
    key,
    marketId,
    direction,
    lots,
    source,
    sourceLabel,
    exposureId,
    lifecycleId,
    intent,
    maxCloseCost,
    guarantee,
    valid,
  };
}
