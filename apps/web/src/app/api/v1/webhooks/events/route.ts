import { authorizeManagement } from "@/lib/webhooks/auth";
import { failure, ok } from "@/lib/webhooks/http";
import { listEvents, readCursor } from "@/lib/webhooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?type=&limit=: recent chain-derived events and the worker's cursor. */
export async function GET(request: Request) {
  try {
    await authorizeManagement(request, { allowApiKey: true });
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit") ?? 50);
    const [events, cursor] = await Promise.all([listEvents(Number.isFinite(limit) ? limit : 50, params.get("type")), readCursor()]);
    return ok({ events, cursor });
  } catch (error) {
    return failure(error);
  }
}
