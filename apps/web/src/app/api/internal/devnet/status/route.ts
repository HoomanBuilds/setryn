import { createPublicClient, http, type Address } from "viem";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTRACTS = [
  ["Collateral vault", "collateralVault"],
  ["Order state", "orderState"],
  ["Atomic clearing", "atomicClearingEngine"],
  ["Private RFQ book", "privateRfqBook"],
  ["Public order book", "publicOrderBook"],
  ["Position engine", "positionEngine"],
  ["Lifecycle engine", "signedLifecycleEngine"],
] as const;

export async function GET() {
  try {
    const setryn = await readLocalRuntime();
    const client = createPublicClient({ transport: http(setryn.rpcUrl) });
    const [chainId, blockNumber, bytecodes] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      Promise.all(
        CONTRACTS.map(([, field]) => client.getBytecode({ address: setryn[field] as Address })),
      ),
    ]);
    const contracts = CONTRACTS.map(([label, field], index) => ({
      label,
      address: setryn[field],
      healthy: Boolean(bytecodes[index] && bytecodes[index] !== "0x"),
    }));

    return Response.json(
      {
        environment: "LOCAL_DEVNET",
        chainId,
        blockNumber: blockNumber.toString(),
        checkedAt: new Date().toISOString(),
        healthy: chainId === setryn.chainId && contracts.every((contract) => contract.healthy),
        contracts,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Local Setryn devnet is unavailable" }, { status: 503 });
  }
}
