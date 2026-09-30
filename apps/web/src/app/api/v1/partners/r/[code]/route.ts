import { isPartnerCode, recordUsage, WIDGET_KINDS, type WidgetKind } from "@/lib/webhooks/partners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/partners/r/{code}?to=/trade/{id}&widget=trade&origin=...: records a partner deep-link click and
 * redirects to the platform. Only `/trade/` targets are accepted, so the route cannot be used as an open redirect.
 * Clicks refused by the partner's permissions still land on the platform, just without the partner reference.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/partners/r/[code]">) {
  const url = new URL(request.url);
  const { code } = await ctx.params;
  const rawTarget = url.searchParams.get("to") ?? "/trade";
  const target = /^\/trade(\/[A-Za-z0-9._-]{1,64})?(\?[A-Za-z0-9=&:_.%-]{0,256})?$/.test(rawTarget) ? rawTarget : "/trade";
  const widgetParam = url.searchParams.get("widget") ?? "trade";
  const widget: WidgetKind = (WIDGET_KINDS as readonly string[]).includes(widgetParam) ? (widgetParam as WidgetKind) : "trade";
  const marketId = target.split("?")[0].split("/")[2] ?? "ALL";
  const destination = new URL(target, url.origin);
  if (isPartnerCode(code)) {
    const decision = await recordUsage({ partner: code, widget, marketId, kind: "click", origin: url.searchParams.get("origin") }).catch(() => null);
    if (decision?.allowed) {
      destination.searchParams.set("source", "partner");
      destination.searchParams.set("sourceLabel", `Partner-${code}`);
      destination.searchParams.set("ref", code);
    }
  }
  return Response.redirect(destination, 302);
}
