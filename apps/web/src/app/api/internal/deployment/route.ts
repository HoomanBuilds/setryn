import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { readLocalDeploymentEvidence, readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvidenceContract {
  name: string;
  address: string | null;
  runtimeCodeHash?: string | null;
  bytecode?: { runtimeCodeHash?: string | null };
}

interface EvidenceManifest {
  environment: string;
  chainId: number;
  status: string;
  generatedAt: string | null;
  sourceCommit: string | null;
  compiler: { version: string; evmVersion: string; optimizer: { enabled: boolean; runs: number }; viaIR?: boolean; bytecodeHashMode: string };
  contracts: EvidenceContract[];
  phase2?: { deployments?: EvidenceContract[] };
  linkedLibraries?: EvidenceContract[];
}

type Kind = "library" | "core" | "protocol";

/**
 * Deployment evidence checked against the live chain: every recorded contract and linked library must have runtime
 * code whose hash equals the hash recorded when it was deployed.
 */
export async function GET() {
  try {
    const [setryn, evidence] = await Promise.all([readLocalRuntime(), readLocalDeploymentEvidence()]);
    const manifest = evidence as EvidenceManifest;
    const client = createPublicClient({ transport: http(setryn.rpcUrl, { batch: true }) });
    const entries: { kind: Kind; contract: EvidenceContract }[] = [
      ...(manifest.linkedLibraries ?? []).map((contract) => ({ kind: "library" as const, contract })),
      ...manifest.contracts.filter((contract) => contract.address).map((contract) => ({ kind: "core" as const, contract })),
      ...(manifest.phase2?.deployments ?? []).map((contract) => ({ kind: "protocol" as const, contract })),
    ];
    const [chainId, head, pending, codes] = await Promise.all([
      client.getChainId(),
      client.getBlock(),
      client.getBlock({ blockTag: "pending" }),
      Promise.all(entries.map(({ contract }) => client.getCode({ address: contract.address as Address }))),
    ]);
    const contracts = entries.map(({ kind, contract }, index) => {
      const code = codes[index];
      const liveHash = code && code !== "0x" ? keccak256(code as Hex) : null;
      const expectedHash = (contract.runtimeCodeHash ?? contract.bytecode?.runtimeCodeHash ?? null)?.toLowerCase() ?? null;
      return {
        name: contract.name,
        kind,
        address: contract.address,
        expectedHash,
        liveHash,
        state: !liveHash ? "MISSING" : expectedHash && liveHash === expectedHash ? "MATCHES" : "MISMATCH",
      };
    });
    return Response.json(
      {
        environment: manifest.environment,
        manifestChainId: manifest.chainId,
        chainId,
        status: manifest.status,
        generatedAt: manifest.generatedAt,
        sourceCommit: manifest.sourceCommit,
        compiler: manifest.compiler,
        blockNumber: head.number.toString(),
        headTime: new Date(Number(head.timestamp) * 1000).toISOString(),
        chainTime: new Date(Number(pending.timestamp) * 1000).toISOString(),
        checkedAt: new Date().toISOString(),
        contracts,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error && /ENOENT/.test(error.message) ? "EVIDENCE_MISSING" : "CHAIN_UNAVAILABLE";
    return Response.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
