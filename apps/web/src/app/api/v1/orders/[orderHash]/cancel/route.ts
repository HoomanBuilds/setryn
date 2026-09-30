import { publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { prepareCancel } from "@/lib/public-api/orders";
import { parseBytes32 } from "@/lib/public-api/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prepares the transactions and risk-release message that cancel a working order; the signer executes them. */
export const POST = publicRoute<{ orderHash: string }>({ scope: "trade", write: true }, async ({ params, key }) => {
  const orderHash = parseBytes32(params.orderHash, "orderHash");
  return { data: await prepareCancel(await chainContext(), key, orderHash) };
});
