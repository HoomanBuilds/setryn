import { encodeAbiParameters, keccak256, maxUint256, parseUnits, stringToHex, type Hex } from "viem";
import type { RoleSigner } from "./operator-signer";
import { orderStateAbi, publicOrderBookAbi, riskBindingAbi, type OnchainPublicOrder } from "./protocol";

/*
 * The designated maker's collateral account and order housekeeping, shared by the liquidity and RFQ routes. The maker
 * signs with `makerSigner()` (operator-signer.ts): the local operator account, or SETRYN_MAKER_PRIVATE_KEY on a network.
 */

export const MAKER_ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
/*
 * Policy context preimages of the maker's book and RFQ orders. The values are protocol constants shared with
 * services/operator-runtime, which recognizes the house maker's orders by them, so they keep their original wording.
 */
export const MAKER_PUBLIC_POLICY_CONTEXT = keccak256(stringToHex("SETRYN_DEVNET_MAKER_PUBLIC_SERIES_V1"));
export const MAKER_RFQ_POLICY_CONTEXT = keccak256(stringToHex("SETRYN_DEVNET_MAKER_PRIVATE_RFQ_V1"));
export const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));

/** Collateral a mintable test deployment gives its maker to quote every market with room to fill. */
const TEST_MAKER_FUNDING = parseUnits("5000000", 6);

export const makerVaultAbi = [
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
  {
    type: "function",
    name: "accountExists",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "bytes32" }],
    outputs: [{ name: "exists", type: "bool" }],
  },
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ name: "accountId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
      { name: "accountId", type: "bytes32" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isLockOperator",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    type: "function",
    name: "setLockOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const tokenAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

async function confirm(signer: RoleSigner, hash: Hex, failure: string): Promise<void> {
  const receipt = await signer.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(failure);
}

/** The maker's collateral account id (its primary account under the platform salt). */
export function makerAccountId(signer: RoleSigner): Promise<Hex> {
  return signer.publicClient.readContract({
    address: signer.setryn.collateralVault,
    abi: makerVaultAbi,
    functionName: "deriveAccountId",
    args: [signer.address, MAKER_ACCOUNT_SALT],
  });
}

/**
 * Makes the maker's account ready to quote: it exists, holds collateral, and lets the clearing and position engines
 * lock it. A mintable test deployment lets the maker mint its collateral once. With real USDC, whatever settlement
 * token its wallet holds is deposited, so a top-up needs no other step.
 */
export async function ensureMakerAccount(signer: RoleSigner): Promise<Hex> {
  const { setryn, publicClient, walletClient } = signer;
  const local = (setryn.network ?? "local") === "local";
  const mintable = local || setryn.settlementTokenMintable === true;
  const accountId = await makerAccountId(signer);
  const exists = await publicClient.readContract({ address: setryn.collateralVault, abi: makerVaultAbi, functionName: "accountExists", args: [accountId] });
  if (!exists) {
    const hash = await walletClient.writeContract({
      chain: null,
      address: setryn.collateralVault,
      abi: makerVaultAbi,
      functionName: "createAccount",
      args: [MAKER_ACCOUNT_SALT],
    });
    await confirm(signer, hash, "MAKER_ACCOUNT_CREATION_FAILED");
  }
  let deposit = BigInt(0);
  if (mintable && !exists) {
    const hash = await walletClient.writeContract({ chain: null, address: setryn.settlementToken, abi: tokenAbi, functionName: "mint", args: [TEST_MAKER_FUNDING] });
    await confirm(signer, hash, "MAKER_FUNDING_FAILED");
    deposit = TEST_MAKER_FUNDING;
  } else if (!local) {
    deposit = await publicClient.readContract({ address: setryn.settlementToken, abi: tokenAbi, functionName: "balanceOf", args: [signer.address] });
  }
  if (deposit > BigInt(0)) {
    const allowance = await publicClient.readContract({
      address: setryn.settlementToken,
      abi: tokenAbi,
      functionName: "allowance",
      args: [signer.address, setryn.collateralVault],
    });
    if (allowance < deposit) {
      // Locally the vault gets a standing approval; on a network only what is being deposited.
      const hash = await walletClient.writeContract({
        chain: null,
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "approve",
        args: [setryn.collateralVault, local ? maxUint256 : deposit],
      });
      await confirm(signer, hash, "MAKER_APPROVAL_FAILED");
    }
    const hash = await walletClient.writeContract({
      chain: null,
      address: setryn.collateralVault,
      abi: makerVaultAbi,
      functionName: "deposit",
      args: [setryn.settlementAssetId, 1, accountId, deposit],
    });
    await confirm(signer, hash, "MAKER_DEPOSIT_FAILED");
  }
  for (const operator of [setryn.atomicClearingEngine, setryn.positionEngine]) {
    const approved = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: makerVaultAbi,
      functionName: "isLockOperator",
      args: [accountId, operator],
    });
    if (approved) continue;
    const hash = await walletClient.writeContract({
      chain: null,
      address: setryn.collateralVault,
      abi: makerVaultAbi,
      functionName: "setLockOperator",
      args: [accountId, operator, true],
    });
    await confirm(signer, hash, "MAKER_LOCK_APPROVAL_FAILED");
  }
  return accountId;
}

/**
 * Withdraws one of the maker's resting book orders: cancels it, takes it off the book, and releases the risk it held
 * with the maker's signed cancellation. Used when the reference has moved through a resting quote.
 */
export async function withdrawMakerOrder(signer: RoleSigner, orderHash: Hex, order: Pick<OnchainPublicOrder, "accountId">): Promise<void> {
  const { setryn, publicClient, walletClient } = signer;
  const cancelHash = await walletClient.writeContract({ chain: null, address: setryn.orderState, abi: orderStateAbi, functionName: "cancelOrder", args: [orderHash] });
  await confirm(signer, cancelHash, "MAKER_ORDER_CANCELLATION_FAILED");
  const syncHash = await walletClient.writeContract({ chain: null, address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "syncOrder", args: [orderHash] });
  await confirm(signer, syncHash, "MAKER_ORDER_SYNC_FAILED");
  const admissionId = await publicClient.readContract({
    address: setryn.riskAdmissionBindingRegistry,
    abi: riskBindingAbi,
    functionName: "admissionForOrder",
    args: [orderHash],
  });
  if (/^0x0{64}$/.test(admissionId)) return;
  const block = await publicClient.getBlock({ blockTag: "pending" });
  const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  const cancellation = {
    admissionId,
    orderHash,
    accountId: order.accountId,
    signer: signer.address,
    nonce,
    deadline: block.timestamp + BigInt(240),
    cancellationReference: keccak256(
      encodeAbiParameters(
        [
          { name: "orderHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
        ],
        [orderHash, nonce],
      ),
    ),
  } as const;
  const signature = await walletClient.signTypedData({
    domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.riskAdmissionBindingRegistry },
    types: {
      SetrynRiskAdmissionCancellationV1: [
        { name: "admissionId", type: "bytes32" },
        { name: "orderHash", type: "bytes32" },
        { name: "accountId", type: "bytes32" },
        { name: "signer", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
        { name: "cancellationReference", type: "bytes32" },
      ],
    },
    primaryType: "SetrynRiskAdmissionCancellationV1",
    message: cancellation,
  });
  const releaseHash = await walletClient.writeContract({
    chain: null,
    address: setryn.riskAdmissionBindingRegistry,
    abi: riskBindingAbi,
    functionName: "cancelBoundAdmission",
    args: [cancellation, signature],
  });
  await confirm(signer, releaseHash, "MAKER_RISK_RELEASE_FAILED");
}
