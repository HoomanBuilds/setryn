"use client";

import { useMemo, useState } from "react";
import { CheckCheck, CircleAlert } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { PageFrame, PageHeader, ProvenanceChip, BUTTON_GHOST } from "@/components/home/kit";
import { Chip, DeskTabs, Panel, PanelHead, TabBody, deskMotion } from "@/components/strategies/desk/Desk";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { Segmented } from "@/components/terminal/primitives";
import {
  ALERT_CATEGORIES,
  CATEGORY_LABEL,
  acknowledgeAlert,
  rearmRule,
  reopenAlert,
  resolveAlert,
  type AlertCategory,
  type AlertRule,
  type AlertStatus,
} from "@/lib/alerts";
import { OPERATIONS_FIXTURE } from "@/lib/operations/fixture";
import { portfolioRuntime } from "@/lib/portfolio/runtime";
import { ruleWatches } from "@/lib/alerts";
import { AlertInbox } from "./AlertInbox";
import { RuleMonitor } from "./RuleMonitor";
import { NewRulePanel, RulesList } from "./RulesPanel";
import { useAlertInbox } from "./useAlertInbox";

type CategoryView = "ALL" | AlertCategory;
type StatusView = "UNRESOLVED" | AlertStatus | "ALL";

const STATUS_VIEWS: { value: StatusView; label: string }[] = [
  { value: "UNRESOLVED", label: "Active" },
  { value: "OPEN", label: "Open" },
  { value: "ACKNOWLEDGED", label: "Acked" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "ALL", label: "All" },
];

export function AlertsWorkspace() {
  const snapshot = useGatewaySnapshot();
  const { markets, previewEpochSeconds } = usePreviewBoard();
  const inbox = useAlertInbox();
  const { alerts, rules, ledger, setRules, setLedger } = inbox;
  const [category, setCategory] = useState<CategoryView>("ALL");
  const [statusView, setStatusView] = useState<StatusView>("UNRESOLVED");

  const health = useMemo(() => {
    if (snapshot.positions.length === 0) return null;
    try {
      const account = portfolioRuntime(snapshot, markets).account;
      return account.maintenanceMargin > 0 ? account.healthFactor : null;
    } catch {
      return null;
    }
  }, [snapshot, markets]);
  const heldMarketIds = useMemo(() => [...new Set(snapshot.positions.map((position) => position.marketId))], [snapshot.positions]);

  const unresolvedByCategory = useMemo(() => {
    const counts = Object.fromEntries(ALERT_CATEGORIES.map((item) => [item, 0])) as Record<AlertCategory, number>;
    for (const alert of alerts) if (alert.status !== "RESOLVED") counts[alert.category] += 1;
    return counts;
  }, [alerts]);

  const visible = alerts.filter(
    (alert) =>
      (category === "ALL" || alert.category === category) &&
      (statusView === "ALL" ||
        (statusView === "UNRESOLVED" ? alert.status !== "RESOLVED" : alert.status === statusView)),
  );

  const tabs = [
    { id: "ALL", label: "All", badge: alerts.filter((alert) => alert.status !== "RESOLVED").length },
    ...ALERT_CATEGORIES.map((item) => ({
      id: item,
      label: CATEGORY_LABEL[item],
      badge: unresolvedByCategory[item],
      badgeTone: inbox.byCategory[item] > 0 ? ("down" as const) : undefined,
    })),
  ];

  const acknowledgeAll = () => {
    const ids = visible.filter((alert) => alert.status === "OPEN").map((alert) => alert.id);
    setLedger((current) => ids.reduce((next, id) => acknowledgeAlert(next, id, Date.now()), current));
  };

  const watches = useMemo(
    () => ruleWatches(rules, snapshot, markets, previewEpochSeconds, inbox.nowMs),
    [rules, snapshot, markets, previewEpochSeconds, inbox.nowMs],
  );

  const createRule = (rule: AlertRule) => setRules((current) => [...current, rule]);
  const openVisible = visible.filter((alert) => alert.status === "OPEN").length;
  const fixtureCount = alerts.filter((alert) => alert.provenance === "RECORDED_FIXTURE").length;

  return (
    <PageFrame label="Alerts">
      <PageHeader
        title="Alerts"
        subtitle="Market, risk, fixing, settlement, and system"
        chips={
          <>
            <Chip tone={inbox.count > 0 ? "down" : "dim"} dot>{`${inbox.count} open`}</Chip>
            {inbox.critical > 0 ? <Chip tone="down">{`${inbox.critical} critical`}</Chip> : null}
            <Chip tone="neutral">{`${rules.filter((rule) => rule.enabled).length} rules armed`}</Chip>
            <Chip tone="neutral" title={`${snapshot.environment.label}, chain ${snapshot.environment.chainId}`}>
              {snapshot.environment.label}
            </Chip>
          </>
        }
        actions={
          <button type="button" onClick={acknowledgeAll} disabled={openVisible === 0} className={BUTTON_GHOST}>
            <CheckCheck size={14} aria-hidden="true" />
            {openVisible > 0 ? `Acknowledge ${openVisible} open` : "Acknowledge open"}
          </button>
        }
      >
        <DeskTabs idBase="alerts-category" items={tabs} value={category} onChange={(id) => setCategory(id as CategoryView)} className="h-10" />
      </PageHeader>

      <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-1">
          <Panel label="Alert inbox">
            <PanelHead
              title="Inbox"
              tools={
                <span className="tnum font-mono text-[11px] text-faint">{`${visible.length} of ${alerts.length}`}</span>
              }
            />
            <div className="border-b border-line px-3 py-2">
              <div className="md:max-w-[440px]">
                <Segmented options={STATUS_VIEWS} value={statusView} onChange={setStatusView} label="Alert status" size="sm" />
              </div>
            </div>
            <TabBody key={`${category}-${statusView}`} idBase="alerts-category">
              <AlertInbox
                alerts={visible}
                rules={rules}
                markets={markets}
                onAcknowledge={(id) => setLedger((current) => acknowledgeAlert(current, id, Date.now()))}
                onResolve={(id) => setLedger((current) => resolveAlert(current, id, Date.now()))}
                onReopen={(id) => setLedger((current) => reopenAlert(current, id))}
                emptyTitle={
                  statusView === "UNRESOLVED" || statusView === "OPEN"
                    ? `No ${category === "ALL" ? "" : `${CATEGORY_LABEL[category].toLowerCase()} `}alerts need attention`
                    : "Nothing in this view"
                }
              />
            </TabBody>
          </Panel>

          <RuleMonitor watches={watches} rules={rules} />

          <div className={`${deskMotion.rise} flex items-start gap-2 rounded-lg border border-line bg-inset px-3 py-2 text-[11px] leading-relaxed text-faint`}>
            <CircleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-dim" />
            <span className="min-w-0">
              Rule alerts evaluate the shared preview board and the {snapshot.environment.label} account on every tick and
              stay listed once raised until you resolve them. Acknowledgements live in this browser only. {fixtureCount}{" "}
              System {fixtureCount === 1 ? "alert comes" : "alerts come"} from the operator runtime{" "}
              <span className="whitespace-nowrap">
                <ProvenanceChip kind="RECORDED_FIXTURE" />
              </span>{" "}
              captured {OPERATIONS_FIXTURE.captureLabel.replace("Recorded fixture - ", "")}.
            </span>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-1">
          <NewRulePanel
            markets={markets}
            previewEpochSeconds={previewEpochSeconds}
            health={health}
            heldMarketIds={heldMarketIds}
            onCreate={createRule}
          />
          <RulesList
            rules={rules}
            ledger={ledger}
            markets={markets}
            onToggle={(id, enabled) => setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)))}
            onDelete={(id) => {
              setRules((current) => current.filter((rule) => rule.id !== id));
              setLedger((current) => rearmRule(current, id));
            }}
            onRearm={(id) => setLedger((current) => rearmRule(current, id))}
          />
        </aside>
      </div>
    </PageFrame>
  );
}
