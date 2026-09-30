import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok } from "@/lib/webhooks/http";
import { listPartners } from "@/lib/webhooks/partners";
import { buildRevenueReport } from "@/lib/webhooks/revenue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: OBSERVED fill fees per attributed partner and the MODELED fee share (unsettled). */
export async function GET(request: Request) {
  try {
    await authorizeManagement(request);
    return ok(await buildRevenueReport(await listPartners()));
  } catch (error) {
    return failure(error);
  }
}
