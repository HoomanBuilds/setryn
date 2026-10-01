import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import type { MarketDataSnapshot } from "@/lib/market-data/types";
import { portfolioRuntime } from "@/lib/portfolio/runtime";
import { formatMultiple, formatNumber, formatSigned, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";
import { formatHours, hoursToFixing, liveMark } from "./engine";
import type { AlertRule } from "./types";

/** One watched subject of a rule: where the observation sits against its trigger right now. */
export interface RuleWatch {
  key: string;
  ruleId: string;
  subject: string;
  current: string;
  trigger: string;
  distance: string;
  /** 0 far from the trigger, 1 at or through it. */
  proximity: number;
  holding: boolean;
}

/**
 * Live distance to trigger for each armed rule, from the same inputs the inbox evaluates. Fixing rules list their
 * three nearest markets.
 */
export function ruleWatches(
  rules: readonly AlertRule[],
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  nowSeconds: number,
  nowMs: number,
  live?: MarketDataSnapshot | null,
): RuleWatch[] {
  const rows: RuleWatch[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.kind === "PRICE_CROSS") {
      const market = markets.find((candidate) => candidate.id === rule.marketId);
      if (!market) continue;
      const mark = liveMark(market, live);
      const ticks = mark === null ? null : (rule.level - mark) / market.tickSize;
      const holding = mark !== null && (rule.direction === "ABOVE" ? mark >= rule.level : mark <= rule.level);
      rows.push({
        key: `${rule.id}:${market.id}`,
        ruleId: rule.id,
        subject: market.code,
        current: mark === null ? "No quote" : formatNumber(mark, market.priceDecimals),
        trigger: `${rule.direction === "ABOVE" ? ">=" : "<="} ${formatNumber(rule.level, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`,
        distance: ticks === null ? "-" : holding ? "Through" : `${formatSigned(Math.round(ticks), 0)} ticks`,
        proximity: ticks === null ? 0 : holding ? 1 : Math.max(0, 1 - Math.abs(ticks) / 20),
        holding,
      });
    } else if (rule.kind === "HEALTH_BELOW") {
      let health: number | null = null;
      if (snapshot.positions.length > 0) {
        try {
          const account = portfolioRuntime(snapshot, markets, { live, nowMs: nowSeconds * 1000 }).account;
          health = account.maintenanceMargin > 0 ? account.healthFactor : null;
        } catch {
          health = null;
        }
      }
      const holding = health !== null && health < rule.threshold;
      rows.push({
        key: `${rule.id}:account`,
        ruleId: rule.id,
        subject: "Collateral cover",
        current: health === null ? "Nothing locked" : formatMultiple(health),
        trigger: `< ${formatMultiple(rule.threshold)}`,
        distance: health === null ? "-" : holding ? "Through" : `${formatSigned(health - rule.threshold, 2)}x`,
        proximity: health === null ? 0 : holding ? 1 : Math.max(0, 1 - (health - rule.threshold) / rule.threshold),
        holding,
      });
    } else if (rule.kind === "FIXING_WITHIN") {
      const held = new Set(snapshot.positions.map((position) => position.marketId));
      const nearest = markets
        .filter((market) => (rule.scope === "HELD" ? held.has(market.id) : true))
        .map((market) => ({ market, hours: hoursToFixing(market, nowSeconds) }))
        .filter((entry) => entry.hours > 0)
        .sort((a, b) => a.hours - b.hours)
        .slice(0, 3);
      if (nearest.length === 0) {
        rows.push({
          key: `${rule.id}:none`,
          ruleId: rule.id,
          subject: rule.scope === "HELD" ? "No held package" : "No listed fixing",
          current: "-",
          trigger: `<= ${formatNumber(rule.hours, 0)}h`,
          distance: "-",
          proximity: 0,
          holding: false,
        });
      }
      for (const { market, hours } of nearest) {
        const holding = hours <= rule.hours;
        rows.push({
          key: `${rule.id}:${market.id}`,
          ruleId: rule.id,
          subject: market.code,
          current: formatHours(hours),
          trigger: `<= ${formatNumber(rule.hours, 0)}h`,
          distance: holding ? "Inside" : `${formatHours(hours - rule.hours)} out`,
          proximity: holding ? 1 : Math.max(0, 1 - (hours - rule.hours) / Math.max(rule.hours, 24)),
          holding,
        });
      }
    } else {
      const open = snapshot.rfqRequests.filter((request) => request.state === "OPEN" && Date.parse(request.expiresAt) > nowMs);
      const quoted = open.filter((request) => request.quotes.some((quote) => Date.parse(quote.expiresAt) > nowMs));
      rows.push({
        key: `${rule.id}:rfqs`,
        ruleId: rule.id,
        subject: "Open RFQs",
        current: `${open.length} open`,
        trigger: "First firm quote",
        distance: quoted.length > 0 ? `${quoted.length} quoted` : open.length > 0 ? "Collecting" : "-",
        proximity: quoted.length > 0 ? 1 : open.length > 0 ? 0.5 : 0,
        holding: quoted.length > 0,
      });
    }
  }
  return rows;
}
