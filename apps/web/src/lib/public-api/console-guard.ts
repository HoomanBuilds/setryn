import { PublicApiError } from "./errors";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Key management has no user accounts to authorize against yet, so it is served only for the local console: the
 * deployment must be the local chain (SETRYN_NETWORK=local), the request must arrive on a loopback host, and a browser
 * request must be same-origin (blocks cross-site form posts and fetches from other pages). A production build refuses it
 * unless SETRYN_ENABLE_LOCAL_KEY_CONSOLE=1 is set explicitly. Once organization accounts exist, these routes move
 * behind that session instead.
 */
export async function assertLocalConsole(request: Request): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.SETRYN_ENABLE_LOCAL_KEY_CONSOLE !== "1") {
    throw new PublicApiError(403, "CONSOLE_LOCAL_ONLY", "Key management is disabled in production builds.");
  }
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!LOOPBACK.has(hostname)) {
    throw new PublicApiError(403, "CONSOLE_LOCAL_ONLY", "Key management is served only on a loopback host for the local network.");
  }
  const origin = request.headers.get("origin");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (origin && originHost !== host) {
    throw new PublicApiError(403, "CONSOLE_LOCAL_ONLY", "Key management accepts same-origin requests only.");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new PublicApiError(403, "CONSOLE_LOCAL_ONLY", "Key management accepts same-origin requests only.");
  }
  const runtime = await readRuntime().catch(() => null);
  if (!runtime || runtime.network !== "local") {
    throw new PublicApiError(403, "CONSOLE_LOCAL_ONLY", "Key management requires the local network deployment.");
  }
}
