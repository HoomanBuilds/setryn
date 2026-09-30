"use client";

import { useState } from "react";
import { Chip, Metric, Panel, PanelHead, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import type { PartnerDeployment, UsageRow } from "./api";
import { MarketMark } from "@/components/portfolio/MarketMark";

const DAYS = 30;

function dayKeys(): string[] {
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Array.from({ length: DAYS }, (_, index) => new Date(today - (DAYS - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

function sum(rows: readonly UsageRow[], key: "impressions" | "clicks" | "blocked"): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

/** Widget usage analytics and partner-code attribution over the last 30 days. */
export function UsagePanel({ usage, partners }: { usage: UsageRow[]; partners: PartnerDeployment[] }) {
  const [partner, setPartner] = useState("");
  const rows = partner ? usage.filter((row) => row.partner === partner) : usage;
  const impressions = sum(rows, "impressions");
  const clicks = sum(rows, "clicks");
  const blocked = sum(rows, "blocked");
  const registered = new Set(partners.map((item) => item.code));

  const byPartner = [...new Set(usage.map((row) => row.partner))]
    .map((code) => {
      const own = usage.filter((row) => row.partner === code);
      return { code, impressions: sum(own, "impressions"), clicks: sum(own, "clicks"), blocked: sum(own, "blocked"), registered: registered.has(code) };
    })
    .sort((left, right) => right.impressions - left.impressions);

  const byWidgetMarket = new Map<string, { widget: string; marketId: string; impressions: number; clicks: number }>();
  for (const row of rows) {
    const key = `${row.widget}|${row.marketId}`;
    const current = byWidgetMarket.get(key) ?? { widget: row.widget, marketId: row.marketId, impressions: 0, clicks: 0 };
    current.impressions += row.impressions;
    current.clicks += row.clicks;
    byWidgetMarket.set(key, current);
  }
  const placements = [...byWidgetMarket.values()].sort((left, right) => right.impressions - left.impressions).slice(0, 12);

  return (
    <div className="grid min-w-0 gap-1">
      <Panel label="Usage analytics">
        <PanelHead
          title="Usage analytics"
          tools={
            <>
              <label htmlFor="usage-partner" className="sr-only">Filter by partner</label>
              <select id="usage-partner" value={partner} onChange={(event) => setPartner(event.target.value)} className="focus-ring rounded-md border border-line-strong bg-inset px-2 py-0.5 text-xs text-ink">
                <option value="">All partners</option>
                {byPartner.map((item) => <option key={item.code} value={item.code}>{item.code}</option>)}
              </select>
              <Chip tone="dim">Last {DAYS} days</Chip>
            </>
          }
        />
        <div className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
          <Metric label="Widget impressions" value={impressions.toLocaleString("en-US")} />
          <Metric label="Trade deep-link clicks" value={clicks.toLocaleString("en-US")} />
          <Metric label="Click-through" value={impressions === 0 ? "—" : `${((clicks / impressions) * 100).toFixed(2)}%`} />
          <Metric label="Blocked loads" value={blocked.toLocaleString("en-US")} tone={blocked > 0 ? "down" : "neutral"} note="Permission or quota refusals" />
        </div>
        <DailyBars rows={rows} />
      </Panel>
      <div className="grid min-w-0 gap-1 xl:grid-cols-2">
        <Panel label="Attribution by partner code">
          <PanelHead title="Attribution by partner code" />
          <div role="region" aria-label="Attribution by partner code table" tabIndex={0} className="focus-ring scroll-thin min-w-0 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={TH}>Partner code</th>
                  <th scope="col" className={TH_NUM}>Impressions</th>
                  <th scope="col" className={TH_NUM}>Clicks</th>
                  <th scope="col" className={TH_NUM}>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {byPartner.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-dim">No widget loads recorded with a partner code yet.</td></tr>
                ) : (
                  byPartner.map((item) => (
                    <tr key={item.code} className="border-b border-line-soft">
                      <td className="px-3 py-2">
                        <span className="font-mono text-ink">{item.code}</span>{" "}
                        {item.registered ? null : <Chip tone="down">unregistered</Chip>}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-mono text-ink">{item.impressions.toLocaleString("en-US")}</td>
                      <td className="tnum px-3 py-2 text-right font-mono text-dim">{item.clicks.toLocaleString("en-US")}</td>
                      <td className="tnum px-3 py-2 text-right font-mono text-dim">{item.blocked.toLocaleString("en-US")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel label="Top placements">
          <PanelHead title="Top placements" />
          <div role="region" aria-label="Top placements table" tabIndex={0} className="focus-ring scroll-thin min-w-0 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={TH}>Widget</th>
                  <th scope="col" className={TH}>Market</th>
                  <th scope="col" className={TH_NUM}>Impressions</th>
                  <th scope="col" className={TH_NUM}>Clicks</th>
                </tr>
              </thead>
              <tbody>
                {placements.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-dim">No placements yet.</td></tr>
                ) : (
                  placements.map((item) => (
                    <tr key={`${item.widget}|${item.marketId}`} className="border-b border-line-soft">
                      <td className="px-3 py-2 text-ink">{item.widget}</td>
                      <td className="px-3 py-2 font-mono text-dim">
                        <span className="flex items-center gap-1.5">
                          {item.marketId === "ALL" ? null : <MarketMark code={item.marketId} size={14} />}
                          {item.marketId === "ALL" ? "all markets" : item.marketId}
                        </span>
                      </td>
                      <td className="tnum px-3 py-2 text-right font-mono text-ink">{item.impressions.toLocaleString("en-US")}</td>
                      <td className="tnum px-3 py-2 text-right font-mono text-dim">{item.clicks.toLocaleString("en-US")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** Single-series daily impression bars with per-bar hover and a screen-reader table. */
function DailyBars({ rows }: { rows: readonly UsageRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = dayKeys();
  const values = days.map((day) => {
    const own = rows.filter((row) => row.day === day);
    return { day, impressions: sum(own, "impressions"), clicks: sum(own, "clicks") };
  });
  const max = Math.max(1, ...values.map((value) => value.impressions));
  const height = 120;
  const active = hover === null ? values[values.length - 1] : values[hover];

  return (
    <figure className="px-3 py-3">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3 text-xs">
        <span className="text-dim">Daily widget impressions</span>
        <span className="tnum font-mono text-[11px] text-dim">
          {active.day}: {active.impressions.toLocaleString("en-US")} impressions, {active.clicks.toLocaleString("en-US")} clicks
        </span>
      </figcaption>
      <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)} aria-hidden="true">
        <div className="absolute inset-x-0 bottom-0 h-px bg-line-strong" />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {values.map((value, index) => (
            <div key={value.day} className="flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(index)}>
              <div
                className={`w-full rounded-t-[4px] ${hover === index ? "bg-brand" : "bg-brand/60"}`}
                style={{ height: value.impressions === 0 ? 0 : Math.max(2, (value.impressions / max) * (height - 4)) }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-faint" aria-hidden="true">
        <span>{days[0].slice(5)}</span>
        <span>{days[days.length - 1].slice(5)}</span>
      </div>
      <table className="sr-only">
        <caption>Daily widget impressions and clicks</caption>
        <thead>
          <tr><th scope="col">Day</th><th scope="col">Impressions</th><th scope="col">Clicks</th></tr>
        </thead>
        <tbody>
          {values.map((value) => (
            <tr key={value.day}><td>{value.day}</td><td>{value.impressions}</td><td>{value.clicks}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
