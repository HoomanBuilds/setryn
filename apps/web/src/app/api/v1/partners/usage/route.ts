import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok } from "@/lib/webhooks/http";
import { listUsage } from "@/lib/webhooks/partners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?days=30: widget impressions, deep-link clicks and blocked loads per day, partner, widget and market. */
export async function GET(request: Request) {
  try {
    await authorizeManagement(request);
    const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
    return ok({ rows: await listUsage(Number.isFinite(days) ? Math.max(1, Math.min(365, days)) : 30) });
  } catch (error) {
    return failure(error);
  }
}
