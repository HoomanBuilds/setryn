import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok } from "@/lib/webhooks/http";
import { listDeliveries, publicDelivery } from "@/lib/webhooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?limit=50: newest deliveries for one subscription with every attempt. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]/deliveries">) {
  try {
    const principal = await authorizeManagement(request, { allowApiKey: true });
    const { id } = await ctx.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    const deliveries = await listDeliveries(principal.ownerId, id, Number.isFinite(limit) ? limit : 50);
    return ok({ deliveries: deliveries.map(publicDelivery) });
  } catch (error) {
    return failure(error);
  }
}
