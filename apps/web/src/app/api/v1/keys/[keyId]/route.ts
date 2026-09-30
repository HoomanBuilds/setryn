import { assertLocalConsole } from "@/lib/public-api/console-guard";
import { PublicApiError, errorResponse, toPublicApiError } from "@/lib/public-api/errors";
import { listKeys, revokeKey } from "@/lib/public-api/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Setryn-Api-Version": "v1" };

/** Revokes a key immediately; it fails authentication from the next request on. Console-only, like /keys. */
export async function DELETE(request: Request, { params }: { params: Promise<{ keyId: string }> }) {
  try {
    await assertLocalConsole(request);
    const { keyId } = await params;
    if (!/^[0-9a-f]{12}$/.test(keyId)) throw new PublicApiError(400, "INVALID_REQUEST", "keyId must be 12 hex characters.");
    const record = await revokeKey(keyId);
    const view = (await listKeys()).find((candidate) => candidate.id === record.id);
    return Response.json({ data: view }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(toPublicApiError(error), NO_STORE);
  }
}
