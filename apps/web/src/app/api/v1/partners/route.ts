import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok, readBody } from "@/lib/webhooks/http";
import { createPartner, listPartners, WIDGET_KINDS } from "@/lib/webhooks/partners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/partners: embedded deployments with permissions, quotas and attribution. */
export async function GET(request: Request) {
  try {
    await authorizeManagement(request);
    return ok({ partners: await listPartners(), widgetKinds: WIDGET_KINDS });
  } catch (error) {
    return failure(error);
  }
}

/** POST { code, name, allowedOrigins?, widgets?, deepLinkEnabled?, webhookEventTypes?, revShareBps?, quotas?, attributedAccounts? } */
export async function POST(request: Request) {
  try {
    await authorizeManagement(request);
    return ok({ partner: await createPartner(await readBody(request)) }, 201);
  } catch (error) {
    return failure(error);
  }
}
