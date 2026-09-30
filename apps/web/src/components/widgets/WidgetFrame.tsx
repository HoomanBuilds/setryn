"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EmbedTheme, EmbedWidgetKind } from "./embed-params";

const BLOCK_COPY: Record<string, string> = {
  PAUSED: "This partner deployment is paused.",
  WIDGET_NOT_PERMITTED: "This widget is not enabled for the partner deployment.",
  ORIGIN_NOT_ALLOWED: "This site is not an allowed origin for the partner deployment.",
  QUOTA_EXCEEDED: "The partner deployment has used its monthly widget quota.",
};

/** Origin of the page embedding this iframe, when the browser discloses it. */
function embedderOrigin(): string | null {
  try {
    const ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0) return ancestors[0];
  } catch {
    // Not exposed by every browser.
  }
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}

/**
 * Chromeless widget shell: applies the theme tokens, records the partner impression (skipped for console previews),
 * enforces the deployment's permission answer, and reports its height to the loader script for auto-resize.
 */
export function WidgetFrame({
  widget,
  theme,
  partner,
  preview,
  frameId,
  marketId,
  label,
  children,
}: {
  widget: EmbedWidgetKind;
  theme: EmbedTheme;
  partner: string | null;
  preview: boolean;
  frameId: string | null;
  marketId: string;
  label: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    if (!partner || preview) return;
    const controller = new AbortController();
    fetch("/api/v1/partners/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partner, widget, marketId, kind: "impression", origin: embedderOrigin() }),
      signal: controller.signal,
    })
      .then((response) => response.json() as Promise<{ data?: { allowed: boolean; reason: string } }>)
      .then((body) => {
        if (body.data && !body.data.allowed) setBlocked(body.data.reason);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [partner, preview, widget, marketId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.parent === window) return;
    let last = 0;
    const report = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      window.parent.postMessage({ type: "setryn:embed:resize", frameId, widget, height }, "*");
    };
    const observer = new ResizeObserver(report);
    observer.observe(root);
    report();
    return () => observer.disconnect();
  }, [frameId, widget]);

  return (
    <main
      ref={rootRef}
      data-embed-theme={theme}
      aria-label={label}
      className="flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel text-ink"
    >
      {blocked ? (
        <div role="status" className="px-3 py-4 text-sm text-dim">
          {BLOCK_COPY[blocked] ?? "This widget is unavailable."}
        </div>
      ) : (
        children
      )}
      <footer className="flex min-w-0 items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[11px] text-faint">
        <span className="truncate">Preview market data, not executable</span>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring shrink-0 rounded-sm font-medium text-dim hover:text-ink"
        >
          Setryn{partner ? <span className="sr-only">, via partner {partner}</span> : null}
        </a>
      </footer>
    </main>
  );
}
