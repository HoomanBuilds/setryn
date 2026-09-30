"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Chip, Panel, PanelHead } from "@/components/strategies/desk/Desk";
import { MARKETS, packageLabel } from "@/lib/terminal/markets";
import { WIDGET_KINDS, type PartnerDeployment, type WidgetKind } from "./api";
import { BUTTON, INPUT } from "./DeploymentsPanel";

const DEFAULT_HEIGHT: Record<WidgetKind, number> = { ticker: 84, market: 250, trade: 330 };

function subscribeNever() {
  return () => undefined;
}

/** Builds the loader snippet for a widget and shows it live, using the same iframe URL the loader would create. */
export function EmbedGenerator({ partners }: { partners: PartnerDeployment[] }) {
  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => "");
  const [widget, setWidget] = useState<WidgetKind>("market");
  const [market, setMarket] = useState(MARKETS[0].id);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [partner, setPartner] = useState(partners[0]?.code ?? "");
  const [side, setSide] = useState<"long" | "short">("long");
  const [lots, setLots] = useState("5");
  const [copied, setCopied] = useState(false);
  const [measured, setMeasured] = useState<{ src: string; height: number } | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // The preview answers the same resize messages embed.js listens for.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; height?: number } | null;
      if (event.origin !== window.location.origin || data?.type !== "setryn:embed:resize") return;
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow || typeof data.height !== "number") return;
      setMeasured({ src: frame.getAttribute("src") ?? "", height: Math.max(40, Math.min(1_200, Math.ceil(data.height))) });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const attributes = [
    `data-setryn-widget="${widget}"`,
    widget === "ticker" ? null : `data-market="${market}"`,
    `data-theme="${theme}"`,
    partner ? `data-partner="${partner}"` : null,
    widget === "trade" ? `data-side="${side}"` : null,
    widget === "trade" && lots ? `data-lots="${lots}"` : null,
  ].filter(Boolean);
  const snippet = `<div ${attributes.join(" ")}></div>\n<script async src="${origin}/embed.js"></script>`;

  const params = new URLSearchParams({ theme, preview: "1" });
  if (partner) params.set("partner", partner);
  if (widget === "trade") {
    params.set("side", side);
    if (lots) params.set("lots", lots);
  }
  const src = `/embed/${widget === "ticker" ? "ticker" : `${widget}/${encodeURIComponent(market)}`}?${params.toString()}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel label="Embed code generator">
        <PanelHead title="Embed code" tools={<Chip tone="dim">embed.js</Chip>} />
        <div className="grid gap-3 px-3 py-3 sm:grid-cols-2">
          <div>
            <label htmlFor="embed-widget" className="mb-1 block text-[11px] text-faint">Widget</label>
            <select id="embed-widget" className={INPUT} value={widget} onChange={(event) => setWidget(event.target.value as WidgetKind)}>
              {WIDGET_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "ticker" ? "Ticker strip" : kind === "market" ? "Market card" : "Quote and trade link"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="embed-market" className="mb-1 block text-[11px] text-faint">Market</label>
            <select id="embed-market" className={INPUT} value={market} onChange={(event) => setMarket(event.target.value)} disabled={widget === "ticker"}>
              {MARKETS.map((item) => (
                <option key={item.id} value={item.id}>{packageLabel(item)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="embed-theme" className="mb-1 block text-[11px] text-faint">Theme</label>
            <select id="embed-theme" className={INPUT} value={theme} onChange={(event) => setTheme(event.target.value as "dark" | "light")}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div>
            <label htmlFor="embed-partner" className="mb-1 block text-[11px] text-faint">Partner attribution</label>
            <select id="embed-partner" className={INPUT} value={partner} onChange={(event) => setPartner(event.target.value)}>
              <option value="">None</option>
              {partners.map((item) => (
                <option key={item.code} value={item.code}>{item.name} ({item.code})</option>
              ))}
            </select>
          </div>
          {widget === "trade" ? (
            <>
              <div>
                <label htmlFor="embed-side" className="mb-1 block text-[11px] text-faint">Initial direction</label>
                <select id="embed-side" className={INPUT} value={side} onChange={(event) => setSide(event.target.value as "long" | "short")}>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>
              <div>
                <label htmlFor="embed-lots" className="mb-1 block text-[11px] text-faint">Initial lots</label>
                <input id="embed-lots" inputMode="numeric" className={`${INPUT} tnum font-mono`} value={lots} onChange={(event) => setLots(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />
              </div>
            </>
          ) : null}
        </div>
        <div className="border-t border-line px-3 py-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span id="embed-snippet-label" className="text-[11px] text-faint">Snippet</span>
            <button type="button" className={BUTTON} onClick={copy}>{copied ? "Copied" : "Copy snippet"}</button>
          </div>
          <pre
            role="region"
            aria-labelledby="embed-snippet-label"
            tabIndex={0}
            className="focus-ring scroll-thin overflow-x-auto rounded-md border border-line bg-inset p-2 font-mono text-[11px] leading-5 text-ink"
          >
            {snippet}
          </pre>
          <p className="mt-2 text-[11px] text-faint">
            Widgets are read-only and never sign. Trading always opens Setryn in a new tab; partner clicks pass through the attribution redirect.
          </p>
        </div>
      </Panel>
      <Panel label="Live widget preview">
        <PanelHead title="Live preview" tools={<Chip tone="dim">Not counted</Chip>} />
        <div className={`p-3 ${theme === "light" ? "bg-[#e9e7e2]" : "bg-app"}`}>
          <iframe
            key={src}
            ref={frameRef}
            src={src}
            title={`Preview of the ${widget} widget`}
            className="block w-full border-0"
            style={{ height: measured?.src === src ? measured.height : DEFAULT_HEIGHT[widget] }}
          />
        </div>
      </Panel>
    </div>
  );
}
