import { PublicApiError } from "@/lib/public-api/errors";
import { paginate, parseJsonBody, publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { parseAddress, parseBytes32 } from "@/lib/public-api/params";
import { RFQ_STATUS, loadRfqs, submitRfq } from "@/lib/public-api/rfqs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES = new Set<string>(Object.values(RFQ_STATUS));

/** Private RFQs requested by an account or signer, newest first. */
export const GET = publicRoute({ scope: "read" }, async ({ key, url }) => {
  const accountId = url.searchParams.get("accountId");
  const signer = url.searchParams.get("signer");
  if (!accountId && !signer) throw new PublicApiError(400, "INVALID_REQUEST", "Pass accountId or signer.");
  const state = url.searchParams.get("state");
  if (state && !STATES.has(state)) throw new PublicApiError(400, "INVALID_REQUEST", `state must be one of ${[...STATES].join(", ")}.`);
  const context = await chainContext();
  const rfqs = await loadRfqs(
    context,
    key,
    accountId ? { accountId: parseBytes32(accountId, "accountId") } : { signer: parseAddress(signer, "signer") },
  );
  return paginate(state ? rfqs.filter((rfq) => rfq.state === state) : rfqs, url);
});

/** Verifies a signed RFQ order and request, reserves risk, and returns the transactions the requester must send. */
export const POST = publicRoute({ scope: "trade", write: true }, async ({ key, body }) => {
  const context = await chainContext();
  const result = await submitRfq(context, key, parseJsonBody(body));
  return Response.json({ data: result }, { status: 202 });
});
