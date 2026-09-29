"use client";

import { useState } from "react";
import { Copy, Lock, Plus, X } from "lucide-react";
import { Segmented } from "@/components/terminal/primitives";
import {
  Chip,
  DeskTabs,
  Panel,
  PanelHead,
  Stepper,
  TabBody,
  TH,
  TH_NUM,
  deskMotion,
} from "@/components/strategies/desk/Desk";
import { familyLabel, markLabel } from "@/components/strategies/studio-model";
import { formatLots, formatNumber, formatSigned } from "@/lib/terminal/format";
import type {
  CompiledPackageDraft,
  DraftLeg,
  InstrumentOption,
  PackageDirection,
  PackageDraft,
} from "@/lib/strategies/types";
import type { Qualification } from "@/lib/terminal/types";

const DIRECTIONS: { value: PackageDirection; label: string }[] = [
  { value: "LONG", label: "Long package" },
  { value: "SHORT", label: "Short package" },
];

const LOT_PRESETS = [1, 5, 10, 25, 50, 100];

function qualificationTone(qualification: Qualification): string {
  if (qualification === "QUALIFIED") return "text-up";
  if (qualification === "CONDITIONAL") return "text-brand";
  return "text-down";
}

function qualificationDot(qualification: Qualification): string {
  if (qualification === "QUALIFIED") return "bg-up";
  if (qualification === "CONDITIONAL") return "bg-brand";
  return "bg-down";
}

export function LegsPanel({
  draft,
  compiled,
  catalog,
  availableInstruments,
  selectedInstrument,
  onSelectInstrument,
  onDirection,
  onLots,
  onUpdateLeg,
  onRemoveLeg,
  onAddLeg,
  onCopyToGraph,
}: {
  draft: PackageDraft;
  compiled: CompiledPackageDraft;
  catalog: Map<string, InstrumentOption>;
  availableInstruments: InstrumentOption[];
  selectedInstrument: string;
  onSelectInstrument: (id: string) => void;
  onDirection: (direction: PackageDirection) => void;
  onLots: (lots: number) => void;
  onUpdateLeg: (id: string, patch: Partial<Pick<DraftLeg, "side" | "ratio">>) => void;
  onRemoveLeg: (id: string) => void;
  onAddLeg: () => void;
  onCopyToGraph: () => void;
}) {
  const [tab, setTab] = useState("LEGS");
  const locked = draft.mode === "TEMPLATE";
  const dirSign = draft.direction === "LONG" ? 1 : -1;
  const payload = compiled.canonicalPayload.length > 0 ? compiled.canonicalPayload.split("|") : [];
  const canAdd = !locked && selectedInstrument !== "" && draft.legs.length < 6;

  return (
    <Panel label="Package legs" delay={40}>
      <PanelHead
        tabs={
          <DeskTabs
            idBase="studio-legs"
            value={tab}
            onChange={setTab}
            items={[
              { id: "LEGS", label: "Legs", badge: draft.legs.length },
              { id: "PAYLOAD", label: "Canonical payload" },
            ]}
          />
        }
        tools={
          locked ? (
            <>
              <Chip tone="dim" title="Template legs are fixed by the listed market">
                <Lock size={9} aria-hidden="true" />
                Listed template
              </Chip>
              <button
                type="button"
                onClick={onCopyToGraph}
                className="focus-ring hidden h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink sm:inline-flex"
              >
                <Copy size={12} aria-hidden="true" />
                Copy into graph builder
              </button>
            </>
          ) : (
            <Chip tone="brand" title="Legs are editable in graph mode">
              Graph builder
            </Chip>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        <div className="w-full sm:w-[232px]">
          <Segmented
            options={DIRECTIONS}
            value={draft.direction}
            onChange={onDirection}
            label="Package direction"
            size="sm"
            tone="direction"
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Stepper
            value={draft.lots}
            onChange={onLots}
            min={1}
            max={10_000}
            step={1}
            label="Package lots"
            suffix="lots"
            className="w-[136px] shrink-0"
          />
          <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
            {LOT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onLots(preset)}
                aria-pressed={draft.lots === preset}
                className={`focus-ring tnum h-6 shrink-0 rounded-[4px] px-1.5 font-mono text-[11px] transition-colors ${
                  draft.lots === preset ? "bg-raised text-ink" : "text-faint hover:bg-raised hover:text-dim"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
        <span className="hidden text-[11px] text-faint 2xl:inline">
          {compiled.executable
            ? `${formatLots(compiled.firmDepthLots)} lots firm at listed depth`
            : "Max by listed depth"}
        </span>
      </div>

      {tab === "LEGS" ? (
        <TabBody idBase="studio-legs">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[340px] table-fixed border-collapse text-xs">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={`${TH} w-8 pr-0`}>#</th>
                  <th scope="col" className={`${TH} ${locked ? "w-[76px]" : "w-[108px]"}`}>Side</th>
                  <th scope="col" className={TH}>Instrument</th>
                  <th scope="col" className={`${TH_NUM} ${locked ? "w-[72px]" : "w-[128px]"}`}>Ratio</th>
                  <th scope="col" className={`${TH_NUM} hidden w-[124px] md:table-cell`}>Mark</th>
                  <th scope="col" className={`${TH_NUM} hidden w-[88px] sm:table-cell`}>Δ contrib.</th>
                  <th scope="col" className={`${TH} hidden w-[112px] 2xl:table-cell`}>Qualification</th>
                  <th scope="col" className={`${TH} w-9 px-1`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {draft.legs.map((leg, index) => {
                  const instrument = catalog.get(leg.instrumentId);
                  if (!instrument) return null;
                  const contribution =
                    (leg.side === "BUY" ? 1 : -1) * leg.ratio * instrument.deltaPerLot * dirSign;
                  return (
                    <tr key={leg.id} className={`${deskMotion.fade} group transition-colors hover:bg-raised/50`}>
                      <td className="tnum py-2 pr-0 pl-3 font-mono text-[11px] text-off">{index + 1}</td>
                      <td className="px-3 py-2">
                        {locked ? (
                          <span
                            className={`inline-flex h-6 items-center rounded-[4px] px-2 font-mono text-[11px] ${
                              leg.side === "BUY" ? "bg-up-soft text-up" : "bg-down-soft text-down"
                            }`}
                          >
                            {leg.side === "BUY" ? "Buy" : "Sell"}
                          </span>
                        ) : (
                          <div
                            role="radiogroup"
                            aria-label={`Side for leg ${index + 1}`}
                            className="inline-grid grid-cols-2 gap-0.5 rounded-md bg-inset p-0.5"
                          >
                            {(["BUY", "SELL"] as const).map((side) => (
                              <button
                                key={side}
                                type="button"
                                role="radio"
                                aria-checked={leg.side === side}
                                onClick={() => onUpdateLeg(leg.id, { side })}
                                className={`focus-ring h-6 rounded-[4px] px-2 font-mono text-[11px] transition-colors ${
                                  leg.side === side
                                    ? side === "BUY"
                                      ? "bg-up-soft text-up"
                                      : "bg-down-soft text-down"
                                    : "text-faint hover:text-dim"
                                }`}
                              >
                                {side === "BUY" ? "Buy" : "Sell"}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            title={instrument.qualification.toLowerCase()}
                            className={`h-1.5 w-1.5 shrink-0 rounded-full 2xl:hidden ${qualificationDot(instrument.qualification)}`}
                          />
                          <span className="truncate text-[13px] text-ink">{instrument.instrument}</span>
                        </span>
                        <span className="block truncate text-[11px] text-faint">
                          {`${instrument.asset} / ${familyLabel(instrument.family)} / ${
                            instrument.venueClass === "NATIVE_BOOK" ? "native book" : "implied component"
                          }`}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {locked ? (
                          <span className="tnum font-mono text-ink">{`${formatNumber(leg.ratio, 2)}x`}</span>
                        ) : (
                          <Stepper
                            value={leg.ratio}
                            onChange={(ratio) => onUpdateLeg(leg.id, { ratio })}
                            min={0.25}
                            max={10}
                            step={0.25}
                            decimals={2}
                            label={`ratio for leg ${index + 1}`}
                            className="ml-auto w-[104px]"
                          />
                        )}
                      </td>
                      <td className="tnum hidden px-3 py-2 text-right font-mono whitespace-nowrap text-dim md:table-cell">
                        {markLabel(instrument)}
                      </td>
                      <td
                        className={`tnum hidden px-3 py-2 text-right font-mono sm:table-cell ${
                          contribution > 0 ? "text-up" : contribution < 0 ? "text-down" : "text-dim"
                        }`}
                      >
                        {formatSigned(contribution, 2)}
                      </td>
                      <td className="hidden px-3 py-2 2xl:table-cell">
                        <span className={`inline-flex items-center gap-1.5 ${qualificationTone(instrument.qualification)}`}>
                          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${qualificationDot(instrument.qualification)}`} />
                          {instrument.qualification.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-1 py-2 text-center">
                        {locked ? (
                          <Lock size={12} aria-label="Locked by template" className="mx-auto text-off" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRemoveLeg(leg.id)}
                            aria-label={`Remove ${instrument.instrument}`}
                            className="focus-ring grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-down-soft hover:text-down"
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {draft.legs.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-faint">No legs yet. Add a typed leg below.</p>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-line bg-inset/60 px-3 py-2 text-[11px]">
            <span className="truncate text-faint">
              {`${compiled.legs.length} canonical legs / ${
                compiled.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "cash USDC"
              } settlement`}
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="text-faint">Net package delta</span>
              <span
                className={`tnum font-mono text-xs ${
                  compiled.netDelta > 0 ? "text-up" : compiled.netDelta < 0 ? "text-down" : "text-dim"
                }`}
              >
                {formatSigned(compiled.netDelta, 2)}
              </span>
            </span>
          </div>

          {locked ? null : (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Instrument to add</span>
                <select
                  value={selectedInstrument}
                  onChange={(event) => onSelectInstrument(event.target.value)}
                  disabled={availableInstruments.length === 0 || draft.legs.length >= 6}
                  className="focus-ring h-8 w-full min-w-0 rounded-md border border-line bg-inset px-2 text-xs text-ink transition-colors hover:border-line-strong disabled:opacity-50"
                >
                  {availableInstruments.length === 0 ? <option value="">No compatible instruments</option> : null}
                  {availableInstruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {`${instrument.instrument} (${instrument.asset} / ${familyLabel(instrument.family)})`}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={onAddLeg}
                disabled={!canAdd}
                className="focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-xs text-ink transition-colors hover:border-brand-edge disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={13} aria-hidden="true" />
                Add typed leg
              </button>
              <p className="w-full text-[11px] leading-snug text-faint">
                Same settlement class, maximum six legs, one canonical side per instrument.
              </p>
            </div>
          )}
          {locked ? (
            <div className="border-t border-line px-3 py-2 text-[11px] leading-snug text-faint sm:hidden">
              <button
                type="button"
                onClick={onCopyToGraph}
                className="focus-ring inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-line text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
              >
                <Copy size={12} aria-hidden="true" />
                Copy into graph builder
              </button>
            </div>
          ) : null}
        </TabBody>
      ) : (
        <TabBody idBase="studio-legs" className="px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-faint">Draft identity</span>
            <span className="tnum font-mono text-xs text-ink">{compiled.canonicalId}</span>
          </div>
          <ol className="mt-2 divide-y divide-line-soft rounded-md border border-line bg-inset">
            {payload.length === 0 ? (
              <li className="px-3 py-3 text-xs text-faint">No valid legs to canonicalize.</li>
            ) : (
              payload.map((entry, index) => (
                <li key={`${index}-${entry}`} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 px-3 py-1.5">
                  <span className="tnum font-mono text-[11px] text-off">{index}</span>
                  <span className="font-mono text-[11px] break-all text-dim">{entry}</span>
                </li>
              ))
            )}
          </ol>
          <p className="mt-2 text-[11px] leading-snug text-faint">
            Legs are sorted by family, instrument and side before hashing. The draft identity binds
            direction, lots and this payload, so equivalent graphs compile to the same id.
          </p>
        </TabBody>
      )}
    </Panel>
  );
}
