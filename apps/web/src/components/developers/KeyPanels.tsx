"use client";

import { useId, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { Chip, Meter, Panel, PanelHead, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import type { ApiKeyView, IssueKeyInput, Scope } from "./console-api";

export const BUTTON_PRIMARY =
  "focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-brand px-3 text-xs font-semibold text-app transition-[filter] duration-150 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60";
export const BUTTON_QUIET =
  "focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line-strong px-3 text-xs text-dim transition-colors duration-150 hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";
const FIELD =
  "h-8 w-full min-w-0 rounded-md border border-line bg-inset px-2 text-xs text-ink outline-none transition-colors placeholder:text-faint focus:border-line-strong focus-visible:ring-1 focus-visible:ring-brand-edge";

const RATE_PRESETS = [
  { id: "standard", label: "Standard", capacity: 20, refillPerSecond: 2, note: "20 burst, 2/s" },
  { id: "high", label: "High", capacity: 60, refillPerSecond: 5, note: "60 burst, 5/s" },
  { id: "low", label: "Low", capacity: 5, refillPerSecond: 0.5, note: "5 burst, 1 per 2s" },
] as const;

export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => undefined);
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line-strong px-2 text-[11px] text-dim transition-colors hover:border-ink/30 hover:text-ink"
    >
      {copied ? <Check size={12} aria-hidden="true" className="text-up" /> : <Copy size={12} aria-hidden="true" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function CreateKeyPanel({
  onIssue,
  busy,
  error,
}: {
  onIssue: (input: IssueKeyInput) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const formId = useId();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [signers, setSigners] = useState("");
  const [preset, setPreset] = useState<(typeof RATE_PRESETS)[number]["id"]>("standard");
  const [localError, setLocalError] = useState<string | null>(null);

  const toggleScope = (scope: Scope, checked: boolean) => {
    setScopes((current) => {
      const next = checked ? [...new Set([...current, scope])] : current.filter((value) => value !== scope);
      // Trading needs to read back its own orders and fills.
      if (next.includes("trade") && !next.includes("read")) next.unshift("read");
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const signerList = signers
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!name.trim()) return setLocalError("Name the key so its requests are recognizable in the log.");
    if (scopes.length === 0) return setLocalError("Choose at least one scope.");
    if (signerList.some((value) => !/^0x[0-9a-fA-F]{40}$/.test(value))) return setLocalError("Signer restrictions must be 0x addresses.");
    setLocalError(null);
    const rate = RATE_PRESETS.find((item) => item.id === preset) ?? RATE_PRESETS[0];
    void onIssue({ name: name.trim(), scopes, signers: signerList, rateLimit: { capacity: rate.capacity, refillPerSecond: rate.refillPerSecond } }).then(
      (issued) => {
        if (!issued) return;
        setName("");
        setSigners("");
      },
    );
  };

  const message = localError ?? error;
  return (
    <Panel label="Create API key">
      <PanelHead title="Create API key" />
      <form onSubmit={submit} className="grid gap-3 px-3 py-3" aria-describedby={message ? `${formId}-error` : undefined}>
        <label className="grid gap-1 text-xs">
          <span className="text-dim">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} placeholder="e.g. Risk dashboard" className={FIELD} />
        </label>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-xs text-dim">Scopes</legend>
          {(
            [
              { scope: "read", label: "read", note: "Markets, book, trades, accounts, positions, orders, fills, receipts" },
              { scope: "trade", label: "trade", note: "Prepare and relay signed orders. Includes read." },
            ] as const
          ).map((item) => (
            <label key={item.scope} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={scopes.includes(item.scope)}
                onChange={(event) => toggleScope(item.scope, event.target.checked)}
                className="focus-ring mt-0.5 h-3.5 w-3.5 accent-[var(--color-brand)]"
              />
              <span>
                <span className="font-mono text-ink">{item.label}</span>
                <span className="block text-faint">{item.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="grid gap-1 text-xs">
          <span className="text-dim">Allowed signers (optional)</span>
          <input
            value={signers}
            onChange={(event) => setSigners(event.target.value)}
            placeholder="0x… addresses, comma separated"
            className={`${FIELD} font-mono`}
            spellCheck={false}
          />
          <span className="text-faint">When set, trade calls accept only orders signed by these addresses.</span>
        </label>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-xs text-dim">Rate limit</legend>
          <div role="radiogroup" aria-label="Rate limit preset" className="grid grid-cols-3 gap-0.5 rounded-md bg-inset p-0.5">
            {RATE_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={preset === item.id}
                onClick={() => setPreset(item.id)}
                className={`focus-ring grid min-w-0 gap-0.5 rounded-[5px] px-2 py-1.5 text-left text-[11px] transition-colors ${
                  preset === item.id ? "bg-raised text-ink" : "text-faint hover:text-dim"
                }`}
              >
                <span className="font-medium">{item.label}</span>
                <span className="tnum truncate font-mono text-[10.5px]">{item.note}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {message ? (
          <p id={`${formId}-error`} role="alert" className="text-xs text-down">
            {message}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-faint">The secret is shown once. Setryn stores only its hash.</span>
          <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>
            <KeyRound size={13} aria-hidden="true" />
            {busy ? "Issuing…" : "Create key"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

export function IssuedSecret({ secret, record, onDismiss }: { secret: string; record: ApiKeyView; onDismiss: () => void }) {
  return (
    <Panel label="New API key secret" className="border-brand-edge/50">
      <PanelHead title="Copy your new key" tools={<Chip tone="brand">Shown once</Chip>} />
      <div className="grid gap-2 px-3 py-3" role="status">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-dim">
          <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
          <span>
            {record.name} ({record.scopes.join(" + ")}). Store it in a secret manager now: Setryn keeps only a SHA-256 hash and cannot show it again. Revoke
            and reissue if it is lost.
          </span>
        </p>
        <div className="flex items-center gap-2 rounded-md border border-line bg-inset px-2 py-1.5">
          <code className="min-w-0 flex-1 font-mono text-[11px] break-all text-ink select-all">{secret}</code>
          <CopyButton value={secret} label="API key" />
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onDismiss} className={BUTTON_QUIET}>
            I have stored it
          </button>
        </div>
      </div>
    </Panel>
  );
}

export function KeysPanel({
  keys,
  selectedId,
  onSelect,
  onRevoke,
  revoking,
  now,
}: {
  keys: ApiKeyView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRevoke: (id: string) => void;
  revoking: string | null;
  now: number;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Panel label="API keys" delay={40}>
      <PanelHead title="API keys" tools={<Chip tone="dim">{keys.filter((key) => key.status === "ACTIVE").length} active</Chip>} />
      <div role="region" tabIndex={0} aria-label="API keys" className="focus-ring scroll-thin max-h-[420px] overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <caption className="sr-only">Issued API keys with scopes, usage and rate-limit headroom</caption>
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr className="border-b border-line">
              <th className={TH}>Key</th>
              <th className={TH}>Scopes</th>
              <th className={TH}>Status</th>
              <th className={TH_NUM}>Requests</th>
              <th className={TH}>Rate limit</th>
              <th className={TH}>Last used</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-faint">
                  No keys yet. Create one to call the API.
                </td>
              </tr>
            ) : (
              keys.map((key) => {
                const selected = key.id === selectedId;
                const active = key.status === "ACTIVE";
                return (
                  <tr key={key.id} className={`border-b border-line-soft ${selected ? "bg-raised/60" : ""}`}>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onSelect(key.id)}
                        aria-pressed={selected}
                        className="focus-ring grid rounded-sm text-left"
                      >
                        <span className="text-ink">{key.name}</span>
                        <span className="tnum font-mono text-[11px] text-faint">{key.prefix}_…</span>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex gap-1">
                        {key.scopes.map((scope) => (
                          <Chip key={scope} tone={scope === "trade" ? "brand" : "dim"}>
                            {scope}
                          </Chip>
                        ))}
                        {key.signers.length > 0 ? (
                          <Chip tone="neutral" title={key.signers.join("\n")}>
                            {key.signers.length} signer{key.signers.length === 1 ? "" : "s"}
                          </Chip>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={active ? "up" : "down"} dot>
                        {active ? "Active" : "Revoked"}
                      </Chip>
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono text-dim">
                      {key.usage.requests}
                      {key.usage.errors > 0 ? <span className="block text-[11px] text-faint">{key.usage.errors} errors</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid w-32 gap-1">
                        <Meter
                          value={key.rateLimit.remaining / key.rateLimit.capacity}
                          tone={key.rateLimit.remaining === 0 ? "down" : "up"}
                          label={`${key.name} rate-limit tokens remaining`}
                        />
                        <span className="tnum font-mono text-[11px] text-faint">
                          {key.rateLimit.remaining}/{key.rateLimit.capacity} · {key.rateLimit.refillPerSecond}/s
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-dim">{relativeTime(key.lastUsedAt, now)}</td>
                    <td className="px-3 py-2 text-right">
                      {active ? (
                        confirming === key.id ? (
                          <span className="inline-flex gap-1">
                            <button
                              type="button"
                              disabled={revoking === key.id}
                              onClick={() => {
                                setConfirming(null);
                                onRevoke(key.id);
                              }}
                              className="focus-ring inline-flex h-7 items-center rounded-md border border-down/40 px-2 text-[11px] text-down hover:bg-down-soft"
                            >
                              Confirm revoke
                            </button>
                            <button type="button" onClick={() => setConfirming(null)} className="focus-ring h-7 rounded-md px-2 text-[11px] text-faint hover:text-ink">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirming(key.id)}
                            aria-label={`Revoke ${key.name}`}
                            className="focus-ring inline-flex h-7 items-center rounded-md border border-line-strong px-2 text-[11px] text-dim hover:border-down/40 hover:text-down"
                          >
                            Revoke
                          </button>
                        )
                      ) : (
                        <span className="text-[11px] text-faint">{relativeTime(key.revokedAt, now)}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function statusTone(status: number): "up" | "down" | "dim" {
  if (status < 300) return "up";
  if (status === 429 || status >= 400) return "down";
  return "dim";
}

export function RequestLogPanel({ apiKey, now }: { apiKey: ApiKeyView | null; now: number }) {
  const entries = apiKey?.recentRequests ?? [];
  return (
    <Panel label="Integration log" delay={80}>
      <PanelHead
        title="Integration log"
        tools={apiKey ? <span className="truncate text-[11px] text-faint">{apiKey.name} · last {entries.length} requests</span> : null}
      />
      {apiKey ? (
        <div className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
          {[
            ["Requests", apiKey.usage.requests],
            ["Errors", apiKey.usage.errors],
            ["Rate limited", apiKey.usage.rateLimited],
            ["Replay rejected", apiKey.usage.replayRejected],
          ].map(([label, value]) => (
            <div key={label} className="px-3 py-2">
              <div className="text-[11px] text-faint">{label}</div>
              <div className="tnum font-mono text-sm text-ink">{value}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div role="region" tabIndex={0} aria-label="Recent API requests" className="focus-ring scroll-thin max-h-[360px] overflow-auto">
        <table className="w-full min-w-[620px] border-collapse text-xs">
          <caption className="sr-only">Most recent requests made with the selected key</caption>
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr className="border-b border-line">
              <th className={TH}>When</th>
              <th className={TH}>Request</th>
              <th className={TH}>Status</th>
              <th className={TH_NUM}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-faint">
                  {apiKey ? "No requests with this key yet." : "Select a key to see its requests."}
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line-soft">
                  <td className="px-3 py-1.5 whitespace-nowrap text-dim" title={entry.at}>
                    {relativeTime(entry.at, now)}
                  </td>
                  <td className="max-w-[360px] truncate px-3 py-1.5 font-mono text-[11px] text-ink" title={`${entry.method} ${entry.path}\nrequest ${entry.id}`}>
                    <span className="mr-1.5 text-faint">{entry.method}</span>
                    {entry.path}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <Chip tone={statusTone(entry.status)}>{entry.status}</Chip>
                      {entry.code ? <span className="font-mono text-[11px] text-faint">{entry.code}</span> : null}
                    </span>
                  </td>
                  <td className="tnum px-3 py-1.5 text-right font-mono text-dim">{entry.durationMs} ms</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
