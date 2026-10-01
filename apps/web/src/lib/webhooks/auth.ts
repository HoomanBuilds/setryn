import { verifyKey } from "@/lib/public-api/keys";
import { WebhookApiError } from "./service";

/**
 * Management authorization for webhook and partner routes.
 *
 * Webhook routes accept a public API key (`Authorization: Bearer stk_...`), verified by `@/lib/public-api/keys`; the
 * key id scopes the subscriptions (`key:<id>`). Without a key, management is local-console only: the request must reach
 * a loopback host, and a browser request must be same-origin (Origin, when present, must match Host) so a third-party
 * page cannot drive the local API; every such request acts as the single console owner (the partner console), stored
 * under the owner id `local-devnet` that services/webhooks shares.
 * Partner-deployment routes are console-only and refuse keys.
 */
export interface ManagementPrincipal {
  ownerId: string;
  mode: "local-console" | "api-key";
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
/** Persisted owner id of the console's subscriptions, shared with services/webhooks; kept for stored data. */
const CONSOLE_OWNER_ID = "local-devnet";

function hostname(host: string | null): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export async function authorizeManagement(
  request: Request,
  options: { allowApiKey?: boolean } = {},
): Promise<ManagementPrincipal> {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(stk_\S+)$/i.exec(authorization);
    if (!match || !options.allowApiKey) {
      throw new WebhookApiError(401, "INVALID_AUTHORIZATION", options.allowApiKey ? "Use Authorization: Bearer stk_..." : "This route is limited to the local partner console.");
    }
    try {
      const record = await verifyKey(match[1]);
      return { ownerId: `key:${record.id}`, mode: "api-key" };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "INVALID_API_KEY";
      throw new WebhookApiError(401, code, error instanceof Error ? error.message : "The API key is not recognized.");
    }
  }

  const host = request.headers.get("host");
  const name = hostname(host);
  if (!name || !LOOPBACK.has(name)) {
    throw new WebhookApiError(403, "LOCAL_CONSOLE_ONLY", "Webhook management without an API key is limited to the local console host.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== host) throw new WebhookApiError(403, "CROSS_ORIGIN_REFUSED", "Cross-origin management requests are refused.");
  }
  return { ownerId: CONSOLE_OWNER_ID, mode: "local-console" };
}
