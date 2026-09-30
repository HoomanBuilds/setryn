import { PublicApiError } from "@/lib/public-api/errors";
import { paginate, parseJsonBody, publicRoute } from "@/lib/public-api/handler";
import { ORDER_STATUS, chainContext, loadOrders } from "@/lib/public-api/chain";
import { submitSignedOrder } from "@/lib/public-api/orders";
import { parseAddress, parseBytes32 } from "@/lib/public-api/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES = new Set<string>(Object.values(ORDER_STATUS));

export const GET = publicRoute({ scope: "read" }, async ({ url }) => {
  const accountId = url.searchParams.get("accountId");
  const signer = url.searchParams.get("signer");
  if (!accountId && !signer) throw new PublicApiError(400, "INVALID_REQUEST", "Pass accountId or signer.");
  const state = url.searchParams.get("state");
  if (state && !STATES.has(state)) throw new PublicApiError(400, "INVALID_REQUEST", `state must be one of ${[...STATES].join(", ")}.`);
  const context = await chainContext();
  const orders = await loadOrders(
    context,
    accountId ? { accountId: parseBytes32(accountId, "accountId") } : { signer: parseAddress(signer, "signer") },
  );
  return paginate(state ? orders.filter((order) => order.state === state) : orders, url);
});

/** Relays an already-signed order to risk admission and returns the transactions its signer must send. */
export const POST = publicRoute({ scope: "trade", write: true }, async ({ key, body }) => {
  const context = await chainContext();
  const result = await submitSignedOrder(context, key, parseJsonBody(body));
  return Response.json({ data: result }, { status: 202 });
});
