import { readFirmQuoteBook } from "@/lib/quotes/quote-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Serverless hosts end a request at this many seconds; the stream closes itself before then and the client reconnects. */
export const maxDuration = 60;

/** How often the stream checks the engine; the engine re-signs only what changed, so most ticks send nothing. */
const TICK_MS = 500;
/** The stream ends on its own before the host's limit, and EventSource reconnects after `retry`. */
const STREAM_MS = 50_000;
const HEARTBEAT_MS = 10_000;

/**
 * Server-sent events of the firm quote book: one `quotes` event whenever any market's quotes change (new prices,
 * renewed deadlines, a market turning firm or indicative), comment heartbeats in between. No polling of the chain per
 * client: every stream on a server shares the engine's one signing pass per tick.
 */
export async function GET(request: Request) {
  const marketId = new URL(request.url).searchParams.get("market");
  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener("abort", () => {
    closed = true;
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      write("retry: 1000\n\n");
      const started = Date.now();
      let lastVersion = "";
      let lastWrite = Date.now();
      while (!closed && Date.now() - started < STREAM_MS) {
        try {
          const book = await readFirmQuoteBook();
          const market = marketId ? book.markets[marketId] : null;
          const scoped = marketId ? { ...book, markets: market ? { [marketId]: market } : {} } : book;
          const version = marketId
            ? `${market?.status ?? "MISSING"}:${[...(market?.bids ?? []), ...(market?.asks ?? [])].map((quote) => quote.id).join(":")}`
            : String(book.version);
          if (version !== lastVersion) {
            write(`event: quotes\ndata: ${JSON.stringify(scoped)}\n\n`);
            lastVersion = version;
            lastWrite = Date.now();
          }
        } catch {
          write(`event: unavailable\ndata: {"error":"QUOTES_UNAVAILABLE"}\n\n`);
          lastWrite = Date.now();
        }
        if (Date.now() - lastWrite > HEARTBEAT_MS) {
          write(`: heartbeat\n\n`);
          lastWrite = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, TICK_MS));
      }
      closed = true;
      controller.close();
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
