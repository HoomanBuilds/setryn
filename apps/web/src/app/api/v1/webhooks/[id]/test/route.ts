import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok, readBody } from "@/lib/webhooks/http";
import { publicDelivery, sendTestEvent } from "@/lib/webhooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { type? }: sends a signed `test: true` event now; a failure is retried by the worker with backoff. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]/test">) {
  try {
    const principal = await authorizeManagement(request, { allowApiKey: true });
    const { id } = await ctx.params;
    const body = await readBody(request);
    const delivery = await sendTestEvent(principal.ownerId, id, body.type);
    return ok({ delivery: publicDelivery(delivery) });
  } catch (error) {
    return failure(error);
  }
}
