import { isAddress } from "viem";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 100 test ETH for gas on the local devnet only. */
const FUNDED_BALANCE = "0x56bc75e2d63100000";

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const body = (await response.json()) as { error?: unknown; result?: unknown };
  if (!response.ok || body.error) throw new Error("RPC_FAILED");
  return body.result;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { address?: unknown };
    if (typeof body.address !== "string" || !isAddress(body.address)) {
      return Response.json({ error: "Invalid account" }, { status: 400 });
    }
    const setryn = await readLocalRuntime();
    // anvil_setBalance returns null on success, so success is confirmed by reading the balance back.
    await rpc(setryn.rpcUrl, "anvil_setBalance", [body.address, FUNDED_BALANCE]);
    const balance = await rpc(setryn.rpcUrl, "eth_getBalance", [body.address, "latest"]);
    if (typeof balance !== "string" || BigInt(balance) !== BigInt(FUNDED_BALANCE)) throw new Error("FUNDING_FAILED");
    return Response.json({ funded: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Local devnet funding failed" }, { status: 503 });
  }
}
