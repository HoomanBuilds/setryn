export interface HandoffContext {
  present: boolean;
  key: string;
  source: string | null;
  sourceLabel: string | null;
  studioMode: string | null;
  draftId: string | null;
  lifecycleId: string | null;
  legId: string | null;
  exposureId: string | null;
  direction: "LONG" | "SHORT" | null;
  intent: "ENTER" | "EXIT";
  lots: number | null;
  maxCloseCost: number | null;
  guarantee: "PACKAGE_ATOMIC" | "LEG_SEQUENCED" | "SOLVER_BONDED" | null;
  blockedReason: string | null;
}
function safeGet(query: { get(name: string): string | null }, name: string): string | null {
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
function parseLots(value: string | null): number | null {
  if (value === null) return null;
  if (value.length === 0) return null;
  if (/\s/.test(value)) return null;
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0.0001 || parsed > 10000) return null;
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
function parseDirection(value: string | null): "LONG" | "SHORT" | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "long") return "LONG";
  if (normalized === "short") return "SHORT";
  return null;
}
function parseGuarantee(value: string | null): "PACKAGE_ATOMIC" | "LEG_SEQUENCED" | "SOLVER_BONDED" | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "package_atomic") return "PACKAGE_ATOMIC";
  if (normalized === "leg_sequenced") return "LEG_SEQUENCED";
  if (normalized === "solver_bonded") return "SOLVER_BONDED";
  return null;
}
export function parseHandoff(query: { get(name: string): string | null; toString(): string }): HandoffContext {
  const base: HandoffContext = {
    present: false,
    key: "",
    source: null,
    sourceLabel: null,
    studioMode: null,
    draftId: null,
    lifecycleId: null,
    legId: null,
    exposureId: null,
    direction: null,
    intent: "ENTER",
    lots: null,
    maxCloseCost: null,
    guarantee: null,
    blockedReason: null,
  };
  if (!query || typeof query.get !== "function") return base;
  let key = "";
  try {
    const raw = query.toString();
    key = typeof raw === "string" ? raw : "";
  } catch {
    key = "";
  }
  const names = ["source", "sourceLabel", "studio", "studioMode", "studioId", "draft", "draftId", "lifecycle", "lifecycleId", "leg", "legId", "exposure", "exposureId", "hedges", "hedge", "lots", "intent", "direction", "maxCloseCost", "guarantee"];
  let seen = false;
  for (const name of names) {
    if (safeGet(query, name) !== null) {
      seen = true;
      break;
    }
  }
  if (!seen) {
    base.key = key;
    return base;
  }
  const studioMode = cleanId(safeGet(query, "studioMode")) ?? cleanId(safeGet(query, "studio")) ?? cleanId(safeGet(query, "studioId"));
  const draftId = cleanId(safeGet(query, "draftId")) ?? cleanId(safeGet(query, "draft"));
  const lifecycleId = cleanId(safeGet(query, "lifecycleId")) ?? cleanId(safeGet(query, "lifecycle"));
  const explicitSource = cleanId(safeGet(query, "source"));
  const explicitSourceLabel = cleanId(safeGet(query, "sourceLabel"));
  let source: string | null = explicitSource;
  if (source === null) {
    if (lifecycleId !== null) source = "lifecycle";
    else if (studioMode !== null || draftId !== null) source = "studio";
  }
  let sourceLabel: string | null = explicitSourceLabel;
  if (sourceLabel === null) {
    const lowered = source !== null ? source.toLowerCase() : null;
    if (lowered === "hedges") sourceLabel = "Hedge Builder";
    else if (lowered === "lifecycle") sourceLabel = "Lifecycle";
    else if (lowered === "studio" || lowered === "strategies") sourceLabel = "Strategy Studio";
    else if (lifecycleId !== null) sourceLabel = "Lifecycle";
    else if (studioMode !== null || draftId !== null) sourceLabel = "Strategy Studio";
  }
  const legRaw = safeGet(query, "leg");
  const legIdRaw = safeGet(query, "legId");
  const legId = cleanId(legIdRaw) ?? cleanId(legRaw);
  const exposureId = cleanId(safeGet(query, "exposureId")) ?? cleanId(safeGet(query, "exposure"));
  const direction = parseDirection(safeGet(query, "direction"));
  const lots = parseLots(safeGet(query, "lots"));
  const maxCloseCost = parseCost(safeGet(query, "maxCloseCost"));
  const guarantee = parseGuarantee(safeGet(query, "guarantee"));
  const isLifecycle = (source !== null && source.toLowerCase() === "lifecycle") || lifecycleId !== null;
  const intentRaw = safeGet(query, "intent");
  let wantsExit = false;
  if (intentRaw !== null) {
    const normalized = intentRaw.trim().toLowerCase().replace(/[\s_\-]+/g, "");
    wantsExit = normalized === "exit" || normalized === "derisk";
  }
  const intent: "ENTER" | "EXIT" = isLifecycle && wantsExit ? "EXIT" : "ENTER";
  const hedgeRaw = safeGet(query, "hedge");
  const hedgeBreak = hedgeRaw !== null && hedgeRaw.trim().toLowerCase() === "break";
  const hasLeg = legRaw !== null || legIdRaw !== null;
  const blockedReason = hedgeBreak || hasLeg ? "Direct leg orders cannot be represented by the package terminal." : null;
  return {
    present: true,
    key,
    source,
    sourceLabel,
    studioMode,
    draftId,
    lifecycleId,
    legId,
    exposureId,
    direction,
    intent,
    lots,
    maxCloseCost,
    guarantee,
    blockedReason,
  };
}
