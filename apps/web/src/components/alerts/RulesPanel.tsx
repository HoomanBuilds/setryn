"use client";

import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { BUTTON_PRIMARY } from "@/components/home/kit";
import { Chip, Flash, Panel, PanelHead, Stepper, Switch } from "@/components/strategies/desk/Desk";
import { Segmented } from "@/components/terminal/primitives";
import {
  RULE_KIND_LABEL,
  SEVERITY_LABEL,
  describeRule,
  formatHours,
  hoursToFixing,
  newRuleId,
  ruleAlertPrefix,
  type AlertLedger,
  type AlertRule,
  type AlertRuleKind,
  type AlertSeverity,
} from "@/lib/alerts";
import { formatMultiple, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";

const FIELD =
  "focus-ring mt-1 h-11 w-full rounded-md border border-line bg-inset px-2 text-xs text-ink transition-colors hover:border-line-strong lg:h-8";

const KINDS: { value: AlertRuleKind; label: string }[] = [
  { value: "PRICE_CROSS", label: "Price" },
  { value: "HEALTH_BELOW", label: "Health" },
  { value: "FIXING_WITHIN", label: "Fixing" },
  { value: "RFQ_QUOTE", label: "RFQ" },
];

const SEVERITIES: { value: AlertSeverity; label: string }[] = [
  { value: "CRITICAL", label: "Critical" },
  { value: "WARNING", label: "Warning" },
  { value: "NOTICE", label: "Notice" },
];

export function NewRulePanel({
  markets,
  previewEpochSeconds,
  health,
  heldMarketIds,
  onCreate,
}: {
  markets: readonly PackageMarket[];
  previewEpochSeconds: number;
  /** Current maintenance health, or null when no margin is in use. */
  health: number | null;
  heldMarketIds: readonly string[];
  onCreate: (rule: AlertRule) => void;
}) {
  const [kind, setKind] = useState<AlertRuleKind>("PRICE_CROSS");
  const [severity, setSeverity] = useState<AlertSeverity>("WARNING");
  const [marketId, setMarketId] = useState(markets[0]?.id ?? "");
  const [levelInput, setLevelInput] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(1.5);
  const [hours, setHours] = useState(96);
  const [scope, setScope] = useState<"HELD" | "LISTED">("LISTED");
  const [notice, setNotice] = useState<string | null>(null);

  const market = markets.find((candidate) => candidate.id === marketId) ?? markets[0];
  // Until the viewer types a level, it tracks five ticks above the live mark.
  const suggested = market ? (market.netPrice + market.tickSize * 5).toFixed(market.priceDecimals) : "";
  const levelText = levelInput ?? suggested;
  const level = Number(levelText);
  const levelValid = market !== undefined && Number.isFinite(level) && levelText.trim() !== "";
  const direction: "ABOVE" | "BELOW" = market && level < market.netPrice ? "BELOW" : "ABOVE";

  const fixingCandidates = markets.filter((candidate) => (scope === "HELD" ? heldMarketIds.includes(candidate.id) : true));
  const fixingNow = fixingCandidates.filter((candidate) => {
    const left = hoursToFixing(candidate, previewEpochSeconds);
    return left > 0 && left <= hours;
  });
  const nearest = [...fixingCandidates]
    .map((candidate) => ({ candidate, left: hoursToFixing(candidate, previewEpochSeconds) }))
    .filter((entry) => entry.left > 0)
    .sort((a, b) => a.left - b.left)[0];

  const create = () => {
    const createdAt = new Date().toISOString();
    const id = newRuleId(kind, Date.now());
    const base = { id, enabled: true, severity, createdAt };
    let rule: AlertRule;
    if (kind === "PRICE_CROSS") {
      if (!market || !levelValid) return;
      rule = { ...base, kind, marketId: market.id, direction, level: Number(level.toFixed(market.priceDecimals)) };
    } else if (kind === "HEALTH_BELOW") {
      rule = { ...base, kind, threshold };
    } else if (kind === "FIXING_WITHIN") {
      rule = { ...base, kind, hours, scope };
    } else {
      rule = { ...base, kind };
    }
    onCreate(rule);
    setLevelInput(null);
    setNotice(`${RULE_KIND_LABEL[kind]} rule armed.`);
  };

  return (
    <Panel label="New alert rule">
      <PanelHead title="New rule" tools={<Chip title="Rules are stored in this browser only">This browser</Chip>} />
      <div className="space-y-3 p-3">
        <Segmented options={KINDS} value={kind} onChange={(value) => { setKind(value); setNotice(null); }} label="Rule type" size="sm" />

        {kind === "PRICE_CROSS" && market ? (
          <div className="space-y-2.5">
            <label className="block">
              <span className="text-[11px] text-faint">Market</span>
              <select
                value={market.id}
                onChange={(event) => {
                  setMarketId(event.target.value);
                  setLevelInput(null);
                }}
                className={FIELD}
              >
                {markets.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.code}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-baseline justify-between rounded-md bg-inset px-2.5 py-2 text-xs">
              <span className="text-faint">Live mark</span>
              <span className="flex items-baseline gap-1">
                <Flash value={market.netPrice} className="tnum px-0.5 font-mono text-ink">
                  {formatNumber(market.netPrice, market.priceDecimals)}
                </Flash>
                <span className="text-[10px] text-off">{priceUnitSuffix(market.priceUnit)}</span>
              </span>
            </div>
            <label className="block">
              <span className="flex items-baseline justify-between text-[11px] text-faint">
                Trigger level
                <span className="text-off">{`tick ${formatNumber(market.tickSize, market.priceDecimals)}`}</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={market.tickSize}
                value={levelText}
                onChange={(event) => setLevelInput(event.target.value)}
                className={`${FIELD} tnum font-mono`}
              />
            </label>
            <p className="text-[11px] leading-snug text-faint">
              {levelValid
                ? `Fires when the mark ${direction === "ABOVE" ? "rises to or above" : "falls to or below"} ${formatNumber(level, market.priceDecimals)}. The level is compared with the same preview mark the terminal and charts use.`
                : "Enter a trigger level."}
            </p>
          </div>
        ) : null}

        {kind === "HEALTH_BELOW" ? (
          <div className="space-y-2">
            <span className="block text-[11px] text-faint">Maintenance health threshold</span>
            <Stepper value={threshold} onChange={setThreshold} min={1.05} max={5} step={0.05} decimals={2} label="Health threshold" suffix="x" />
            <p className="text-[11px] leading-snug text-faint">
              {health === null
                ? "No maintenance margin is in use, so this rule waits for the first open package."
                : `Health is ${formatMultiple(health)} now: equity over maintenance margin, marked on the preview feed.`}
            </p>
          </div>
        ) : null}

        {kind === "FIXING_WITHIN" ? (
          <div className="space-y-2.5">
            <Segmented
              options={[
                { value: "LISTED" as const, label: "Any listed market" },
                { value: "HELD" as const, label: "Held packages" },
              ]}
              value={scope}
              onChange={setScope}
              label="Fixing scope"
              size="sm"
            />
            <div>
              <span className="block text-[11px] text-faint">Hours before the 16:00 UTC fixing</span>
              <Stepper value={hours} onChange={setHours} min={1} max={720} step={12} label="Hours before fixing" suffix="h" className="mt-1" />
            </div>
            <p className="text-[11px] leading-snug text-faint">
              {fixingCandidates.length === 0
                ? "No held package yet. Held-package rules wait for the first position."
                : `${fixingNow.length} ${fixingNow.length === 1 ? "market" : "markets"} inside the window now.${
                    nearest ? ` Nearest: ${nearest.candidate.code} in ${formatHours(nearest.left)}.` : ""
                  }`}
            </p>
          </div>
        ) : null}

        {kind === "RFQ_QUOTE" ? (
          <p className="rounded-md bg-inset px-2.5 py-2 text-[11px] leading-snug text-faint">
            Raises one alert per open RFQ when its first firm quote arrives, with the best price and maker. The alert
            links straight to quote selection in the terminal.
          </p>
        ) : null}

        <div>
          <span className="mb-1 block text-[11px] text-faint">Severity</span>
          <Segmented options={SEVERITIES} value={severity} onChange={setSeverity} label="Severity" size="sm" />
        </div>

        <button
          type="button"
          onClick={create}
          disabled={kind === "PRICE_CROSS" && !levelValid}
          className={`${BUTTON_PRIMARY} w-full`}
        >
          Create rule
        </button>
        {notice ? (
          <p role="status" className="text-center text-[11px] text-dim">
            {notice}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

export function RulesList({
  rules,
  ledger,
  markets,
  onToggle,
  onDelete,
  onRearm,
}: {
  rules: readonly AlertRule[];
  ledger: AlertLedger;
  markets: readonly PackageMarket[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRearm: (id: string) => void;
}) {
  return (
    <Panel label="Alert rules" delay={60}>
      <PanelHead
        title="Rules"
        tools={<span className="tnum font-mono text-[11px] text-faint">{`${rules.filter((rule) => rule.enabled).length} / ${rules.length} armed`}</span>}
      />
      {rules.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-faint">No rules. Create one above.</p>
      ) : (
        <ul>
          {rules.map((rule) => {
            const prefix = ruleAlertPrefix(rule.id);
            const fired = Object.entries(ledger).filter(([id, entry]) => id.startsWith(prefix) && entry.firedAt !== undefined).length;
            return (
              <li key={rule.id} className="row-in flex items-start gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0">
                <span className="pt-0.5">
                  <Switch checked={rule.enabled} onChange={(next) => onToggle(rule.id, next)} label={`Arm ${describeRule(rule, markets)}`} tone="brand" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs ${rule.enabled ? "text-ink" : "text-faint"}`}>{describeRule(rule, markets)}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Chip tone="neutral">{RULE_KIND_LABEL[rule.kind]}</Chip>
                    <Chip tone={rule.severity === "CRITICAL" ? "down" : rule.severity === "WARNING" ? "brand" : "dim"}>
                      {SEVERITY_LABEL[rule.severity]}
                    </Chip>
                    <span className="text-[11px] text-faint">
                      {!rule.enabled ? "Paused" : fired > 0 ? `Triggered ${fired}x` : "Armed"}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {fired > 0 ? (
                    <button
                      type="button"
                      onClick={() => onRearm(rule.id)}
                      aria-label="Re-arm rule"
                      title="Clear this rule's triggers so it fires again"
                      className="focus-ring grid h-11 w-11 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-ink lg:h-7 lg:w-7"
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDelete(rule.id)}
                    aria-label="Delete rule"
                    title="Delete rule"
                    className="focus-ring grid h-11 w-11 place-items-center rounded-md text-faint transition-colors hover:bg-down-soft hover:text-down lg:h-7 lg:w-7"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
