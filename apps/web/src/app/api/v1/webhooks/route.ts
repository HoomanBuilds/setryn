import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok, readBody } from "@/lib/webhooks/http";
import { assertPartnerSubscriptionAllowed, getPartner } from "@/lib/webhooks/partners";
import { createSubscription, listSubscriptions, publicSubscription } from "@/lib/webhooks/service";
import { isWebhookEventType, WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/webhooks: the caller's subscriptions (secrets redacted) and the supported event types. */
export async function GET(request: Request) {
  try {
    const principal = await authorizeManagement(request, { allowApiKey: true });
    const subscriptions = await listSubscriptions(principal.ownerId);
    return ok({ subscriptions: subscriptions.map(publicSubscription), eventTypes: WEBHOOK_EVENT_TYPES });
  } catch (error) {
    return failure(error);
  }
}

/** POST /api/v1/webhooks { url, eventTypes?, description?, partnerCode?, fromBlock? }: returns the secret once. */
export async function POST(request: Request) {
  try {
    const principal = await authorizeManagement(request, { allowApiKey: true });
    const body = await readBody(request);
    if (typeof body.partnerCode === "string" && body.partnerCode.length > 0) {
      const existing = (await listSubscriptions(principal.ownerId)).filter((item) => item.partnerCode === body.partnerCode);
      const requested = Array.isArray(body.eventTypes) ? body.eventTypes.filter(isWebhookEventType) : undefined;
      await assertPartnerSubscriptionAllowed(body.partnerCode, requested, existing.length);
      // A partner subscription without explicit types takes exactly the partner's permitted set.
      if (body.eventTypes === undefined) body.eventTypes = (await getPartner(body.partnerCode))?.webhookEventTypes;
    }
    const subscription = await createSubscription(principal.ownerId, body);
    return ok({ subscription: publicSubscription(subscription), secret: subscription.secret }, 201);
  } catch (error) {
    return failure(error);
  }
}
