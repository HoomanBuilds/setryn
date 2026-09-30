import type { Account, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import type { SetrynClient } from "./client.ts";
import { SetrynOrderError } from "./errors.ts";
import { sendOrderTransactions } from "./orders.ts";
import type { PreparedExit, SerializedLifecycleAction, SubmitExitResult, TransactionRequest } from "./types.ts";

/** EIP-712 type of a Setryn lifecycle action (domain `Setryn` v1 on the SignedLifecycleEngine). */
export const lifecycleActionTypes = {
  SetrynLifecycleActionV1: [
    { name: "kind", type: "uint8" },
    { name: "actor", type: "address" },
    { name: "actorAccountId", type: "bytes32" },
    { name: "policyContextHash", type: "bytes32" },
    { name: "inputsHash", type: "bytes32" },
    { name: "successorsHash", type: "bytes32" },
    { name: "collateralReplacementsHash", type: "bytes32" },
    { name: "participantSetHash", type: "bytes32" },
    { name: "consentsHash", type: "bytes32" },
    { name: "riskDomainId", type: "bytes32" },
    { name: "riskDomainVersion", type: "uint32" },
    { name: "feeScheduleId", type: "bytes32" },
    { name: "feeScheduleVersion", type: "uint32" },
    { name: "economicTransitionHash", type: "bytes32" },
    { name: "compressionPlanId", type: "bytes32" },
    { name: "breaksPackageProvenance", type: "bool" },
    { name: "packageBreakPermissionHash", type: "bytes32" },
    { name: "actorMaximumLiabilityIncreaseBaseUnits", type: "uint128" },
    { name: "actorMaximumCollateralIncreaseBaseUnits", type: "uint128" },
    { name: "inputCount", type: "uint16" },
    { name: "successorCount", type: "uint16" },
    { name: "participantCount", type: "uint16" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "permittedExecutor", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "engine", type: "address" },
  ],
} as const;

/** The action message with its wide integers as bigint, as EIP-712 signing expects. */
export function toSignableLifecycleAction(action: SerializedLifecycleAction) {
  return {
    ...action,
    actorMaximumLiabilityIncreaseBaseUnits: BigInt(action.actorMaximumLiabilityIncreaseBaseUnits),
    actorMaximumCollateralIncreaseBaseUnits: BigInt(action.actorMaximumCollateralIncreaseBaseUnits),
    deadline: BigInt(action.deadline),
    nonce: BigInt(action.nonce),
  };
}

/**
 * Signs a prepared exit locally with a viem WalletClient. The typed data is checked against the fixed
 * `SetrynLifecycleActionV1` layout and the message is rebuilt from `prepared.action`, so a tampered response cannot make
 * the wallet sign a different structure or action.
 */
export async function signPreparedExit(
  wallet: WalletClient<Transport, Chain | undefined, Account | undefined>,
  prepared: PreparedExit,
): Promise<Hex> {
  const { typedData, action } = prepared;
  const expected = lifecycleActionTypes.SetrynLifecycleActionV1.map((field) => `${field.name}:${field.type}`).join(",");
  const received = typedData.types.SetrynLifecycleActionV1.map((field) => `${field.name}:${field.type}`).join(",");
  if (
    expected !== received ||
    typedData.primaryType !== "SetrynLifecycleActionV1" ||
    typedData.domain.name !== "Setryn" ||
    typedData.domain.version !== "1" ||
    typedData.message.engine.toLowerCase() !== typedData.domain.verifyingContract.toLowerCase() ||
    BigInt(typedData.message.chainId) !== BigInt(typedData.domain.chainId)
  ) {
    throw new SetrynOrderError("SIGN", "The prepared typed data does not match the Setryn lifecycle action layout.");
  }
  const walletChainId = await wallet.getChainId();
  if (walletChainId !== typedData.domain.chainId) {
    throw new SetrynOrderError("SIGN", `Wallet is on chain ${walletChainId}; the exit is for chain ${typedData.domain.chainId}.`);
  }
  const account = wallet.account ?? action.actor;
  const address = typeof account === "string" ? account : account.address;
  if (address.toLowerCase() !== action.actor.toLowerCase()) {
    throw new SetrynOrderError("SIGN", `Wallet account ${address} is not the exit actor ${action.actor}.`);
  }
  return wallet.signTypedData({
    account,
    domain: typedData.domain,
    types: lifecycleActionTypes,
    primaryType: "SetrynLifecycleActionV1",
    message: { ...toSignableLifecycleAction(action), chainId: BigInt(typedData.domain.chainId), engine: typedData.domain.verifyingContract },
  });
}

export interface ExitPositionResult {
  prepared: PreparedExit;
  actorSignature: Hex;
  submitted: SubmitExitResult;
  transactionHashes: Hex[];
}

/**
 * Fully closes a position against the opposite position that offsets it, the way the Setryn terminal does: prepare the
 * exit on the API (the counterparty's consent is attached), sign the lifecycle action in the wallet, have the API
 * verify it, then send the authorize and execute transactions from the wallet, waiting for each receipt.
 */
export async function exitPosition(
  client: SetrynClient,
  wallet: WalletClient<Transport, Chain | undefined, Account | undefined>,
  publicClient: PublicClient,
  input: { positionIds: [Hex, Hex] },
  onStep?: (transaction: TransactionRequest, hash: Hex) => void,
): Promise<ExitPositionResult> {
  const signer = wallet.account?.address;
  if (!signer) throw new SetrynOrderError("SIGN", "The wallet client needs an account to exit a position.");
  const prepared = await client.prepareExit({ signer, positionIds: input.positionIds });
  const actorSignature = await signPreparedExit(wallet, prepared);
  const submitted = await client.submitExit({
    action: prepared.action,
    inputs: prepared.inputs,
    replacements: prepared.replacements,
    consent: prepared.consent,
    consentSignature: prepared.consentSignature,
    actorSignature,
  });
  const transactionHashes = await sendOrderTransactions(wallet, publicClient, submitted.transactions, onStep);
  return { prepared, actorSignature, submitted, transactionHashes };
}
