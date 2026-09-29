"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CircleAlert } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { formatUtcStamp } from "@/lib/terminal/format";
import { usePersistentState } from "@/lib/terminal/use-persistent-state";
import { notices, pendingActions, type SignalTone } from "./signals";

const SEEN_KEY = "setryn:notices-seen";

function parseSeen(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

const TONE_DOT: Record<SignalTone, string> = {
  up: "bg-up",
  down: "bg-down",
  warn: "bg-brand",
  info: "bg-dim",
};

export function NotificationBell() {
  const snapshot = useGatewaySnapshot();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = usePersistentState(SEEN_KEY, "", parseSeen);
  const pending = useMemo(() => pendingActions(snapshot), [snapshot]);
  const items = useMemo(() => notices(snapshot), [snapshot]);
  const seenAt = seen ? Date.parse(seen) : 0;
  const unread = items.filter((item) => Date.parse(item.time) > seenAt).length;
  const badge = unread + pending.filter((action) => action.tone === "warn").length;

  const toggle = () => {
    // Opening the panel marks everything shown as seen.
    if (!open && items[0]) setSeen(items[0].time);
    setOpen(!open);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={badge > 0 ? `Notifications, ${badge} new` : "Notifications"}
        className="focus-ring relative grid h-11 w-11 place-items-center rounded-md text-dim transition-colors hover:bg-raised hover:text-ink lg:h-9 lg:w-9"
      >
        <Bell size={16} aria-hidden="true" />
        {badge > 0 ? (
          <span className="tnum absolute top-1.5 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 font-mono text-[10px] leading-none font-semibold text-app lg:top-0.5 lg:right-0.5">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button type="button" aria-label="Close notifications" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="menu-pop absolute top-full right-0 z-50 mt-2 w-[min(380px,calc(100vw-16px))] overflow-hidden rounded-lg border border-line-strong bg-panel shadow-[0_24px_48px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
              <span className="text-sm font-medium text-ink">Notifications</span>
              <Link href="/alerts" onClick={() => setOpen(false)} className="focus-ring rounded-sm text-xs text-faint transition-colors hover:text-ink">
                Alert rules
              </Link>
            </div>
            <div className="scroll-thin max-h-[min(520px,70vh)] overflow-y-auto">
              {pending.length > 0 ? (
                <section aria-label="Action needed" className="border-b border-line p-1.5">
                  <div className="px-2 pt-1 pb-1.5 text-[10px] font-medium tracking-[0.08em] text-off uppercase">Action needed</div>
                  {pending.map((action) => (
                    <Link
                      key={action.id}
                      href={action.href}
                      onClick={() => setOpen(false)}
                      className="flex gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-raised"
                    >
                      <CircleAlert size={14} aria-hidden="true" className={`mt-0.5 shrink-0 ${action.tone === "warn" ? "text-brand" : "text-faint"}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-ink">{action.label}</span>
                        <span className="block text-[11px] leading-snug text-faint">{action.detail}</span>
                      </span>
                    </Link>
                  ))}
                </section>
              ) : null}
              <section aria-label="Recent" className="p-1.5">
                {items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-faint">No account events yet.</p>
                ) : (
                  items.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-raised"
                    >
                      <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[item.tone]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs text-ink">{item.title}</span>
                          <span className="tnum shrink-0 font-mono text-[10px] text-off">{formatUtcStamp(Date.parse(item.time) / 1000)}</span>
                        </span>
                        <span className="block text-[11px] leading-snug text-faint">{item.detail}</span>
                        <span className="mt-1 flex gap-1.5 text-[10px] text-off">
                          <span className="rounded-sm border border-line px-1">{item.source}</span>
                          <span className="rounded-sm border border-line px-1">{item.provenance}</span>
                        </span>
                      </span>
                    </Link>
                  ))
                )}
              </section>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
