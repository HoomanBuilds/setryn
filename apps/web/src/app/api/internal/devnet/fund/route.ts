import { isAddress } from "viem";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { address?: unknown };
    if (typeof body.address !== "string" || !isAddress(body.address)) {
      return Response.json({ error: "Invalid account" }, { status: 400 });
    }
    const setryn = await readLocalRuntime();
    const response = await fetch(setryn.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_setBalance",
        params: [body.address, "0x56bc75e2d63100000"],
      }),
      cache: "no-store",
    });
    const result = (await response.json()) as { error?: unknown; result?: unknown };
    if (!response.ok || result.error || result.result !== true) throw new Error("FUNDING_FAILED");
    return Response.json({ funded: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Local devnet funding failed" }, { status: 503 });
  }
}
