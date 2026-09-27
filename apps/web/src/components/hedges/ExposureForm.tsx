"use client";

import { Segmented } from "@/components/terminal/primitives";
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
  onDirection: (direction: HedgeDirection) => void;
  onReference: (id: string) => void;
  onSettlement: (id: string) => void;
  onAmount: (raw: string) => void;
  onDate: (iso: string) => void;
  onObjective: (objective: RiskObjective) => void;
}

export function ExposureForm({
  exposure,
  amountInput,
  validation,
  onDirection,
  onReference,
  onSettlement,
  onAmount,
  onDate,
  onObjective,
}: ExposureFormProps) {
  return (
    <section aria-label="Exposure intake" className="border border-line bg-panel">
      <div className="border-b border-line px-3 py-2.5">
        <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">
          Exposure intake
        </span>
        <p className="mt-1 text-xs text-dim">Dated cash flow. Client state only.</p>
      </div>

      <div className="space-y-3 p-3">
        <div>
          <span className="mb-1 block text-xs text-faint">Direction</span>
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
          <p className="mt-1 text-xs text-faint">
            {exposure.direction === "RECEIVABLE"
              ? "Will receive value. Maps to a SHORT package."
              : "Must pay value. Maps to a LONG package."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-faint">Reference</span>
            <select
              value={exposure.referenceAssetId}
              onChange={(event) => onReference(event.target.value)}
              className="focus-ring mt-1 h-9 w-full rounded-md border border-line bg-inset px-2 text-xs text-ink"
            >
              {REFERENCE_ASSETS.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-faint">Settlement</span>
            <select
              value={exposure.settlementAssetId}
              onChange={(event) => onSettlement(event.target.value)}
              className="focus-ring mt-1 h-9 w-full rounded-md border border-line bg-inset px-2 text-xs text-ink"
            >
              {SETTLEMENT_ASSETS.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-faint">Amount (USDC equiv.)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={amountInput}
              onChange={(event) => onAmount(event.target.value)}
              placeholder="250000"
              className="focus-ring tnum mt-1 h-9 w-full rounded-md border border-line bg-inset px-2 font-mono text-xs text-ink"
            />
          </label>
          <label className="block">
            <span className="text-xs text-faint">Cash-flow date</span>
            <input
              type="date"
              value={exposure.exposureDateIso}
              min="2026-09-23"
              max="2028-12-31"
              onChange={(event) => onDate(event.target.value)}
              className="focus-ring mt-1 h-9 w-full rounded-md border border-line bg-inset px-2 font-mono text-xs text-ink"
            />
          </label>
        </div>

        <div>
          <span className="mb-1 block text-xs text-faint">Risk objective</span>
          <Segmented
            options={RISK_OBJECTIVES.map((item) => ({
              value: item.value,
              label: item.label,
              title: item.hint,
            }))}
            value={exposure.riskObjective}
            onChange={onObjective}
            label="Risk objective"
            size="sm"
          />
        </div>

        {validation.valid ? null : (
          <ul aria-label="Exposure issues" className="rounded-md border border-down/30 bg-down-soft p-2.5 text-xs leading-snug text-dim">
            {validation.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
