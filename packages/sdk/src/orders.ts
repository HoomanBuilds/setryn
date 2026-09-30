import type { Account, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import type { SetrynClient } from "./client.ts";
import { SetrynOrderError } from "./errors.ts";
import type { PrepareOrderInput, PreparedOrder, SerializedPublicOrder, SubmitOrderResult, TransactionRequest } from "./types.ts";

/** EIP-712 type of a Setryn public order (primary type `PublicOrder`, domain `Setryn` v1 on OrderState). */
export const publicOrderTypes = {
  PublicOrder: [
    { name: "signer", type: "address" },
    { name: "accountId", type: "bytes32" },
    { name: "policyId", type: "bytes32" },
    { name: "policyContextHash", type: "bytes32" },
    { name: "actionId", type: "bytes32" },
    { name: "targetKind", type: "uint8" },
    { name: "seriesId", type: "bytes32" },
    { name: "packageId", type: "bytes32" },
    { name: "targetVersion", type: "uint32" },
    { name: "side", type: "uint8" },
    { name: "lots", type: "uint128" },
    { name: "priceTicks", type: "int128" },
    { name: "timeInForce", type: "uint8" },
    { name: "deadline", type: "uint64" },
    { name: "executionModeId", type: "bytes32" },
    { name: "feeScheduleId", type: "bytes32" },
    { name: "feeScheduleVersion", type: "uint32" },
    { name: "maxFeeMinor", type: "uint128" },
    { name: "recipient", type: "address" },
    { name: "permittedExecutor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "allowPartialFills", type: "bool" },
    { name: "minimumFillLots", type: "uint128" },
    { name: "remainderPolicy", type: "uint8" },
    { name: "postOnly", type: "bool" },
    { name: "reduceOnly", type: "bool" },
  ],
} as const;

/** The order message with its wide integers as bigint, as EIP-712 signing expects. */
export function toSignableOrder(order: SerializedPublicOrder) {
  return {
    ...order,
    lots: BigInt(order.lots),
    priceTicks: BigInt(order.priceTicks),
    deadline: BigInt(order.deadline),
    maxFeeMinor: BigInt(order.maxFeeMinor),
    nonce: BigInt(order.nonce),
    minimumFillLots: BigInt(order.minimumFillLots),
  };
}

/**
 * Signs a prepared order locally with a viem WalletClient. The wallet must control `order.signer` and be on the
 * order's chain. Before signing, the typed data is checked against the fixed `PublicOrder` layout, so a tampered
 * response cannot make the wallet sign a different structure.
 */
export async function signPreparedOrder(
  wallet: WalletClient<Transport, Chain | undefined, Account | undefined>,
  prepared: PreparedOrder,
): Promise<Hex> {
  const { typedData, order } = prepared;
  const expected = publicOrderTypes.PublicOrder.map((field) => `${field.name}:${field.type}`).join(",");
  const received = typedData.types.PublicOrder.map((field) => `${field.name}:${field.type}`).join(",");
  if (expected !== received || typedData.primaryType !== "PublicOrder" || typedData.domain.name !== "Setryn" || typedData.domain.version !== "1") {
    throw new SetrynOrderError("SIGN", "The prepared typed data does not match the Setryn PublicOrder layout.");
  }
  const walletChainId = await wallet.getChainId();
  if (walletChainId !== typedData.domain.chainId) {
    throw new SetrynOrderError("SIGN", `Wallet is on chain ${walletChainId}; the order is for chain ${typedData.domain.chainId}.`);
  }
  const account = wallet.account ?? order.signer;
  const address = typeof account === "string" ? account : account.address;
  if (address.toLowerCase() !== order.signer.toLowerCase()) {
    throw new SetrynOrderError("SIGN", `Wallet account ${address} is not the order signer ${order.signer}.`);
  }
  return wallet.signTypedData({
    account,
    domain: typedData.domain,
    types: publicOrderTypes,
    primaryType: "PublicOrder",
    message: toSignableOrder(order),
  });
}

/** Sends the returned transactions from the signer's wallet in order, waiting for each receipt. */
export async function sendOrderTransactions(
  wallet: WalletClient<Transport, Chain | undefined, Account | undefined>,
  publicClient: PublicClient,
  transactions: readonly TransactionRequest[],
  onStep?: (transaction: TransactionRequest, hash: Hex) => void,
): Promise<Hex[]> {
  const hashes: Hex[] = [];
  for (const transaction of transactions) {
    const account = wallet.account ?? transaction.from;
    const hash = await wallet.sendTransaction({
      account,
      chain: wallet.chain ?? null,
      to: transaction.to,
      data: transaction.data,
      value: BigInt(transaction.value),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new SetrynOrderError(transaction.step, `${transaction.step} reverted in ${hash}.`);
    hashes.push(hash);
    onStep?.(transaction, hash);
  }
  return hashes;
}

export interface PlaceOrderResult {
  prepared: PreparedOrder;
  signature: Hex;
  submitted: SubmitOrderResult;
  transactionHashes: Hex[];
}

/**
 * Full non-custodial order flow: prepare on the API, sign in the wallet, relay to risk admission, then send the
 * returned transactions from the wallet. The API key never touches the private key and the API never sends a
 * transaction for you.
 */
export async function placeOrder(
  client: SetrynClient,
  wallet: WalletClient<Transport, Chain | undefined, Account | undefined>,
  publicClient: PublicClient,
  input: PrepareOrderInput,
  onStep?: (transaction: TransactionRequest, hash: Hex) => void,
): Promise<PlaceOrderResult> {
  const prepared = await client.prepareOrder(input);
  // Lock operator approvals must land before risk admission is bound.
  const approvalHashes = await sendOrderTransactions(wallet, publicClient, prepared.requiredTransactions, onStep);
  const signature = await signPreparedOrder(wallet, prepared);
  const submitted = await client.submitOrder({ order: prepared.order, signature });
  // Approvals already sent are not repeated: the server lists only the ones still missing.
  const transactionHashes = [...approvalHashes, ...(await sendOrderTransactions(wallet, publicClient, submitted.transactions, onStep))];
  return { prepared, signature, submitted, transactionHashes };
}
