import {
  OrganizationRequestError,
  normalizeMember,
  organizationErrorResponse,
  performOrganizationAction,
  readOrganizationState,
} from "@/lib/settings/organization-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Organization records for one member: `?member=<address>` returns every organization that address has a membership
 * record in, with the network's write status. Without an address the snapshot is empty.
 */
export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get("member");
    const member = normalizeMember(raw);
    if (raw !== null && raw !== "" && member === null) {
      return Response.json({ error: "INVALID_MEMBER", message: "member must be a wallet address" }, { status: 400, headers: NO_STORE });
    }
    return Response.json(await readOrganizationState(member), { headers: NO_STORE });
  } catch (error) {
    const failure =
      error instanceof OrganizationRequestError
        ? error
        : new OrganizationRequestError(503, "ORGANIZATION_UNAVAILABLE", error instanceof Error ? error.message.split("\n")[0] : "Organization records are unavailable");
    return Response.json({ error: failure.code, message: failure.message }, { status: failure.status, headers: NO_STORE });
  }
}

/** One wallet-signed organization action: `{ action, params, actor, issuedAt, signature }`. */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    return Response.json(await performOrganizationAction(body), { headers: NO_STORE });
  } catch (error) {
    const { status, body } = organizationErrorResponse(error);
    return Response.json(body, { status, headers: NO_STORE });
  }
}
