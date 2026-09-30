import { createPublicClient, createWalletClient, getAddress, http, keccak256, stringToHex, type Address, type Hex } from "viem";
import { exerciseWitnessAbi, positionTerminalAbi } from "@/lib/internal-gateway/protocol";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/;
const WITNESS_STAGER_ROLE = keccak256(stringToHex("SETRYN_LIFECYCLE_WITNESS_STAGER_ROLE"));
const POSITION_LIVE = 1;
const accessAbi = [
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

interface WitnessBody {
  actionId?: unknown;
  positionId?: unknown;
  finalFixings?: unknown;
}

/**
 * Local devnet only. Holder exercise executes through the signed lifecycle engine, and the lifecycle executor reads the
 * final-fixing witness for that action from a stager role. This stages exactly the fixing the position already committed
 * to: the reference is read from the position and the supplied fixing bytes must hash to the position's stored fixings
 * hash, so the stager cannot be used to choose a different fixing.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WitnessBody;
    if (
      typeof body.actionId !== "string" || !HASH.test(body.actionId) ||
      typeof body.positionId !== "string" || !HASH.test(body.positionId) ||
      typeof body.finalFixings !== "string" || !HEX.test(body.finalFixings)
    ) {
      return Response.json({ error: "Invalid exercise witness" }, { status: 400 });
    }
    const setryn = await readLocalRuntime();
    if (setryn.chainId !== 31337) return Response.json({ error: "Exercise witnesses are staged on the local devnet only" }, { status: 403 });
    const executor = setryn.positionLifecycleExecutor;
    if (!executor) return Response.json({ error: "LIFECYCLE_EXECUTOR_UNAVAILABLE" }, { status: 503 });
    const publicClient = createPublicClient({ transport: http(setryn.rpcUrl) });
    if ((await publicClient.getChainId()) !== 31337) {
      return Response.json({ error: "Exercise witnesses are staged on the local devnet only" }, { status: 403 });
    }

    const [, lifecycle] = await publicClient.readContract({
      address: setryn.positionEngine,
      abi: positionTerminalAbi,
      functionName: "getPosition",
      args: [body.positionId as Hex],
    });
    const zero = `0x${"0".repeat(64)}`;
    if (lifecycle.status !== POSITION_LIVE || lifecycle.finalFixingReference === zero) {
      return Response.json({ error: "FINAL_FIXING_NOT_ON_POSITION" }, { status: 409 });
    }
    if (keccak256(body.finalFixings as Hex).toLowerCase() !== lifecycle.finalFixingsHash.toLowerCase()) {
      return Response.json({ error: "FINAL_FIXING_WITNESS_MISMATCH" }, { status: 409 });
    }

    const accounts = await createWalletClient({ transport: http(setryn.rpcUrl) }).getAddresses();
    let stager: Address | null = null;
    for (const account of accounts) {
      const candidate = getAddress(account);
      const holds = await publicClient.readContract({
        address: executor,
        abi: accessAbi,
        functionName: "hasRole",
        args: [WITNESS_STAGER_ROLE, candidate],
      });
      if (holds) {
        stager = candidate;
        break;
      }
    }
    if (!stager) return Response.json({ error: "WITNESS_STAGER_UNAVAILABLE" }, { status: 503 });

    const walletClient = createWalletClient({ account: stager, transport: http(setryn.rpcUrl) });
    const args = [body.actionId as Hex, lifecycle.finalFixingReference, body.finalFixings as Hex] as const;
    await publicClient.simulateContract({ account: stager, address: executor, abi: exerciseWitnessAbi, functionName: "stageExerciseWitness", args });
    const hash = await walletClient.writeContract({
      chain: null,
      address: executor,
      abi: exerciseWitnessAbi,
      functionName: "stageExerciseWitness",
      args,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return Response.json({ error: "WITNESS_STAGING_FAILED" }, { status: 502 });
    return Response.json({ transactionHash: hash, fixingReference: lifecycle.finalFixingReference });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "WITNESS_STAGING_FAILED";
    return Response.json({ error: message }, { status: 503 });
  }
}
