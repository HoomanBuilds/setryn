import { browserRpcUrl, readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The deployment runtime for the browser. `rpcUrl` is the browser's RPC (NEXT_PUBLIC_SETRYN_RPC_URL, else the
 * network's public endpoint, else locally the loopback node), never the server's SETRYN_RPC_URL, which may carry a key.
 */
export async function GET() {
  try {
    const setryn = await readRuntime();
    const network = setryn.network ?? "local";
    return Response.json(
      { ...setryn, rpcUrl: browserRpcUrl(network, setryn.rpcUrl) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "RUNTIME_UNAVAILABLE";
    return Response.json({ error: "RUNTIME_UNAVAILABLE", message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
