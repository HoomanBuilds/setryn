import { assertLocalConsole } from "@/lib/public-api/console-guard";
import { errorResponse, toPublicApiError } from "@/lib/public-api/errors";
import { issueKey, listKeys } from "@/lib/public-api/keys";
import { parseJsonBody } from "@/lib/public-api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Setryn-Api-Version": "v1" };

/**
 * Console-only key management. There is no user account system yet, so these routes are guarded to the local devnet
 * console (loopback host, same-origin, chain 31337); see lib/public-api/console-guard.ts.
 */
export async function GET(request: Request) {
  try {
    await assertLocalConsole(request);
    return Response.json({ data: await listKeys() }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(toPublicApiError(error), NO_STORE);
  }
}

export async function POST(request: Request) {
  try {
    await assertLocalConsole(request);
    const input = parseJsonBody(await request.text());
    const { key, record } = await issueKey(input);
    const view = (await listKeys()).find((candidate) => candidate.id === record.id);
    return Response.json({ data: { key, record: view } }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return errorResponse(toPublicApiError(error), NO_STORE);
  }
}
