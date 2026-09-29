"use client";

import { Chip, Meter, Panel, PanelHead, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import { RULE_KIND_LABEL, type AlertRule, type RuleWatch } from "@/lib/alerts";

/** Where every armed rule stands against its trigger on this tick. */
export function RuleMonitor({ watches, rules }: { watches: RuleWatch[]; rules: readonly AlertRule[] }) {
  const kindOf = (ruleId: string) => rules.find((rule) => rule.id === ruleId)?.kind;
  return (
    <Panel label="Rule monitor" delay={80}>
      <PanelHead
        title="Rule monitor"
        tools={
          <Chip tone="dim" dot title="Evaluated on the shared preview tick against the live board and the gateway snapshot">
            Live
          </Chip>
        }
      />
      {watches.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-faint">No armed rules. Arm or create one to watch it here.</p>
      ) : (
        <>
          <table className="relative hidden w-full border-collapse text-left md:table">
            <caption className="sr-only">Distance from each armed rule to its trigger</caption>
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>Rule</th>
                <th className={TH}>Watching</th>
                <th className={TH_NUM}>Now</th>
                <th className={TH_NUM}>Trigger</th>
                <th className={TH_NUM}>Distance</th>
                <th className={`${TH} w-[22%]`}>Proximity</th>
              </tr>
            </thead>
            <tbody>
              {watches.map((watch) => {
                const kind = kindOf(watch.ruleId);
                return (
                  <tr key={watch.key} className="h-9 border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50">
                    <td className="px-3 text-xs text-dim">{kind ? RULE_KIND_LABEL[kind] : "-"}</td>
                    <td className="tnum px-3 font-mono text-xs text-ink">{watch.subject}</td>
                    <td className="tnum px-3 text-right font-mono text-xs text-ink">{watch.current}</td>
                    <td className="tnum px-3 text-right font-mono text-xs text-dim">{watch.trigger}</td>
                    <td className={`tnum px-3 text-right font-mono text-xs ${watch.holding ? "text-brand" : "text-dim"}`}>{watch.distance}</td>
                    <td className="px-3">
                      <Meter value={watch.proximity} tone={watch.holding ? "brand" : "dim"} label={`${watch.subject} proximity to trigger`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="md:hidden">
            {watches.map((watch) => {
              const kind = kindOf(watch.ruleId);
              return (
                <li key={watch.key} className="flex flex-col gap-1.5 border-b border-line-soft px-3 py-2.5 last:border-b-0">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="tnum truncate font-mono text-xs text-ink">{watch.subject}</span>
                    <span className="text-[11px] text-faint">{kind ? RULE_KIND_LABEL[kind] : ""}</span>
                  </span>
                  <span className="tnum flex items-baseline justify-between gap-3 font-mono text-xs">
                    <span className="text-ink">{watch.current}</span>
                    <span className="text-dim">{watch.trigger}</span>
                    <span className={watch.holding ? "text-brand" : "text-dim"}>{watch.distance}</span>
                  </span>
                  <Meter value={watch.proximity} tone={watch.holding ? "brand" : "dim"} label={`${watch.subject} proximity to trigger`} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
