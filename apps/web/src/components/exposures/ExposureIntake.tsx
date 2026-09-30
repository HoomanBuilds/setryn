"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileUp, Plus, ShieldCheck } from "lucide-react";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SMALL } from "@/components/home/kit";
import { Chip, DeskTabs, Panel, TabBody, deskMotion } from "@/components/strategies/desk/Desk";
import { Segmented } from "@/components/terminal/primitives";
import { REFERENCE_ASSETS, RISK_OBJECTIVES, horizonDays, stableExposureId, validateExposure } from "@/lib/hedges/engine";
import type { RiskObjective } from "@/lib/hedges/types";
import { EXPOSURE_TYPES, directionForType } from "@/lib/exposures/book";
import {
  EXAMPLE_EXPOSURE_CSV,
  createExposure,
  exposureInput,
  hedgeBuilderHref,
  parseExposureCsv,
  type ExposureDraft,
} from "@/lib/exposures/records";
import type { ExposureCertainty, ExposureRecord, ExposureType } from "@/lib/exposures/types";
import { AssetIcon } from "@/components/icons/AssetIcon";

const FIELD =
  "focus-ring mt-1 h-11 w-full rounded-md border border-line bg-inset px-2 text-xs text-ink transition-colors hover:border-line-strong lg:h-8";

const AMOUNT_PRESETS = [
  { value: "100000", label: "100k" },
  { value: "250000", label: "250k" },
  { value: "1000000", label: "1M" },
  { value: "5000000", label: "5M" },
];

type Mode = "add" | "import";

export function ExposureIntake({
  existingIds,
  onAdd,
  onImport,
}: {
  existingIds: ReadonlySet<string>;
  onAdd: (record: ExposureRecord) => void;
  onImport: (records: ExposureRecord[], batch: string) => { added: number; duplicates: number };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("add");
  const [type, setType] = useState<ExposureType>("RECEIVABLE");
  const [asset, setAsset] = useState("EUR");
  const [amountInput, setAmountInput] = useState("250000");
  const [date, setDate] = useState("2026-12-30");
  const [certainty, setCertainty] = useState<ExposureCertainty>("CONFIRMED");
  const [objective, setObjective] = useState<RiskObjective>("LOCK_RATE");
  const [label, setLabel] = useState("");
  const [csv, setCsv] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const draft: ExposureDraft = {
    type,
    referenceAssetId: asset,
    settlementAssetId: "USDC",
    amount: Number(amountInput),
    exposureDateIso: date,
    riskObjective: objective,
    certainty,
    label,
  };
  const input = exposureInput(draft);
  const validation = validateExposure(input);
  const duplicate = validation.valid && existingIds.has(stableExposureId(input));
  const horizon = horizonDays(date);
  const typeInfo = EXPOSURE_TYPES.find((item) => item.value === type);

  const add = (protect: boolean) => {
    if (!validation.valid || duplicate) return;
    const record = createExposure(draft, "MANUAL", null, new Date().toISOString());
    onAdd(record);
    setLabel("");
    setMessage({ tone: "ok", text: `${record.label} added to the book.` });
    if (protect) router.push(hedgeBuilderHref(record));
  };

  const batch = "CSV import";
  const parsed = useMemo(() => (csv.trim() ? parseExposureCsv(csv, batch, "") : []), [csv]);
  const valid = parsed.filter((row) => row.record !== null);
  const errors = parsed.filter((row) => row.error !== null);

  const importRows = () => {
    const createdAt = new Date().toISOString();
    const batchName = `CSV import ${createdAt.slice(0, 16).replace("T", " ")} UTC`;
    const rows = parseExposureCsv(csv, batchName, createdAt)
      .map((row) => row.record)
      .filter((record): record is ExposureRecord => record !== null);
    const result = onImport(rows, batchName);
    setMessage({
      tone: "ok",
      text: `${result.added} imported${result.duplicates > 0 ? `, ${result.duplicates} already in the book` : ""}.`,
    });
    if (result.added > 0) setCsv("");
  };

  return (
    <Panel label="Add or import exposures">
      <div className="flex h-10 shrink-0 items-stretch border-b border-line pr-3">
        <DeskTabs
          idBase="exposure-intake"
          items={[
            { id: "add", label: "Add exposure" },
            { id: "import", label: "Import CSV" },
          ]}
          value={mode}
          onChange={(id) => {
            setMode(id as Mode);
            setMessage(null);
          }}
        />
        <span className="ml-auto flex items-center">
          <Chip title="The exposure book is stored in this browser only">This browser</Chip>
        </span>
      </div>

      <TabBody key={mode} idBase="exposure-intake">
        {mode === "add" ? (
          <div className="space-y-3 p-3">
            <label className="block">
              <span className="flex items-baseline justify-between text-[11px] text-faint">
                Exposure type
                <span className="text-off">{directionForType(type) === "RECEIVABLE" ? "hedged with a short package" : "hedged with a long package"}</span>
              </span>
              <select value={type} onChange={(event) => setType(event.target.value as ExposureType)} className={FIELD}>
                {EXPOSURE_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-faint">{typeInfo?.hint}</span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-faint">Asset</span>
                <span className="relative block">
                  <select value={asset} onChange={(event) => setAsset(event.target.value)} className={`${FIELD} pl-7`}>
                    {REFERENCE_ASSETS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <AssetIcon symbol={asset} size={14} className="pointer-events-none absolute top-1/2 left-2 mt-0.5 -translate-y-1/2" />
                </span>
              </label>
              <label className="block">
                <span className="flex items-baseline justify-between text-[11px] text-faint">
                  Date
                  <span className="tnum font-mono text-off">{horizon === null ? "" : `${horizon}d`}</span>
                </span>
                <input
                  type="date"
                  value={date}
                  min="2026-09-23"
                  max="2028-12-31"
                  onChange={(event) => setDate(event.target.value)}
                  className={`${FIELD} font-mono [color-scheme:dark]`}
                />
              </label>
            </div>

            <div>
              <label className="block">
                <span className="flex items-baseline justify-between text-[11px] text-faint">
                  Amount
                  <span className="text-off">USDC equivalent</span>
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                  className={`${FIELD} tnum font-mono`}
                />
              </label>
              <div className="mt-1 grid grid-cols-4 gap-1" role="group" aria-label="Amount presets">
                {AMOUNT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setAmountInput(preset.value)}
                    aria-pressed={amountInput === preset.value}
                    className={`focus-ring tnum h-9 rounded-[4px] font-mono text-[11px] transition-colors lg:h-6 ${
                      amountInput === preset.value ? "bg-raised text-ink" : "text-faint hover:bg-raised hover:text-dim"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-faint">Certainty</span>
              <Segmented
                options={[
                  { value: "CONFIRMED" as ExposureCertainty, label: "Confirmed" },
                  { value: "FORECAST" as ExposureCertainty, label: "Forecast" },
                ]}
                value={certainty}
                onChange={setCertainty}
                label="Certainty"
                size="sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-faint">Objective</span>
                <select value={objective} onChange={(event) => setObjective(event.target.value as RiskObjective)} className={FIELD}>
                  {RISK_OBJECTIVES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] text-faint">Reference</span>
                <input
                  type="text"
                  value={label}
                  maxLength={80}
                  placeholder="Invoice, counterparty"
                  onChange={(event) => setLabel(event.target.value)}
                  className={FIELD}
                />
              </label>
            </div>

            {!validation.valid || duplicate ? (
              <ul
                aria-label="Exposure issues"
                className={`${deskMotion.slideDown} space-y-1 rounded-md border border-down/30 bg-down-soft p-2.5 text-xs leading-snug text-dim`}
              >
                {(duplicate ? ["This exposure is already in the book."] : validation.reasons).map((reason) => (
                  <li key={reason} className="flex items-start gap-1.5">
                    <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-down" />
                    {reason}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => add(false)} disabled={!validation.valid || duplicate} className={BUTTON_GHOST}>
                <Plus size={13} aria-hidden="true" />
                Add to book
              </button>
              <button type="button" onClick={() => add(true)} disabled={!validation.valid || duplicate} className={BUTTON_PRIMARY}>
                <ShieldCheck size={13} aria-hidden="true" />
                Add and protect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-faint">
                <span className="tnum font-mono text-dim">type, asset, amount, date, certainty, label</span>
              </span>
              <button type="button" onClick={() => setCsv(EXAMPLE_EXPOSURE_CSV)} className={BUTTON_SMALL}>
                Paste example
              </button>
            </div>
            <label className="block">
              <span className="sr-only">CSV rows</span>
              <textarea
                value={csv}
                onChange={(event) => setCsv(event.target.value)}
                rows={8}
                spellCheck={false}
                placeholder={"receivable,EUR,250000,2026-12-30,confirmed,Invoice 2291\npayable,EUR,90000,2027-01-15,forecast,Supplier run"}
                className="focus-ring scroll-thin tnum w-full resize-y rounded-md border border-line bg-inset p-2 font-mono text-[11px] leading-relaxed text-ink transition-colors hover:border-line-strong"
              />
            </label>
            {parsed.length > 0 ? (
              <div className={`${deskMotion.slideDown} rounded-md border border-line bg-inset text-[11px]`}>
                <div className="flex items-center justify-between border-b border-line-soft px-2.5 py-1.5">
                  <span className="text-dim">{`${valid.length} valid`}</span>
                  <span className={errors.length ? "text-down" : "text-faint"}>{`${errors.length} rejected`}</span>
                </div>
                <ul className="scroll-thin max-h-[140px] overflow-y-auto">
                  {parsed.map((row) => (
                    <li key={row.line} className="flex items-start gap-2 border-b border-line-soft px-2.5 py-1 last:border-b-0">
                      <span className="tnum w-6 shrink-0 font-mono text-off">{row.line}</span>
                      {row.record ? (
                        <span className="min-w-0 flex-1 truncate text-dim">
                          {`${row.record.referenceAssetId} ${row.record.type.toLowerCase().replace("_", " ")} ${row.record.amount.toLocaleString("en-US")} on ${row.record.exposureDateIso}`}
                          {existingIds.has(row.record.id) ? <span className="text-faint"> / in book</span> : null}
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1 text-down">{row.error}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[11px] leading-snug text-faint">
                Paste rows from an accounting or treasury export. Each row is validated with the hedge engine before it
                enters the book, and a row already in the book is skipped.
              </p>
            )}
            <button type="button" onClick={importRows} disabled={valid.length === 0} className={`${BUTTON_PRIMARY} w-full`}>
              <FileUp size={13} aria-hidden="true" />
              {valid.length > 0 ? `Import ${valid.length} ${valid.length === 1 ? "row" : "rows"}` : "Import"}
            </button>
          </div>
        )}
      </TabBody>
      {message ? (
        <p role="status" className={`border-t border-line px-3 py-2 text-[11px] ${message.tone === "ok" ? "text-dim" : "text-down"}`}>
          {message.text}
        </p>
      ) : null}
    </Panel>
  );
}
