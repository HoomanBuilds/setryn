import { createPublicClient, createWalletClient, getAddress, http, keccak256, stringToHex, type Hex } from "viem";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));

const vaultAbi = [
  {
    type: "function",
    name: "deriveAccountId",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "accountId", type: "bytes32" }],
  },
] as const;

const lifecycleConsentTypes = {
  SetrynLifecycleConsentV1: [
    { name: "actionId", type: "bytes32" },
    { name: "accountId", type: "bytes32" },
    { name: "signer", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "maximumLiabilityIncreaseBaseUnits", type: "uint128" },
    { name: "maximumCollateralIncreaseBaseUnits", type: "uint128" },
    { name: "allowsPackageBreak", type: "bool" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

interface ConsentBody {
  actionId?: unknown;
  accountId?: unknown;
  nonce?: unknown;
  deadline?: unknown;
  salt?: unknown;
  allowsPackageBreak?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConsentBody;
    if (
      typeof body.actionId !== "string" || !HASH.test(body.actionId) ||
      typeof body.accountId !== "string" || !HASH.test(body.accountId) ||
      typeof body.nonce !== "string" || !/^\d+$/.test(body.nonce) ||
      typeof body.deadline !== "string" || !/^\d+$/.test(body.deadline) ||
      typeof body.salt !== "string" || !HASH.test(body.salt)
    ) {
      return Response.json({ error: "Invalid lifecycle consent" }, { status: 400 });
    }

    const setryn = await readLocalRuntime();
    const maker = getAddress(setryn.operator);
    const publicClient = createPublicClient({ transport: http(setryn.rpcUrl) });
    const walletClient = createWalletClient({ account: maker, transport: http(setryn.rpcUrl) });
    const makerAccountId = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "deriveAccountId",
      args: [maker, ACCOUNT_SALT],
    });
    if (makerAccountId.toLowerCase() !== body.accountId.toLowerCase()) {
      return Response.json({ error: "Consent account is not the devnet maker" }, { status: 403 });
    }

    const consent = {
      actionId: body.actionId as Hex,
      accountId: body.accountId as Hex,
      signer: maker,
      nonce: BigInt(body.nonce),
      deadline: BigInt(body.deadline),
      maximumLiabilityIncreaseBaseUnits: BigInt(0),
      maximumCollateralIncreaseBaseUnits: BigInt(0),
      allowsPackageBreak: body.allowsPackageBreak === true,
      salt: body.salt as Hex,
    };
    const signature = await walletClient.signTypedData({
      account: maker,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.signedLifecycleEngine },
      types: lifecycleConsentTypes,
      primaryType: "SetrynLifecycleConsentV1",
      message: consent,
    });

    return Response.json({ signature });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LIFECYCLE_CONSENT_FAILED";
    return Response.json({ error: message }, { status: 503 });
  }
}
