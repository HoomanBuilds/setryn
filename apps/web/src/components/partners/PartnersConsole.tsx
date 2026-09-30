"use client";

import { useCallback, useEffect, useState } from "react";
import { Chip, DeskTabs, TabBody, deskMotion } from "@/components/strategies/desk/Desk";
import { api, ApiError, type Cursor, type PartnerDeployment, type RevenueReport, type Subscription, type UsageRow } from "./api";
import { DeploymentsPanel } from "./DeploymentsPanel";
import { EmbedGenerator } from "./EmbedGenerator";
import { RevenuePanel } from "./RevenuePanel";
import { UsagePanel } from "./UsagePanel";
import { WebhooksPanel } from "./WebhooksPanel";

type ViewId = "deployments" | "embed" | "webhooks" | "usage" | "revenue";

interface ConsoleData {
  partners: PartnerDeployment[];
  usage: UsageRow[];
  subscriptions: Subscription[];
  cursor: Cursor | null;
  revenue: RevenueReport | null;
}

const EMPTY: ConsoleData = { partners: [], usage: [], subscriptions: [], cursor: null, revenue: null };

/** Partner console (interface route 23): deployments, embeds, webhooks, usage and revenue on local devnet data. */
export function PartnersConsole() {
  const [view, setView] = useState<ViewId>("deployments");
  const [data, setData] = useState<ConsoleData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [partners, usage, webhooks, events, revenue] = await Promise.all([
        api<{ partners: PartnerDeployment[] }>("/api/v1/partners"),
        api<{ rows: UsageRow[] }>("/api/v1/partners/usage?days=30"),
        api<{ subscriptions: Subscription[] }>("/api/v1/webhooks"),
        api<{ cursor: Cursor | null }>("/api/v1/webhooks/events?limit=1"),
        api<RevenueReport>("/api/v1/partners/revenue").catch(() => null),
      ]);
      setData({ partners: partners.partners, usage: usage.rows, subscriptions: webhooks.subscriptions, cursor: events.cursor, revenue });
      setSelected((current) => current ?? partners.partners[0]?.code ?? null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The partner API is unavailable.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const month = new Date().toISOString().slice(0, 7);
  const monthImpressions = data.usage.filter((row) => row.day.startsWith(month)).reduce((sum, row) => sum + row.impressions, 0);
  const failing = data.subscriptions.filter((item) => !item.active).length;
  const views = [
    { id: "deployments", label: "Deployments", badge: data.partners.length },
    { id: "embed", label: "Embed code" },
    { id: "webhooks", label: "Webhooks", badge: data.subscriptions.length, badgeTone: failing > 0 ? ("down" as const) : undefined },
    { id: "usage", label: "Usage and attribution" },
    { id: "revenue", label: "Revenue" },
  ];

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1" aria-label="Setryn partner console">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Partners</h1>
            <span className="hidden truncate text-xs text-faint sm:inline">Embeds, webhooks, attribution and revenue share</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 lg:ml-auto">
            <Chip tone="dim" title="Management is limited to the local devnet host until API keys are enabled">Local devnet</Chip>
            <Chip tone="dim">{monthImpressions.toLocaleString("en-US")} impressions this month</Chip>
            <Chip tone={data.cursor ? "up" : "dim"} dot>{data.cursor ? "webhooks worker indexed" : "webhooks worker idle"}</Chip>
          </div>
        </div>
        <div className="border-t border-line">
          <DeskTabs items={views} value={view} onChange={(next) => setView(next as ViewId)} idBase="partners" />
        </div>
      </header>
      {error ? (
        <p role="alert" className="rounded-lg border border-down/25 bg-down-soft px-3 py-2 text-xs text-down">{error}</p>
      ) : null}
      <TabBody key={view} idBase="partners" className="flex min-w-0 flex-col gap-1">
        {!loaded ? (
          <p className="rounded-lg border border-line bg-panel px-3 py-6 text-sm text-dim">Loading partner console…</p>
        ) : view === "deployments" ? (
          <DeploymentsPanel partners={data.partners} usage={data.usage} selected={selected} onSelect={setSelected} onChanged={refresh} />
        ) : view === "embed" ? (
          <EmbedGenerator partners={data.partners} />
        ) : view === "webhooks" ? (
          <WebhooksPanel subscriptions={data.subscriptions} partners={data.partners} cursor={data.cursor} onChanged={refresh} />
        ) : view === "usage" ? (
          <UsagePanel usage={data.usage} partners={data.partners} />
        ) : (
          <RevenuePanel report={data.revenue} />
        )}
      </TabBody>
    </main>
  );
}
