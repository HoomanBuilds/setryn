import {
  RISK_OBJECTIVES,
  SETTLEMENT_ASSETS,
  referenceAssetById,
  stableExposureId,
  validateExposure,
} from "@/lib/hedges/engine";
import type { ExposureInput, HedgeDirection, RiskObjective } from "@/lib/hedges/types";
import { directionForType, EXPOSURE_TYPES } from "./book";
import type { ExposureCertainty, ExposureRecord, ExposureSource, ExposureType } from "./types";

/** Per-viewer browser storage key for the exposure book. */
export const EXPOSURE_BOOK_KEY = "setryn:exposures:book";
export const EMPTY_EXPOSURE_BOOK: ExposureRecord[] = [];
export const MAX_EXPOSURES = 200;

export interface ExposureDraft {
  type: ExposureType;
  referenceAssetId: string;
  settlementAssetId: string;
  amount: number;
  exposureDateIso: string;
  riskObjective: RiskObjective;
  certainty: ExposureCertainty;
  label: string;
}

export function exposureInput(draft: Pick<ExposureDraft, "type" | "referenceAssetId" | "settlementAssetId" | "amount" | "exposureDateIso" | "riskObjective">): ExposureInput {
  return {
    direction: directionForType(draft.type),
    referenceAssetId: draft.referenceAssetId,
    settlementAssetId: draft.settlementAssetId,
    amount: draft.amount,
    exposureDateIso: draft.exposureDateIso,
    riskObjective: draft.riskObjective,
  };
}

export function createExposure(
  draft: ExposureDraft,
  source: ExposureSource,
  batch: string | null,
  createdAt: string,
): ExposureRecord {
  const input = exposureInput(draft);
  const label = draft.label.trim().slice(0, 80);
  return {
    ...input,
    id: stableExposureId(input),
    type: draft.type,
    label: label.length > 0 ? label : `${referenceAssetById(draft.referenceAssetId)?.label ?? draft.referenceAssetId} ${draft.type.toLowerCase().replace(/_/g, " ")}`,
    certainty: draft.certainty,
    source,
    batch,
    createdAt,
  };
}

const TYPES = new Set<string>(EXPOSURE_TYPES.map((item) => item.value));
const OBJECTIVES = new Set<string>(RISK_OBJECTIVES.map((item) => item.value));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown): ExposureRecord | null {
  if (!isRecord(value)) return null;
  const { id, type, label, certainty, source, batch, createdAt, direction, referenceAssetId, settlementAssetId, amount, exposureDateIso, riskObjective } = value;
  if (typeof id !== "string" || typeof type !== "string" || !TYPES.has(type)) return null;
  if (typeof label !== "string" || (certainty !== "FORECAST" && certainty !== "CONFIRMED")) return null;
  if (source !== "MANUAL" && source !== "IMPORTED") return null;
  if (batch !== null && typeof batch !== "string") return null;
  if (typeof createdAt !== "string" || (direction !== "RECEIVABLE" && direction !== "PAYABLE")) return null;
  if (typeof referenceAssetId !== "string" || typeof settlementAssetId !== "string") return null;
  if (typeof amount !== "number" || !Number.isFinite(amount) || typeof exposureDateIso !== "string") return null;
  if (typeof riskObjective !== "string" || !OBJECTIVES.has(riskObjective)) return null;
  return {
    id,
    type: type as ExposureType,
    label: label.slice(0, 80),
    certainty,
    source,
    batch,
    createdAt,
    direction: direction as HedgeDirection,
    referenceAssetId,
    settlementAssetId,
    amount,
    exposureDateIso,
    riskObjective: riskObjective as RiskObjective,
  };
}

/** Storage parser for `usePersistentState`: keeps well-formed rows, drops the rest. */
export function parseExposureBook(value: unknown): ExposureRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(parseRecord).filter((row): row is ExposureRecord => row !== null).slice(0, MAX_EXPOSURES);
}

/* CSV import ---------------------------------------------------------------------------------------------------- */

export const CSV_COLUMNS = ["type", "asset", "amount", "date", "certainty", "label"] as const;

const TYPE_ALIASES: Record<string, ExposureType> = {
  receivable: "RECEIVABLE",
  ar: "RECEIVABLE",
  payable: "PAYABLE",
  ap: "PAYABLE",
  inventory: "INVENTORY",
  stock: "INVENTORY",
  debt: "DEBT",
  loan: "DEBT",
  treasury: "TREASURY",
  reserve: "TREASURY",
  "token unlock": "TOKEN_UNLOCK",
  token_unlock: "TOKEN_UNLOCK",
  unlock: "TOKEN_UNLOCK",
  vesting: "TOKEN_UNLOCK",
  investment: "INVESTMENT",
};

export interface CsvRowResult {
  line: number;
  raw: string;
  record: ExposureRecord | null;
  error: string | null;
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Parses `type,asset,amount,date,certainty,label` rows. A header row is skipped, amounts accept thousands
 * separators, and every row runs through the hedge engine's own validation so an imported exposure is exactly as
 * valid as one typed into the form.
 */
export function parseExposureCsv(text: string, batch: string, createdAt: string, objective: RiskObjective = "LOCK_RATE"): CsvRowResult[] {
  const rows: CsvRowResult[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) return;
    const cells = splitCsv(line);
    if (index === 0 && cells[0]?.toLowerCase() === "type") return;
    const fail = (error: string) => rows.push({ line: index + 1, raw: line, record: null, error });
    if (cells.length < 4) return fail("Expected type, asset, amount, date.");
    const type = TYPE_ALIASES[cells[0].toLowerCase()];
    if (!type) return fail(`Unknown type "${cells[0]}".`);
    const asset = cells[1].toUpperCase();
    if (!referenceAssetById(asset)) return fail(`Unknown asset "${cells[1]}".`);
    const amount = Number(cells[2].replace(/[,_\s]/g, ""));
    const certaintyCell = (cells[4] ?? "").toLowerCase();
    const certainty: ExposureCertainty = certaintyCell.startsWith("conf") ? "CONFIRMED" : "FORECAST";
    const draft: ExposureDraft = {
      type,
      referenceAssetId: asset,
      settlementAssetId: SETTLEMENT_ASSETS[0].id,
      amount,
      exposureDateIso: cells[3],
      riskObjective: objective,
      certainty,
      label: cells.slice(5).join(", "),
    };
    const validation = validateExposure(exposureInput(draft));
    if (!validation.valid) return fail(validation.reasons[0] ?? "Invalid exposure.");
    rows.push({ line: index + 1, raw: line, record: createExposure(draft, "IMPORTED", batch, createdAt), error: null });
  });
  return rows;
}

/** A small treasury book in the importer's own format, for trying the netting and coverage views. */
export const EXAMPLE_EXPOSURE_CSV = [
  "type,asset,amount,date,certainty,label",
  "receivable,EUR,250000,2026-12-30,confirmed,Invoice INV-2291 Lyon distributor",
  "payable,EUR,90000,2027-01-15,forecast,Frankfurt supplier Q1 run",
  "treasury,BTC,400000,2026-12-24,confirmed,Year-end BTC reserve",
  "debt,BTC,150000,2027-01-08,forecast,BTC-denominated credit line",
  "token unlock,ETH,180000,2027-03-26,forecast,Series A token cliff",
  "inventory,XAU,120000,2027-06-29,forecast,Bullion inventory",
  "investment,ARB,60000,2027-03-26,confirmed,ARB ecosystem allocation",
].join("\n");

/** Merges new rows into the book by id; a row already in the book is not duplicated. */
export function mergeExposures(book: readonly ExposureRecord[], rows: readonly ExposureRecord[]): { book: ExposureRecord[]; added: number; duplicates: number } {
  const ids = new Set(book.map((row) => row.id));
  const next = [...book];
  let added = 0;
  let duplicates = 0;
  for (const row of rows) {
    if (ids.has(row.id)) {
      duplicates += 1;
      continue;
    }
    if (next.length >= MAX_EXPOSURES) break;
    ids.add(row.id);
    next.push(row);
    added += 1;
  }
  return { book: next, added, duplicates };
}

/* Hedge builder hand-off ------------------------------------------------------------------------------------------ */

/**
 * Query contract for opening the hedge builder with an exposure prefilled. `/protect/new` forwards the same query.
 * `amount` defaults to the full exposure; pass the residual to protect only what netting and positions leave open.
 */
export function hedgeBuilderHref(record: ExposureRecord, amount: number = record.amount): string {
  const params = new URLSearchParams({
    source: "exposures",
    sourceLabel: "Exposures",
    exposure: record.id,
    direction: record.direction.toLowerCase(),
    asset: record.referenceAssetId,
    settlement: record.settlementAssetId,
    amount: String(Math.round(amount * 100) / 100),
    date: record.exposureDateIso,
    objective: record.riskObjective,
  });
  return `/hedges?${params.toString()}`;
}

export interface HedgePrefill {
  exposureId: string | null;
  input: ExposureInput;
}

/**
 * Reads the hand-off query back into a validated hedge-engine input, for the hedge builder to seed its form.
 * Returns null when the query does not describe a complete exposure.
 */
export function hedgePrefillFromQuery(query: { get(name: string): string | null }): HedgePrefill | null {
  const direction = query.get("direction")?.toUpperCase();
  const asset = query.get("asset")?.toUpperCase();
  const settlement = (query.get("settlement") ?? "USDC").toUpperCase();
  const amount = Number(query.get("amount"));
  const date = query.get("date") ?? "";
  const objective = (query.get("objective") ?? "LOCK_RATE").toUpperCase();
  if (direction !== "RECEIVABLE" && direction !== "PAYABLE") return null;
  if (!asset || !OBJECTIVES.has(objective)) return null;
  const input: ExposureInput = {
    direction,
    referenceAssetId: asset,
    settlementAssetId: settlement,
    amount,
    exposureDateIso: date,
    riskObjective: objective as RiskObjective,
  };
  if (!validateExposure(input).valid) return null;
  const exposure = query.get("exposure");
  return { exposureId: exposure && /^EXP-[0-9A-F]{8}$/.test(exposure) ? exposure : null, input };
}
