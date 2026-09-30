import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok, readBody } from "@/lib/webhooks/http";
import { publicSubscription, rotateSecret } from "@/lib/webhooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { graceSeconds? }: new secret returned once; the previous one co-signs until the grace window ends. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]/rotate-secret">) {
  try {
    const principal = await authorizeManagement(request, { allowApiKey: true });
    const { id } = await ctx.params;
    const body = await readBody(request);
    const subscription = await rotateSecret(principal.ownerId, id, body.graceSeconds);
    return ok({ subscription: publicSubscription(subscription), secret: subscription.secret });
  } catch (error) {
    return failure(error);
  }
}
