import { maxUint256, type Hex } from "viem";

import { transactionSummary, type OperatorChainClient, type OperatorTransaction } from "./chain.ts";
import { OperatorExecutionError, isContractRevert } from "./errors.ts";
import {
  abis,
  accountSalt,
  devnetSettlementTokenAbi,
  orderRiskWitness,
  orderStatus,
  publicOrderTypes,
  riskAdmissionCancellationTypes,
  setrynDomain,
  deterministicWord,
  zeroId,
  type OrderSide,
  type PublicOrder,
} from "./protocol.ts";

export interface TradingAccount {
  readonly accountId: Hex;
  readonly created: boolean;
  readonly transactions: readonly OperatorTransaction[];
}

/**
 * Makes the signer's primary vault account usable for clearing: it exists, and the clearing and position engines are
 * approved lock operators. Funding is only minted when a devnet faucet amount is configured.
 */
export async function ensureTradingAccount(
  client: OperatorChainClient,
  options: { readonly fundingMinor: bigint | null },
): Promise<TradingAccount> {
  const { deployment } = client;
  const vault = deployment.addresses.collateralVault;
  const transactions: OperatorTransaction[] = [];
  const accountId = await client.read("derive account", (reader) =>
    reader.readContract({ address: vault, abi: abis.collateralVault, functionName: "deriveAccountId", args: [client.address, accountSalt] }),
  );
  const exists = await client.read("read account", (reader) =>
    reader.readContract({ address: vault, abi: abis.collateralVault, functionName: "accountExists", args: [accountId] }),
  );
  if (!exists) {
    if (options.fundingMinor === null) {
      throw new OperatorExecutionError("precondition", `vault account ${accountId} for ${client.address} is not provisioned`);
    }
    transactions.push(transactionSummary(await client.write("create vault account", {
      address: vault,
      abi: abis.collateralVault,
      functionName: "createAccount",
      args: [accountSalt],
    })));
    if (options.fundingMinor > 0n) {
      transactions.push(...await fundAccount(client, accountId, options.fundingMinor));
    }
  }
  for (const operator of [deployment.addresses.atomicClearingEngine, deployment.addresses.positionEngine]) {
    const approved = await client.read("read lock operator", (reader) =>
      reader.readContract({ address: vault, abi: abis.collateralVault, functionName: "isLockOperator", args: [accountId, operator] }),
    );
    if (approved) continue;
    transactions.push(transactionSummary(await client.write("approve lock operator", {
      address: vault,
      abi: abis.collateralVault,
      functionName: "setLockOperator",
      args: [accountId, operator, true],
    })));
  }
  return { accountId, created: !exists, transactions };
}

/** Devnet faucet funding: mint the settlement token, approve the vault, and deposit into the account. */
export async function fundAccount(client: OperatorChainClient, accountId: Hex, amountMinor: bigint): Promise<OperatorTransaction[]> {
  if (client.environment !== "local") {
    throw new OperatorExecutionError("policy-refused", "faucet minting is only available on the local devnet");
  }
  const { deployment } = client;
  const transactions: OperatorTransaction[] = [];
  transactions.push(transactionSummary(await client.write("mint devnet settlement token", {
    address: deployment.addresses.settlementToken,
    abi: devnetSettlementTokenAbi,
    functionName: "mint",
    args: [amountMinor],
  })));
  const allowance = await client.read("read allowance", (reader) =>
    reader.readContract({
      address: deployment.addresses.settlementToken,
      abi: devnetSettlementTokenAbi,
      functionName: "allowance",
      args: [client.address, deployment.addresses.collateralVault],
    }),
  );
  if (allowance < amountMinor) {
    transactions.push(transactionSummary(await client.write("approve vault", {
      address: deployment.addresses.settlementToken,
      abi: devnetSettlementTokenAbi,
      functionName: "approve",
      args: [deployment.addresses.collateralVault, maxUint256],
    })));
  }
  transactions.push(transactionSummary(await client.write("deposit collateral", {
    address: deployment.addresses.collateralVault,
    abi: abis.collateralVault,
    functionName: "deposit",
    args: [deployment.ids.settlementAssetId, 1, accountId, amountMinor],
  })));
  return transactions;
}

export async function hashOrder(client: OperatorChainClient, order: PublicOrder): Promise<Hex> {
  return client.read("hash order", (reader) =>
    reader.readContract({ address: client.deployment.addresses.orderState, abi: abis.orderState, functionName: "hashOrder", args: [order] }),
  );
}

export async function signOrder(client: OperatorChainClient, order: PublicOrder): Promise<Hex> {
  return client.signTypedData("sign public order", {
    domain: setrynDomain(client.deployment, client.deployment.addresses.orderState),
    types: publicOrderTypes,
    primaryType: "PublicOrder",
    message: order,
  });
}

/**
 * Reserves portfolio risk for an order through the operator's risk-consumer role. Idempotent: an admission that is
 * already reserved for this exact witness is reused instead of reserved twice.
 */
export async function reserveOrderRisk(
  operator: OperatorChainClient,
  order: PublicOrder,
  orderHash: Hex,
): Promise<{ readonly admissionId: Hex; readonly transaction: OperatorTransaction | null }> {
  const now = await operator.chainNow();
  if (order.deadline <= now || order.deadline > now + 300n) {
    throw new OperatorExecutionError("precondition", `order deadline ${order.deadline} is outside the live risk window at chain time ${now}`);
  }
  const witness = orderRiskWitness(operator.deployment, order, orderHash, now);
  const result = await operator.write("reserve order risk", {
    address: operator.deployment.addresses.portfolioRiskEngine,
    abi: abis.portfolioRiskEngine,
    functionName: "reserveNewRisk",
    args: [witness.request, witness.positions, witness.observations],
  });
  return { admissionId: witness.admissionId, transaction: transactionSummary(result) };
}

/** Walks resting orders on one side of a book from the best level, bounded so a deep book cannot stall a worker. */
export async function readBookSide(
  client: OperatorChainClient,
  bookId: Hex,
  side: OrderSide,
  maximumOrders = 64,
): Promise<{ readonly orderHash: Hex; readonly priceTicks: bigint; readonly remainingLots: bigint; readonly signer: Hex; readonly deadline: bigint; readonly status: number }[]> {
  const { deployment } = client;
  const book = deployment.addresses.publicOrderBook;
  let levelId = await client.read("read best level", (reader) =>
    reader.readContract({ address: book, abi: abis.publicOrderBook, functionName: "bestLevel", args: [bookId, side] }),
  ).catch((error: unknown) => {
    if (isContractRevert(error)) return zeroId;
    throw error;
  });
  const orders: { orderHash: Hex; priceTicks: bigint; remainingLots: bigint; signer: Hex; deadline: bigint; status: number }[] = [];
  while (levelId !== zeroId && orders.length < maximumOrders) {
    const level = await client.read("read price level", (reader) =>
      reader.readContract({ address: book, abi: abis.publicOrderBook, functionName: "getPriceLevel", args: [levelId] }),
    );
    let orderHash = level.headOrderHash;
    while (orderHash !== zeroId && orders.length < maximumOrders) {
      const [bookOrder, record] = await Promise.all([
        client.read("read book order", (reader) =>
          reader.readContract({ address: book, abi: abis.publicOrderBook, functionName: "getBookOrder", args: [orderHash] }),
        ),
        client.read("read order", (reader) =>
          reader.readContract({ address: deployment.addresses.orderState, abi: abis.orderState, functionName: "getOrder", args: [orderHash] }),
        ),
      ]);
      orders.push({
        orderHash,
        priceTicks: bookOrder.priceTicks,
        remainingLots: bookOrder.remainingLots,
        signer: record.order.signer,
        deadline: record.order.deadline,
        status: record.status,
      });
      orderHash = bookOrder.nextOrderHash;
    }
    levelId = level.nextLevelId;
  }
  return orders;
}

/** Level-list neighbours for a new price, as PublicOrderBook.placeSeriesOrder requires when opening a level. */
export async function levelHint(client: OperatorChainClient, bookId: Hex, side: OrderSide, priceTicks: bigint) {
  const book = client.deployment.addresses.publicOrderBook;
  let current = await client.read("read best level", (reader) =>
    reader.readContract({ address: book, abi: abis.publicOrderBook, functionName: "bestLevel", args: [bookId, side] }),
  ).catch((error: unknown) => {
    if (isContractRevert(error)) return zeroId;
    throw error;
  });
  let previous = zeroId;
  for (let depth = 0; depth < 256 && current !== zeroId; depth += 1) {
    const level = await client.read("read price level", (reader) =>
      reader.readContract({ address: book, abi: abis.publicOrderBook, functionName: "getPriceLevel", args: [current] }),
    );
    if (level.priceTicks === priceTicks) return { previousLevelId: zeroId, nextLevelId: zeroId };
    const currentFirst = side === 1 ? level.priceTicks > priceTicks : level.priceTicks < priceTicks;
    if (!currentFirst) return { previousLevelId: previous, nextLevelId: current };
    previous = current;
    current = level.nextLevelId;
  }
  if (current !== zeroId) throw new OperatorExecutionError("precondition", "order book is deeper than the level-hint search bound");
  return { previousLevelId: previous, nextLevelId: zeroId };
}

export function isLiveOrderStatus(status: number): boolean {
  return status === orderStatus.open || status === orderStatus.partiallyFilled;
}

/**
 * Withdraws one of the signer's own resting orders: cancel in OrderState, drop it from the book, and hand its bound
 * risk admission back so the reservation does not linger until expiry.
 */
export async function withdrawOwnOrder(client: OperatorChainClient, orderHash: Hex, label: string): Promise<OperatorTransaction[]> {
  const { deployment } = client;
  const transactions: OperatorTransaction[] = [];
  const record = await client.read("read order", (reader) =>
    reader.readContract({ address: deployment.addresses.orderState, abi: abis.orderState, functionName: "getOrder", args: [orderHash] }),
  );
  if (record.order.signer !== client.address) {
    throw new OperatorExecutionError("precondition", `order ${orderHash} is not signed by ${client.address}`);
  }
  if (isLiveOrderStatus(record.status)) {
    transactions.push(transactionSummary(await client.write(`${label}: cancel order`, {
      address: deployment.addresses.orderState,
      abi: abis.orderState,
      functionName: "cancelOrder",
      args: [orderHash],
    })));
  }
  const bookOrder = await client.read("read book order", (reader) =>
    reader.readContract({ address: deployment.addresses.publicOrderBook, abi: abis.publicOrderBook, functionName: "getBookOrder", args: [orderHash] }),
  ).catch((error: unknown) => {
    if (isContractRevert(error)) return null;
    throw error;
  });
  if (bookOrder && bookOrder.status === 1) {
    transactions.push(transactionSummary(await client.write(`${label}: remove from book`, {
      address: deployment.addresses.publicOrderBook,
      abi: abis.publicOrderBook,
      functionName: "syncOrder",
      args: [orderHash],
    })));
  }
  const released = await releaseBoundAdmission(client, orderHash, record.order.accountId, label);
  if (released) transactions.push(released);
  return transactions;
}

async function releaseBoundAdmission(
  client: OperatorChainClient,
  orderHash: Hex,
  accountId: Hex,
  label: string,
): Promise<OperatorTransaction | null> {
  const { deployment } = client;
  const admissionId = await client.read("read risk binding", (reader) =>
    reader.readContract({
      address: deployment.addresses.riskAdmissionBindingRegistry,
      abi: abis.riskAdmissionBindingRegistry,
      functionName: "admissionForOrder",
      args: [orderHash],
    }),
  );
  if (admissionId === zeroId) return null;
  const admission = await client.read("read admission", (reader) =>
    reader.readContract({ address: deployment.addresses.portfolioRiskEngine, abi: abis.portfolioRiskEngine, functionName: "getAdmission", args: [admissionId] }),
  );
  if (admission.status !== 1) return null;
  const now = await client.chainNow();
  if (admission.deadline < now) {
    return transactionSummary(await client.write(`${label}: expire risk admission`, {
      address: deployment.addresses.portfolioRiskEngine,
      abi: abis.portfolioRiskEngine,
      functionName: "expireAdmission",
      args: [admissionId],
    }));
  }
  const nonce = deterministicWord(`${orderHash}:${admissionId}:risk-cancellation`);
  const cancellation = {
    admissionId,
    orderHash,
    accountId,
    signer: client.address,
    nonce,
    deadline: now + 120n,
    cancellationReference: `0x${nonce.toString(16).padStart(64, "0")}` as Hex,
  } as const;
  const signature = await client.signTypedData(`${label}: sign risk cancellation`, {
    domain: setrynDomain(deployment, deployment.addresses.riskAdmissionBindingRegistry),
    types: riskAdmissionCancellationTypes,
    primaryType: "SetrynRiskAdmissionCancellationV1",
    message: cancellation,
  });
  return transactionSummary(await client.write(`${label}: release risk admission`, {
    address: deployment.addresses.riskAdmissionBindingRegistry,
    abi: abis.riskAdmissionBindingRegistry,
    functionName: "cancelBoundAdmission",
    args: [cancellation, signature],
  }));
}
