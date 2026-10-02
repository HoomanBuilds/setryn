import { readFirmQuoteBook } from "@/lib/quotes/quote-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The firm quote book now: every configured market's signed, capacity-backed maker bid and ask, or why it has none.
 * The first paint reads this; the terminal then follows /api/quotes/stream. Quotes are offchain signatures, so serving
 * them costs no gas; the settlement router verifies everything onchain when one is taken.
 */
export async function GET() {
  try {
    return Response.json(await readFirmQuoteBook(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "QUOTES_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
