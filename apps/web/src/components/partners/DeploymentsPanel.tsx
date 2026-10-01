"use client";

import { useState, type FormEvent } from "react";
import { Chip, Meter, Panel, PanelHead, Switch, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import { api, ApiError, WEBHOOK_EVENT_TYPES, WIDGET_KINDS, type PartnerDeployment, type UsageRow, type WebhookEventType, type WidgetKind } from "./api";

export const INPUT = "focus-ring w-full rounded-md border border-line-strong bg-inset px-2 py-1.5 text-sm text-ink placeholder:text-faint";
export const BUTTON = "focus-ring inline-flex items-center justify-center rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium text-ink hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50";
export const PRIMARY = "focus-ring inline-flex items-center justify-center rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-app hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

function monthImpressions(rows: readonly UsageRow[], code: string): number {
  const month = new Date().toISOString().slice(0, 7);
  return rows.filter((row) => row.partner === code && row.day.startsWith(month)).reduce((sum, row) => sum + row.impressions, 0);
}

/** Embedded deployments: one row per partner code with its permissions, quota use and attribution. */
export function DeploymentsPanel({
  partners,
  usage,
  selected,
  onSelect,
  onChanged,
}: {
  partners: PartnerDeployment[];
  usage: UsageRow[];
  selected: string | null;
  onSelect: (code: string) => void;
  onChanged: () => void;
}) {
  const current = partners.find((partner) => partner.code === selected) ?? null;
  return (
    <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel label="Embedded deployments">
        <PanelHead title="Embedded deployments" tools={<Chip tone="dim">{partners.length} partners</Chip>} />
        <div role="region" aria-label="Embedded deployments table" tabIndex={0} className="focus-ring scroll-thin min-w-0 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Partner</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Widgets</th>
                <th scope="col" className={TH}>Origins</th>
                <th scope="col" className={TH_NUM}>Impressions this month</th>
                <th scope="col" className={TH_NUM}>Accounts</th>
              </tr>
            </thead>
            <tbody>
              {partners.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-dim">
                    No deployments yet. Create one to issue a partner code for widgets and webhooks.
                  </td>
                </tr>
              ) : (
                partners.map((partner) => {
                  const used = monthImpressions(usage, partner.code);
                  const quota = partner.quotas.monthlyImpressions;
                  const active = partner.code === selected;
                  return (
                    <tr key={partner.code} className={`border-b border-line-soft ${active ? "bg-raised" : ""}`}>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => onSelect(partner.code)} aria-pressed={active} className="focus-ring rounded-sm text-left">
                          <span className="block font-medium text-ink">{partner.name}</span>
                          <span className="block font-mono text-[11px] text-faint">{partner.code}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <Chip tone={partner.status === "active" ? "up" : "down"} dot>
                          {partner.status}
                        </Chip>
                      </td>
                      <td className="px-3 py-2 text-dim">{partner.widgets.join(", ") || "none"}</td>
                      <td className="px-3 py-2 text-dim">{partner.allowedOrigins.length === 0 ? "Any origin" : `${partner.allowedOrigins.length} allowed`}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="tnum font-mono text-ink">{used.toLocaleString("en-US")}</span>
                        <span className="tnum font-mono text-faint"> / {quota.toLocaleString("en-US")}</span>
                        <Meter
                          value={quota === 0 ? 1 : used / quota}
                          tone={used >= quota ? "down" : "brand"}
                          label={`${partner.name} monthly impression quota used`}
                          className="mt-1"
                        />
                      </td>
                      <td className="tnum px-3 py-2 text-right font-mono text-dim">{partner.attributedAccounts.length}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <CreatePartnerForm onCreated={(code) => { onChanged(); onSelect(code); }} />
      </Panel>
      {current ? <PermissionsEditor key={current.code} partner={current} onChanged={onChanged} /> : (
        <Panel label="Permissions">
          <PanelHead title="Permissions and quotas" />
          <p className="px-3 py-6 text-sm text-dim">Select a deployment to edit its permissions, quotas and attribution.</p>
        </Panel>
      )}
    </div>
  );
}

function CreatePartnerForm({ onCreated }: { onCreated: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/partners", { method: "POST", body: { code, name } });
      setCode("");
      setName("");
      onCreated(code);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the deployment.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-2 border-t border-line px-3 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div>
        <label htmlFor="partner-new-name" className="mb-1 block text-[11px] text-faint">Partner name</label>
        <input id="partner-new-name" className={INPUT} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme DEX" required maxLength={80} />
      </div>
      <div>
        <label htmlFor="partner-new-code" className="mb-1 block text-[11px] text-faint">Partner code</label>
        <input
          id="partner-new-code"
          className={`${INPUT} font-mono`}
          value={code}
          onChange={(event) => setCode(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32))}
          placeholder="e.g. acme-dex"
          required
          minLength={3}
          aria-describedby="partner-new-code-hint"
        />
      </div>
      <button type="submit" className={PRIMARY} disabled={busy || code.length < 3 || name.trim().length === 0}>
        Create deployment
      </button>
      <p id="partner-new-code-hint" className="text-[11px] text-faint sm:col-span-3">
        3-32 lowercase letters, digits or hyphens. The code tags widget loads, deep-link clicks and partner webhooks.
      </p>
      {error ? <p role="alert" className="text-xs text-down sm:col-span-3">{error}</p> : null}
    </form>
  );
}

function PermissionsEditor({ partner, onChanged }: { partner: PartnerDeployment; onChanged: () => void }) {
  const [widgets, setWidgets] = useState<WidgetKind[]>(partner.widgets);
  const [events, setEvents] = useState<WebhookEventType[]>(partner.webhookEventTypes);
  const [origins, setOrigins] = useState(partner.allowedOrigins.join("\n"));
  const [accounts, setAccounts] = useState(partner.attributedAccounts.join("\n"));
  const [deepLink, setDeepLink] = useState(partner.deepLinkEnabled);
  const [active, setActive] = useState(partner.status === "active");
  const [revShare, setRevShare] = useState(String(partner.revShareBps));
  const [impressions, setImpressions] = useState(String(partner.quotas.monthlyImpressions));
  const [subscriptions, setSubscriptions] = useState(String(partner.quotas.webhookSubscriptions));
  const [requests, setRequests] = useState(String(partner.quotas.apiRequestsPerMinute));
  const [message, setMessage] = useState<{ tone: "up" | "down"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  const lines = (text: string) => text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/v1/partners/${partner.code}`, {
        method: "PATCH",
        body: {
          status: active ? "active" : "paused",
          widgets,
          webhookEventTypes: events,
          allowedOrigins: lines(origins),
          attributedAccounts: lines(accounts),
          deepLinkEnabled: deepLink,
          revShareBps: Number(revShare),
          quotas: { monthlyImpressions: Number(impressions), webhookSubscriptions: Number(subscriptions), apiRequestsPerMinute: Number(requests) },
        },
      });
      setMessage({ tone: "up", text: "Saved." });
      onChanged();
    } catch (caught) {
      setMessage({ tone: "down", text: caught instanceof ApiError ? caught.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete deployment ${partner.code}? Widgets using this code will render as unregistered.`)) return;
    try {
      await api(`/api/v1/partners/${partner.code}`, { method: "DELETE" });
      onChanged();
    } catch (caught) {
      setMessage({ tone: "down", text: caught instanceof ApiError ? caught.message : "Could not delete." });
    }
  };

  const base = `partner-${partner.code}`;
  return (
    <Panel label={`Permissions for ${partner.name}`}>
      <PanelHead
        title={`Permissions: ${partner.name}`}
        tools={
          <label className="flex items-center gap-2 text-xs text-dim">
            <Switch checked={active} onChange={setActive} label={`${partner.name} deployment active`} />
            {active ? "Active" : "Paused"}
          </label>
        }
      />
      <form onSubmit={save} className="grid gap-3 px-3 py-3">
        <fieldset>
          <legend className="mb-1.5 text-[11px] text-faint">Widgets allowed</legend>
          <div className="flex flex-wrap gap-3">
            {WIDGET_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-1.5 text-xs text-ink">
                <input type="checkbox" checked={widgets.includes(kind)} onChange={() => setWidgets(toggle(widgets, kind))} className="accent-[var(--color-brand)]" />
                {kind}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-xs text-ink">
              <input type="checkbox" checked={deepLink} onChange={() => setDeepLink(!deepLink)} className="accent-[var(--color-brand)]" />
              Trade deep links
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[11px] text-faint">Webhook events permitted</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {WEBHOOK_EVENT_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-1.5 font-mono text-[11px] text-ink">
                <input type="checkbox" checked={events.includes(type)} onChange={() => setEvents(toggle(events, type))} className="accent-[var(--color-brand)]" />
                {type}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${base}-origins`} className="mb-1 block text-[11px] text-faint">Allowed origins (one per line, empty = any)</label>
            <textarea id={`${base}-origins`} rows={3} className={`${INPUT} font-mono text-xs`} value={origins} onChange={(event) => setOrigins(event.target.value)} placeholder="https://app.partner.example" />
          </div>
          <div>
            <label htmlFor={`${base}-accounts`} className="mb-1 block text-[11px] text-faint">Attributed trading accounts (bytes32)</label>
            <textarea id={`${base}-accounts`} rows={3} className={`${INPUT} font-mono text-xs`} value={accounts} onChange={(event) => setAccounts(event.target.value)} placeholder="0x…" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField id={`${base}-rev`} label="Fee share (bp)" value={revShare} onChange={setRevShare} />
          <NumberField id={`${base}-imp`} label="Impressions / month" value={impressions} onChange={setImpressions} />
          <NumberField id={`${base}-subs`} label="Webhook subscriptions" value={subscriptions} onChange={setSubscriptions} />
          <NumberField id={`${base}-rpm`} label="API requests / min" value={requests} onChange={setRequests} />
        </div>
        <p className="text-[11px] text-faint">
          API request quota is recorded for the deployment; enforcement belongs to the public API key gateway. The fee share
          sets the partner&apos;s accrued share of attributed onchain fees in revenue reconciliation; payouts are not yet made onchain.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={PRIMARY} disabled={busy}>Save permissions</button>
          <button type="button" className={`${BUTTON} text-down`} onClick={remove}>Delete deployment</button>
          {message ? <span role="status" className={`text-xs ${message.tone === "up" ? "text-up" : "text-down"}`}>{message.text}</span> : null}
        </div>
      </form>
    </Panel>
  );
}

function NumberField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (next: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-faint">{label}</label>
      <input
        id={id}
        inputMode="numeric"
        className={`${INPUT} tnum text-right font-mono`}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
      />
    </div>
  );
}
