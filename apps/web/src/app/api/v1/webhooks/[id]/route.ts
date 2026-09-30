import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok, readBody } from "@/lib/webhooks/http";
import { deleteSubscription, getSubscription, publicSubscription, updateSubscription } from "@/lib/webhooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]">) {
  try {
    const principal = await authorizeManagement(request, { allowApiKey: true });
    const { id } = await ctx.params;
    return ok({ subscription: publicSubscription(await getSubscription(principal.ownerId, id)) });
  } catch (error) {
    return failure(error);
  }
}

/** PATCH { url?, eventTypes?, description?, active? } */
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]">) {
  try {
    const principal = await authorizeManagement(request, { allowApiKey: true });
    const { id } = await ctx.params;
    const subscription = await updateSubscription(principal.ownerId, id, await readBody(request));
    return ok({ subscription: publicSubscription(subscription) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]">) {
  try {
    const principal = await authorizeManagement(request, { allowApiKey: true });
    const { id } = await ctx.params;
    await deleteSubscription(principal.ownerId, id);
    return ok({ id, deleted: true });
  } catch (error) {
    return failure(error);
  }
}
