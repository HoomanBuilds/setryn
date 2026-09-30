import type { Account, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import type { SetrynClient } from "./client.ts";
import { SetrynOrderError } from "./errors.ts";
import { sendOrderTransactions, sendRiskRelease, signPublicOrder } from "./orders.ts";
import type {
  AcceptRfqQuoteResult,
  PreparedRfq,
  PreparedRfqAcceptance,
  PreparedRfqCancel,
  PrepareRfqInput,
  Rfq,
  RfqQuote,
  RfqSettlement,
  SerializedRfqRequest,
  SerializedRfqSelection,
  SubmitRfqResult,
  TransactionRequest,
} from "./types.ts";

type Wallet = WalletClient<Transport, Chain | undefined, Account | undefined>;

/** EIP-712 type of a Setryn private RFQ request (domain `Setryn` v1 on the PrivateRfqBook). */
export const privateRfqRequestTypes = {
  PrivateRfqRequest: [
    { name: "taker", type: "address" },
    { name: "takerAccountId", type: "bytes32" },
    { name: "takerOrderHash", type: "bytes32" },
    { name: "targetKind", type: "uint8" },
    { name: "seriesId", type: "bytes32" },
    { name: "packageId", type: "bytes32" },
    { name: "targetVersion", type: "uint32" },
    { name: "hasPackageLegCommitment", type: "bool" },
    { name: "packageLegsHash", type: "bytes32" },
    { name: "sidePolicy", type: "uint8" },
    { name: "lots", type: "uint128" },
    { name: "allowPartialFills", type: "bool" },
    { name: "minimumFillLots", type: "uint128" },
    { name: "remainderPolicy", type: "uint8" },
    { name: "feeScheduleId", type: "bytes32" },
    { name: "feeScheduleVersion", type: "uint32" },
    { name: "maxFeeMinor", type: "uint128" },
    { name: "riskDomainId", type: "bytes32" },
    { name: "riskDomainVersion", type: "uint32" },
    { name: "privacyModeId", type: "bytes32" },
    { name: "executionModeId", type: "bytes32" },
    { name: "disclosurePolicyHash", type: "bytes32" },
    { name: "eligibleMakerSetHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "permittedExecutor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

/** EIP-712 type of the requester's quote selection (domain `Setryn` v1 on the PrivateRfqBook). */
export const rfqSelectionTypes = {
  RfqSelectionAuthorization: [
    { name: "rfqId", type: "bytes32" },
    { name: "quoteId", type: "bytes32" },
    { name: "taker", type: "address" },
    { name: "executor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

const layout = (fields: readonly { name: string; type: string }[]) => fields.map((entry) => `${entry.name}:${entry.type}`).join(",");

function walletAddress(wallet: Wallet, fallback: `0x${string}`): { account: Account | `0x${string}`; address: string } {
  const account = wallet.account ?? fallback;
  return { account, address: typeof account === "string" ? account : account.address };
}

async function checkDomain(
  wallet: Wallet,
  domain: { name: string; version: string; chainId: number },
  what: string,
): Promise<void> {
  if (domain.name !== "Setryn" || domain.version !== "1") throw new SetrynOrderError("SIGN", `The ${what} domain is not Setryn v1.`);
  const walletChainId = await wallet.getChainId();
  if (walletChainId !== domain.chainId) {
    throw new SetrynOrderError("SIGN", `Wallet is on chain ${walletChainId}; the ${what} is for chain ${domain.chainId}.`);
  }
}

/** Signs a prepared RFQ request after checking its fixed `PrivateRfqRequest` layout and that it binds the prepared order. */
export async function signPreparedRfqRequest(wallet: Wallet, prepared: PreparedRfq): Promise<Hex> {
  const { requestTypedData, request } = prepared;
  if (layout(requestTypedData.types.PrivateRfqRequest) !== layout(privateRfqRequestTypes.PrivateRfqRequest) || requestTypedData.primaryType !== "PrivateRfqRequest") {
    throw new SetrynOrderError("SIGN", "The prepared typed data does not match the Setryn PrivateRfqRequest layout.");
  }
  if (request.takerOrderHash.toLowerCase() !== prepared.orderHash.toLowerCase() || request.taker.toLowerCase() !== prepared.order.signer.toLowerCase()) {
    throw new SetrynOrderError("SIGN", "The prepared RFQ request is not bound to the prepared order.");
  }
  await checkDomain(wallet, requestTypedData.domain, "RFQ request");
  const { account, address } = walletAddress(wallet, request.taker);
  if (address.toLowerCase() !== request.taker.toLowerCase()) {
    throw new SetrynOrderError("SIGN", `Wallet account ${address} is not the RFQ requester ${request.taker}.`);
  }
  return wallet.signTypedData({
    account,
    domain: requestTypedData.domain,
    types: privateRfqRequestTypes,
    primaryType: "PrivateRfqRequest",
    message: toSignableRfqRequest(request),
  });
}

/** The request message with its wide integers as bigint, as EIP-712 signing expects. */
export function toSignableRfqRequest(request: SerializedRfqRequest) {
  return {
    ...request,
    lots: BigInt(request.lots),
    minimumFillLots: BigInt(request.minimumFillLots),
    maxFeeMinor: BigInt(request.maxFeeMinor),
    deadline: BigInt(request.deadline),
    nonce: BigInt(request.nonce),
  };
}

/** Signs a prepared quote selection after checking its fixed `RfqSelectionAuthorization` layout. */
export async function signPreparedRfqAcceptance(wallet: Wallet, prepared: PreparedRfqAcceptance): Promise<Hex> {
  const { typedData, selection } = prepared;
  if (layout(typedData.types.RfqSelectionAuthorization) !== layout(rfqSelectionTypes.RfqSelectionAuthorization) || typedData.primaryType !== "RfqSelectionAuthorization") {
    throw new SetrynOrderError("SIGN", "The prepared typed data does not match the Setryn RfqSelectionAuthorization layout.");
  }
  if (selection.rfqId.toLowerCase() !== prepared.rfqId.toLowerCase() || selection.quoteId.toLowerCase() !== prepared.quoteId.toLowerCase()) {
    throw new SetrynOrderError("SIGN", "The prepared selection names a different RFQ or quote.");
  }
  await checkDomain(wallet, typedData.domain, "quote selection");
  const { account, address } = walletAddress(wallet, selection.taker);
  if (address.toLowerCase() !== selection.taker.toLowerCase()) {
    throw new SetrynOrderError("SIGN", `Wallet account ${address} is not the RFQ requester ${selection.taker}.`);
  }
  return wallet.signTypedData({
    account,
    domain: typedData.domain,
    types: rfqSelectionTypes,
    primaryType: "RfqSelectionAuthorization",
    message: toSignableSelection(selection),
  });
}

export function toSignableSelection(selection: SerializedRfqSelection) {
  return { ...selection, nonce: BigInt(selection.nonce), deadline: BigInt(selection.deadline) };
}

/** Default quote choice: the best-priced live quote with reserved capacity at or inside the signed limit. */
export function bestAcceptableQuote(quotes: readonly RfqQuote[]): RfqQuote | null {
  return quotes.find((quote) => quote.withinLimit && quote.state === "RESERVED") ?? null;
}

export interface ExecuteRfqInput extends Omit<PrepareRfqInput, "signer"> {
  /** Defaults to the wallet's account. */
  signer?: PrepareRfqInput["signer"];
}

export interface ExecuteRfqOptions {
  /** Picks the quote to accept; return null to stop without accepting. Defaults to `bestAcceptableQuote`. */
  selectQuote?: (quotes: RfqQuote[], rfq: Rfq) => RfqQuote | null;
  onStep?: (transaction: TransactionRequest, hash: Hex) => void;
}

export interface ExecuteRfqResult {
  prepared: PreparedRfq;
  submitted: SubmitRfqResult;
  quotes: RfqQuote[];
  quote: RfqQuote;
  accepted: AcceptRfqQuoteResult;
  settlement: RfqSettlement;
  rfq: Rfq;
  transactionHashes: Hex[];
}

/**
 * Full non-custodial private RFQ from the requester's wallet, the way the Setryn terminal runs it:
 *
 *   prepare the taker order and request -> sign both -> relay to risk admission -> send bind, register, commit and open
 *   -> invite solver quotes -> sign the selection of the best acceptable quote -> send lock, confirm, authorize and
 *   submit -> hand off to the executor, which clears the fill atomically.
 *
 * The API never touches the private key and never sends a transaction for the requester.
 */
export async function executeRfq(
  client: SetrynClient,
  wallet: Wallet,
  publicClient: PublicClient,
  input: ExecuteRfqInput,
  options: ExecuteRfqOptions = {},
): Promise<ExecuteRfqResult> {
  const signer = input.signer ?? wallet.account?.address;
  if (!signer) throw new SetrynOrderError("SIGN", "Pass input.signer or use a wallet client with an account.");
  const prepared = await client.prepareRfq({ ...input, signer });
  // Lock operator approvals must land before risk admission is bound.
  const transactionHashes = await sendOrderTransactions(wallet, publicClient, prepared.requiredTransactions, options.onStep);
  const orderSignature = await signPublicOrder(wallet, prepared.orderTypedData, prepared.order);
  const requestSignature = await signPreparedRfqRequest(wallet, prepared);
  const submitted = await client.submitRfq({ order: prepared.order, orderSignature, request: prepared.request, requestSignature });
  transactionHashes.push(...(await sendOrderTransactions(wallet, publicClient, submitted.transactions, options.onStep)));

  const solicited = await client.solicitRfqQuotes(submitted.rfqId);
  const collecting = await client.getRfq(submitted.rfqId);
  const quote = (options.selectQuote ?? bestAcceptableQuote)(solicited.quotes, collecting);
  if (!quote) {
    throw new SetrynOrderError(
      "SELECT_QUOTE",
      `No acceptable quote on RFQ ${submitted.rfqId}. Cancel it with cancelRfq to release the reserved collateral.`,
    );
  }
  const acceptance = await client.prepareRfqAcceptance(submitted.rfqId, quote.quoteId);
  const signature = await signPreparedRfqAcceptance(wallet, acceptance);
  const accepted = await client.acceptRfqQuote(submitted.rfqId, { selection: acceptance.selection, signature });
  transactionHashes.push(...(await sendOrderTransactions(wallet, publicClient, accepted.transactions, options.onStep)));

  const settlement = await client.settleRfq(submitted.rfqId);
  const rfq = await client.getRfq(submitted.rfqId);
  return { prepared, submitted, quotes: solicited.quotes, quote, accepted, settlement, rfq, transactionHashes };
}

/** Cancels (or expires) an unselected RFQ from the requester's wallet and releases the taker order's reserved collateral. */
export async function cancelRfq(
  client: SetrynClient,
  wallet: Wallet,
  publicClient: PublicClient,
  rfqId: Hex,
): Promise<{ prepared: PreparedRfqCancel; transactionHashes: Hex[] }> {
  const prepared = await client.prepareRfqCancel(rfqId);
  const transactionHashes = await sendOrderTransactions(wallet, publicClient, prepared.transactions);
  if (prepared.riskRelease) transactionHashes.push(await sendRiskRelease(wallet, publicClient, prepared.riskRelease));
  return { prepared, transactionHashes };
}
