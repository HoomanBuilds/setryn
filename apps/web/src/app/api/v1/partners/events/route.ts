import { failure, ok, readBody } from "@/lib/webhooks/http";
import { isPartnerCode, recordUsage, WIDGET_KINDS, type WidgetKind } from "@/lib/webhooks/partners";
import { WebhookApiError } from "@/lib/webhooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { partner, widget, marketId, kind: "impression", origin }: called by embedded widgets on load. Public (no
 * credentials); it only records aggregate counts and answers whether the partner's permissions allow the load.
 */
export async function POST(request: Request) {
  try {
    const body = await readBody(request, 2_048);
    if (!isPartnerCode(body.partner)) throw new WebhookApiError(400, "INVALID_PARTNER_CODE", "partner must be a partner code.");
    if (!(WIDGET_KINDS as readonly string[]).includes(body.widget as string)) {
      throw new WebhookApiError(400, "INVALID_WIDGET", `widget must be one of: ${WIDGET_KINDS.join(", ")}.`);
    }
    const marketId = typeof body.marketId === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(body.marketId) ? body.marketId : "ALL";
    const origin = typeof body.origin === "string" ? body.origin.slice(0, 200) : null;
    const decision = await recordUsage({ partner: body.partner, widget: body.widget as WidgetKind, marketId, kind: "impression", origin });
    return ok(decision);
  } catch (error) {
    return failure(error);
  }
}
