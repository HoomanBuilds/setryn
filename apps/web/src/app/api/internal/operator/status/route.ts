import { createPublicClient, type Address } from "viem";
import { NETWORK_PROFILES, testFundingAvailable } from "@/lib/internal-gateway/network";
import { signerAvailability } from "@/lib/internal-gateway/operator-signer";
import { serverReadTransport } from "@/lib/internal-gateway/rpc-transport";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const CONTRACTS = [
  ["Collateral vault", "collateralVault"],
  ["Order state", "orderState"],
  ["Atomic clearing", "atomicClearingEngine"],
  ["Private RFQ book", "privateRfqBook"],
  ["Public order book", "publicOrderBook"],
  ["Position engine", "positionEngine"],
  ["Lifecycle engine", "signedLifecycleEngine"],
] as const;

/**
 * The deployment this server runs against: network, chain head and core contract code, which platform roles can sign
 * (public addresses only, never keys), and which network-dependent controls exist. The role section is present even
 * when the chain does not answer, so the platform can tell an unreachable chain from an unconfigured role.
 */
export async function GET() {
  let setryn;
  try {
    setryn = await readRuntime();
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "RUNTIME_UNAVAILABLE";
    return Response.json({ error: "RUNTIME_UNAVAILABLE", message }, { status: 503, headers: NO_STORE });
  }
  const network = setryn.network ?? "local";
  const profile = NETWORK_PROFILES[network];
  const signers = signerAvailability(setryn);
  const identity = {
    network,
    environment: profile.environmentId,
    label: profile.label,
    runtimeSchema: setryn.schemaVersion,
    runtimeChainId: setryn.chainId,
    signers,
    maker: { enabled: signers.maker.available, address: signers.maker.address },
    // The test-collateral faucet: local, or Arbitrum Sepolia settling in the mintable test USDC; never Arbitrum One.
    funding: { available: testFundingAvailable(setryn), mintableSettlementToken: setryn.settlementTokenMintable === true },
    feeChanges: network === "local" ? ("LOCAL_OPERATOR" as const) : ("GOVERNANCE_TIMELOCK" as const),
  };
  try {
    const client = createPublicClient({ transport: serverReadTransport(setryn.rpcUrl, setryn.chainId, { timeout: 8_000 }) });
    const [chainId, blockNumber, bytecodes] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      Promise.all(CONTRACTS.map(([, field]) => client.getCode({ address: setryn[field] as Address }))),
    ]);
    const contracts = CONTRACTS.map(([label, field], index) => ({
      label,
      address: setryn[field],
      healthy: Boolean(bytecodes[index] && bytecodes[index] !== "0x"),
    }));
    return Response.json(
      {
        ...identity,
        chainId,
        blockNumber: blockNumber.toString(),
        checkedAt: new Date().toISOString(),
        healthy: chainId === setryn.chainId && contracts.every((contract) => contract.healthy),
        contracts,
      },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { ...identity, error: "CHAIN_UNAVAILABLE", message: `${profile.label} did not answer.`, checkedAt: new Date().toISOString() },
      { status: 503, headers: NO_STORE },
    );
  }
}
