const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Devnet control routes answer only a same-origin request that arrived on a loopback host. The runtime reader separately
 * refuses anything but the local chain (31337) on a loopback RPC.
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
