"use client";

import { AlertTriangle } from "lucide-react";
import { Segmented } from "@/components/terminal/primitives";
import { Chip, Panel, PanelHead, deskMotion } from "@/components/strategies/desk/Desk";
import {
  REFERENCE_ASSETS,
  RISK_OBJECTIVES,
  SETTLEMENT_ASSETS,
} from "@/lib/hedges/engine";
import type {
  ExposureInput,
  ExposureValidation,
  HedgeDirection,
  RiskObjective,
} from "@/lib/hedges/types";

interface ExposureFormProps {
  exposure: ExposureInput;
  amountInput: string;
  validation: ExposureValidation;
  horizonDays: number | null;
  onDirection: (direction: HedgeDirection) => void;
  onReference: (id: string) => void;
  onSettlement: (id: string) => void;
  onAmount: (raw: string) => void;
  onDate: (iso: string) => void;
  onObjective: (objective: RiskObjective) => void;
}

const AMOUNT_PRESETS = [
  { value: "100000", label: "100k" },
  { value: "250000", label: "250k" },
  { value: "1000000", label: "1M" },
  { value: "5000000", label: "5M" },
];

const FIELD =
  "focus-ring mt-1 h-8 w-full rounded-md border border-line bg-inset px-2 text-xs text-ink transition-colors hover:border-line-strong";

export function ExposureForm({
  exposure,
  amountInput,
  validation,
  horizonDays,
  onDirection,
  onReference,
  onSettlement,
  onAmount,
  onDate,
  onObjective,
}: ExposureFormProps) {
  return (
    <Panel label="Exposure intake">
      <PanelHead title="Exposure" tools={<Chip title="Inputs stay in this browser">Client state</Chip>} />

      <div className="space-y-3 p-3">
        <div>
          <span className="mb-1 block text-[11px] text-faint">Direction</span>
          <Segmented
            options={[
              { value: "RECEIVABLE" as HedgeDirection, label: "Receivable" },
              { value: "PAYABLE" as HedgeDirection, label: "Payable" },
            ]}
            value={exposure.direction}
            onChange={onDirection}
            label="Exposure direction"
            size="sm"
            tone="direction"
          />
          <p className="mt-1.5 text-[11px] leading-snug text-faint">
            {exposure.direction === "RECEIVABLE"
              ? "Will receive value. Maps to a SHORT package."
              : "Must pay value. Maps to a LONG package."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-faint">Reference</span>
            <select value={exposure.referenceAssetId} onChange={(event) => onReference(event.target.value)} className={FIELD}>
              {REFERENCE_ASSETS.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-faint">Settlement</span>
            <select value={exposure.settlementAssetId} onChange={(event) => onSettlement(event.target.value)} className={FIELD}>
              {SETTLEMENT_ASSETS.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.label}
                </option>
              ))}
            </select>
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
              onChange={(event) => onAmount(event.target.value)}
              placeholder="250000"
              className={`${FIELD} tnum font-mono`}
            />
          </label>
          <div className="mt-1 grid grid-cols-4 gap-1" role="group" aria-label="Amount presets">
            {AMOUNT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => onAmount(preset.value)}
                aria-pressed={amountInput === preset.value}
                className={`focus-ring tnum h-6 rounded-[4px] font-mono text-[11px] transition-colors ${
                  amountInput === preset.value ? "bg-raised text-ink" : "text-faint hover:bg-raised hover:text-dim"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="flex items-baseline justify-between text-[11px] text-faint">
            Cash-flow date
            <span className="tnum font-mono text-off">
              {horizonDays === null ? "no date" : `${horizonDays}d horizon`}
            </span>
          </span>
          <input
            type="date"
            value={exposure.exposureDateIso}
            min="2026-09-23"
            max="2028-12-31"
            onChange={(event) => onDate(event.target.value)}
            className={`${FIELD} font-mono [color-scheme:dark]`}
          />
        </label>

        <fieldset>
          <legend className="mb-1 text-[11px] text-faint">Risk objective</legend>
          <div className="space-y-1" role="radiogroup" aria-label="Risk objective">
            {RISK_OBJECTIVES.map((item) => {
              const selected = exposure.riskObjective === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onObjective(item.value)}
                  className={`focus-ring flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-150 ${
                    selected ? "border-brand-edge/60 bg-brand-soft/60" : "border-line hover:border-line-strong hover:bg-raised/60"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border transition-colors ${
                      selected ? "border-brand" : "border-line-strong"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full bg-brand transition-transform duration-150 ${
                        selected ? "scale-100" : "scale-0"
                      }`}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-xs ${selected ? "text-ink" : "text-dim"}`}>{item.label}</span>
                    <span className="block text-[11px] leading-snug text-faint">{item.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {validation.valid ? null : (
          <ul
            aria-label="Exposure issues"
            className={`${deskMotion.slideDown} space-y-1 rounded-md border border-down/30 bg-down-soft p-2.5 text-xs leading-snug text-dim`}
          >
            {validation.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-1.5">
                <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-down" />
                {reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
