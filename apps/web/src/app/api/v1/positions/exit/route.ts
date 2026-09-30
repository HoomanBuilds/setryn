import { parseJsonBody, publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { submitExit } from "@/lib/public-api/exits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verifies a signed lifecycle exit and returns the authorize and execute transactions its actor must send. */
export const POST = publicRoute({ scope: "trade", write: true }, async ({ key, body }) => {
  const context = await chainContext();
  return { data: await submitExit(context, key, parseJsonBody(body)) };
});
