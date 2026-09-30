import { createServer } from "node:http";

import { SIGNATURE_HEADER, verifySetrynSignature } from "../signature.ts";

/**
 * Local webhook receiver for manual verification. Verifies every delivery's signature against --secret and logs it.
 *
 *   node --experimental-strip-types services/webhooks/src/bin/test-receiver.ts --port 4610 --secret whsec_... \
 *     [--fail-first <n>] [--always-fail]
 *
 * --fail-first n answers 500 to the first n deliveries of each delivery id, then 200; --always-fail answers 503.
 */
const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const key = argv[index].replace(/^--/, "");
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) args.set(key, "true");
  else {
    args.set(key, next);
    index += 1;
  }
}
const port = Number(args.get("port") ?? 4610);
const secret = args.get("secret") ?? process.env.SETRYN_WEBHOOK_SECRET;
if (!secret) throw new TypeError("--secret is required");
const failFirst = Number(args.get("fail-first") ?? 0);
const alwaysFail = args.has("always-fail");
const seen = new Map<string, number>();
const started = Date.now();

createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const header = request.headers[SIGNATURE_HEADER.toLowerCase()];
    const verification = verifySetrynSignature({ payload: body, header: Array.isArray(header) ? header[0] : header, secret });
    const deliveryId = String(request.headers["setryn-delivery-id"] ?? "");
    const count = (seen.get(deliveryId) ?? 0) + 1;
    seen.set(deliveryId, count);
    const fail = alwaysFail || count <= failFirst;
    const status = !verification.valid ? 400 : fail ? (alwaysFail ? 503 : 500) : 200;
    let event: { id?: string; type?: string; source?: { blockNumber?: string } | null } = {};
    try { event = JSON.parse(body); } catch { /* logged as unparsable below */ }
    console.log(JSON.stringify({
      atMs: Date.now() - started,
      deliveryId,
      attemptHeader: request.headers["setryn-delivery-attempt"],
      receivedCount: count,
      eventId: event.id,
      type: event.type,
      block: event.source?.blockNumber ?? null,
      signature: verification.valid ? "VALID" : `INVALID:${verification.reason}`,
      respondedWith: status,
    }));
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ received: verification.valid && !fail }));
  });
}).listen(port, "127.0.0.1", () => console.log(JSON.stringify({ event: "receiver-listening", port, failFirst, alwaysFail })));
