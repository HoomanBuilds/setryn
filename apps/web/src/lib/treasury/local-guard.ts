const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Local-chain control routes (fee schedule changes) answer only a same-origin request that arrived on a loopback host.
 * The routes separately refuse every network but the local chain, where fees change through the governance timelock.
 */
export function localRequestRefusal(request: Request): string | null {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!LOOPBACK.has(hostname)) return "This control is served only on a loopback host.";
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== host) return "This control accepts same-origin requests only.";
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return "This control accepts same-origin requests only.";
  return null;
}
