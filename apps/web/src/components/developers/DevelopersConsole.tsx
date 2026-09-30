"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileJson } from "lucide-react";
import { PageFrame, PageHeader } from "@/components/home/kit";
import { Chip, Metric } from "@/components/strategies/desk/Desk";
import { ConsoleError, issueKey, listKeys, revokeKey, type ApiKeyView, type IssueKeyInput } from "./console-api";
import { AuthPanel, EndpointsPanel, QuickstartPanel, SignersPanel, WebhooksPanel } from "./DocsPanels";
import { BUTTON_QUIET, CreateKeyPanel, IssuedSecret, KeysPanel, RequestLogPanel } from "./KeyPanels";

const POLL_MS = 5_000;

type Load = { state: "LOADING" } | { state: "READY" } | { state: "UNAVAILABLE"; message: string };

export function DevelopersConsole() {
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [load, setLoad] = useState<Load>({ state: "LOADING" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ secret: string; record: ApiKeyView } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await listKeys();
      setKeys(next);
      setLoad({ state: "READY" });
      setNow(Date.now());
    } catch (error) {
      setLoad({
        state: "UNAVAILABLE",
        message:
          error instanceof ConsoleError && error.code === "CONSOLE_LOCAL_ONLY"
            ? error.message
            : "The key service did not respond. Is the local deployment running?",
      });
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const onIssue = async (input: IssueKeyInput): Promise<boolean> => {
    setIssuing(true);
    setIssueError(null);
    try {
      const result = await issueKey(input);
      setIssued({ secret: result.key, record: result.record });
      setSelectedId(result.record.id);
      await refresh();
      return true;
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : "The key could not be issued.");
      return false;
    } finally {
      setIssuing(false);
    }
  };

  const onRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await revokeKey(id);
      await refresh();
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : "The key could not be revoked.");
    } finally {
      setRevoking(null);
    }
  };

  const totals = useMemo(
    () =>
      keys.reduce(
        (sum, key) => ({
          active: sum.active + (key.status === "ACTIVE" ? 1 : 0),
          requests: sum.requests + key.usage.requests,
          errors: sum.errors + key.usage.errors,
          rateLimited: sum.rateLimited + key.usage.rateLimited,
          replay: sum.replay + key.usage.replayRejected,
        }),
        { active: 0, requests: 0, errors: 0, rateLimited: 0, replay: 0 },
      ),
    [keys],
  );
  const selected = keys.find((key) => key.id === selectedId) ?? keys.find((key) => key.status === "ACTIVE") ?? keys[0] ?? null;

  return (
    <PageFrame label="Developers">
      <PageHeader
        title="Developers"
        subtitle="API keys, SDK, delegated signers, webhooks, and integration logs"
        chips={
          <>
            <Chip tone="brand">API v1</Chip>
            <Chip tone="neutral" title="Key management is served only from the operator console host.">
              Console
            </Chip>
          </>
        }
        actions={
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className={BUTTON_QUIET}>
            <FileJson size={13} aria-hidden="true" />
            OpenAPI JSON
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          <Metric label="Active keys" value={load.state === "READY" ? totals.active : "–"} note={`${keys.length} issued`} />
          <Metric label="Requests" value={load.state === "READY" ? totals.requests : "–"} note="all keys" />
          <Metric label="Errors" value={load.state === "READY" ? totals.errors : "–"} tone={totals.errors > 0 ? "down" : "neutral"} note="4xx and 5xx" />
          <Metric label="Rate limited" value={load.state === "READY" ? totals.rateLimited : "–"} note="429 responses" />
          <Metric label="Replay rejected" value={load.state === "READY" ? totals.replay : "–"} note="nonce, clock, signature" />
        </div>
        {load.state === "UNAVAILABLE" ? (
          <p role="alert" className="border-t border-line px-3 py-2 text-xs text-down">
            {load.message}
          </p>
        ) : null}
      </PageHeader>

      <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-1">
          {issued ? <IssuedSecret secret={issued.secret} record={issued.record} onDismiss={() => setIssued(null)} /> : null}
          <KeysPanel keys={keys} selectedId={selected?.id ?? null} onSelect={setSelectedId} onRevoke={(id) => void onRevoke(id)} revoking={revoking} now={now} loading={load.state === "LOADING"} />
          <RequestLogPanel apiKey={selected} now={now} />
          <EndpointsPanel />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <CreateKeyPanel onIssue={onIssue} busy={issuing} error={issueError} />
          <QuickstartPanel />
          <AuthPanel />
          <SignersPanel />
          <WebhooksPanel />
        </div>
      </div>
    </PageFrame>
  );
}
