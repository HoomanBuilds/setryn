import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok, readBody } from "@/lib/webhooks/http";
import { deletePartner, getPartner, updatePartner } from "@/lib/webhooks/partners";
import { WebhookApiError } from "@/lib/webhooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/partners/[code]">) {
  try {
    await authorizeManagement(request);
    const { code } = await ctx.params;
    const partner = await getPartner(code);
    if (!partner) throw new WebhookApiError(404, "PARTNER_NOT_FOUND", `No partner ${code}.`);
    return ok({ partner });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/partners/[code]">) {
  try {
    await authorizeManagement(request);
    const { code } = await ctx.params;
    return ok({ partner: await updatePartner(code, await readBody(request)) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/partners/[code]">) {
  try {
    await authorizeManagement(request);
    const { code } = await ctx.params;
    await deletePartner(code);
    return ok({ code, deleted: true });
  } catch (error) {
    return failure(error);
  }
}
