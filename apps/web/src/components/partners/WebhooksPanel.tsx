"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Chip, Panel, PanelHead, Switch, TH } from "@/components/strategies/desk/Desk";
import {
  api,
  ApiError,
  formatStamp,
  WEBHOOK_EVENT_TYPES,
  type Cursor,
  type Delivery,
  type PartnerDeployment,
  type Subscription,
  type WebhookEventType,
} from "./api";
import { BUTTON, INPUT, PRIMARY } from "./DeploymentsPanel";

const STATUS_TONE = { succeeded: "up", failed: "down", retrying: "brand", pending: "dim" } as const;

/** Webhook subscriptions: create, test, rotate, pause, delete, and the delivery log with every attempt. */
export function WebhooksPanel({
  subscriptions,
  partners,
  cursor,
  onChanged,
}: {
  subscriptions: Subscription[];
  partners: PartnerDeployment[];
  cursor: Cursor | null;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(subscriptions[0]?.id ?? null);
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "up" | "down"; text: string } | null>(null);
  const current = subscriptions.find((item) => item.id === selected) ?? subscriptions[0] ?? null;

  const act = async (label: string, run: () => Promise<void>) => {
    setMessage(null);
    try {
      await run();
      onChanged();
    } catch (caught) {
      setMessage({ tone: "down", text: caught instanceof ApiError ? `${label}: ${caught.message}` : `${label} failed.` });
    }
  };

  return (
    <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Panel label="Webhook subscriptions">
        <PanelHead
          title="Subscriptions"
          tools={
            <Chip tone={cursor ? "up" : "dim"} dot title="Block cursor of the webhooks worker (services/webhooks)">
              {cursor ? `worker at block ${BigInt(cursor.nextBlock) - BigInt(1)}` : "worker not started"}
            </Chip>
          }
        />
        <CreateSubscriptionForm
          partners={partners}
          onCreated={(id, secret) => {
            setRevealed({ id, secret });
            setSelected(id);
            onChanged();
          }}
        />
        {revealed ? (
          <div role="status" className="mx-3 mb-3 rounded-md border border-brand-edge bg-brand-soft px-3 py-2 text-xs text-ink">
            <p className="font-medium">Signing secret for {revealed.id}. It is shown once.</p>
            <code className="mt-1 block font-mono text-[11px] break-all">{revealed.secret}</code>
            <button type="button" className={`${BUTTON} mt-2`} onClick={() => setRevealed(null)}>I stored it</button>
          </div>
        ) : null}
        {message ? <p role="alert" className="px-3 pb-2 text-xs text-down">{message.text}</p> : null}
        <ul className="min-w-0 border-t border-line" aria-label="Subscriptions">
          {subscriptions.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-dim">No subscriptions yet.</li>
          ) : (
            subscriptions.map((item) => (
              <li key={item.id} className={`border-b border-line-soft px-3 py-2 ${item.id === current?.id ? "bg-raised" : ""}`}>
                <div className="flex min-w-0 items-center gap-2">
                  <button type="button" onClick={() => setSelected(item.id)} aria-pressed={item.id === current?.id} className="focus-ring min-w-0 flex-1 rounded-sm text-left">
                    <span className="block truncate font-mono text-xs text-ink">{item.url}</span>
                    <span className="block truncate text-[11px] text-faint">
                      {item.id} · {item.eventTypes.length} events · {item.secretHint}
                      {item.partnerCode ? ` · ${item.partnerCode}` : ""}
                    </span>
                  </button>
                  <Switch
                    checked={item.active}
                    onChange={(next) => act("Update", async () => { await api(`/api/v1/webhooks/${item.id}`, { method: "PATCH", body: { active: next } }); })}
                    label={`Subscription ${item.id} active`}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" className={BUTTON} onClick={() => act("Test", async () => { await api(`/api/v1/webhooks/${item.id}/test`, { method: "POST", body: {} }); setSelected(item.id); })}>
                    Send test
                  </button>
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() =>
                      act("Rotate", async () => {
                        const result = await api<{ secret: string }>(`/api/v1/webhooks/${item.id}/rotate-secret`, { method: "POST", body: {} });
                        setRevealed({ id: item.id, secret: result.secret });
                      })
                    }
                  >
                    Rotate secret
                  </button>
                  <button
                    type="button"
                    className={`${BUTTON} text-down`}
                    onClick={() => {
                      if (window.confirm(`Delete ${item.id}? Pending deliveries will fail.`)) {
                        void act("Delete", async () => { await api(`/api/v1/webhooks/${item.id}`, { method: "DELETE" }); });
                      }
                    }}
                  >
                    Delete
                  </button>
                  {item.rotationGraceUntil ? <Chip tone="brand">old secret valid to {formatStamp(item.rotationGraceUntil)}</Chip> : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </Panel>
      {current ? <DeliveryLog key={current.id} subscription={current} /> : (
        <Panel label="Delivery log">
          <PanelHead title="Delivery log" />
          <p className="px-3 py-6 text-sm text-dim">Create a subscription to see signed deliveries and retries.</p>
        </Panel>
      )}
    </div>
  );
}

function CreateSubscriptionForm({ partners, onCreated }: { partners: PartnerDeployment[]; onCreated: (id: string, secret: string) => void }) {
  const [url, setUrl] = useState("");
  const [partner, setPartner] = useState("");
  const [types, setTypes] = useState<WebhookEventType[]>([...WEBHOOK_EVENT_TYPES]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ subscription: Subscription; secret: string }>("/api/v1/webhooks", {
        method: "POST",
        body: { url, eventTypes: types, partnerCode: partner || undefined },
      });
      setUrl("");
      onCreated(result.subscription.id, result.secret);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the subscription.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-2 px-3 py-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="webhook-url" className="mb-1 block text-[11px] text-faint">Endpoint URL</label>
          <input id="webhook-url" type="url" required className={`${INPUT} font-mono text-xs`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://partner.example/setryn/webhooks" />
        </div>
        <div>
          <label htmlFor="webhook-partner" className="mb-1 block text-[11px] text-faint">Partner</label>
          <select
            id="webhook-partner"
            className={INPUT}
            value={partner}
            onChange={(event) => {
              setPartner(event.target.value);
              // A partner endpoint may only carry the partner's permitted events.
              const permitted = partners.find((item) => item.code === event.target.value)?.webhookEventTypes;
              setTypes(permitted ? [...permitted] : [...WEBHOOK_EVENT_TYPES]);
            }}
          >
            <option value="">None</option>
            {partners.map((item) => <option key={item.code} value={item.code}>{item.code}</option>)}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 text-[11px] text-faint">Events</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {WEBHOOK_EVENT_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 font-mono text-[11px] text-ink">
              <input
                type="checkbox"
                disabled={partner !== "" && !partners.find((item) => item.code === partner)?.webhookEventTypes.includes(type)}
                checked={types.includes(type)}
                onChange={() => setTypes(types.includes(type) ? types.filter((item) => item !== type) : [...types, type])}
                className="accent-[var(--color-brand)]"
              />
              {type}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-2">
        <button type="submit" className={PRIMARY} disabled={busy || types.length === 0 || url.length === 0}>Add endpoint</button>
        <span className="text-[11px] text-faint">Signed with HMAC-SHA256 in the Setryn-Signature header.</span>
      </div>
      {error ? <p role="alert" className="text-xs text-down">{error}</p> : null}
    </form>
  );
}

function DeliveryLog({ subscription }: { subscription: Subscription }) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api<{ deliveries: Delivery[] }>(`/api/v1/webhooks/${subscription.id}/deliveries?limit=50`);
      setDeliveries(result.deliveries);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load deliveries.");
    }
  }, [subscription.id]);

  useEffect(() => {
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 4_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load, subscription.updatedAt]);

  return (
    <Panel label="Delivery log">
      <PanelHead title="Delivery log" tools={<span className="truncate font-mono text-[11px] text-faint">{subscription.id}</span>} />
      {error ? <p role="alert" className="px-3 py-2 text-xs text-down">{error}</p> : null}
      <div role="region" aria-label="Webhook deliveries" tabIndex={0} className="focus-ring scroll-thin max-h-[520px] min-w-0 overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Event</th>
              <th scope="col" className={TH}>Status</th>
              <th scope="col" className={TH}>Attempts</th>
              <th scope="col" className={TH}>Next retry</th>
            </tr>
          </thead>
          <tbody>
            {deliveries === null ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-dim">Loading deliveries…</td></tr>
            ) : deliveries.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-dim">No deliveries yet. Send a test or wait for chain events.</td></tr>
            ) : (
              deliveries.map((delivery) => (
                <tr key={delivery.id} className="border-b border-line-soft align-top">
                  <td className="px-3 py-2">
                    <span className="block font-mono text-ink">{delivery.eventType}</span>
                    <span className="block font-mono text-[11px] text-faint">
                      {delivery.test ? "test event" : `block ${delivery.blockNumber ?? "?"}`} · {delivery.eventId.slice(0, 16)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={STATUS_TONE[delivery.status]} dot>{delivery.status}</Chip>
                  </td>
                  <td className="px-3 py-2">
                    <ol className="grid gap-0.5">
                      {delivery.attempts.map((attempt) => (
                        <li key={attempt.attempt} className="tnum font-mono text-[11px] text-dim">
                          #{attempt.attempt} {formatStamp(attempt.at)} · {attempt.statusCode ?? attempt.error} · {attempt.durationMs}ms
                        </li>
                      ))}
                      {delivery.attempts.length === 0 ? <li className="text-[11px] text-faint">queued</li> : null}
                    </ol>
                  </td>
                  <td className="tnum px-3 py-2 font-mono text-[11px] text-dim">
                    {delivery.nextAttemptAt ? formatStamp(delivery.nextAttemptAt) : "—"}
                    <span className="block text-faint">{delivery.attempts.length}/{delivery.maxAttempts}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
