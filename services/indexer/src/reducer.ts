import {
  logId,
  parseAddress,
  parseBytes32,
  parseNonNegativeInteger,
  type CanonicalEvent,
  type JsonObject,
} from "@setryn/internal-schemas";

import type { ProjectionState } from "./projection-types.ts";

export function applyEvent(state: ProjectionState, event: CanonicalEvent): void {
  const eventId = logId(event.log);
  if (state.processedLogIds.has(eventId)) {
    return;
  }
  state.processedLogIds.add(eventId);

  if (event.name === "registry.version.registered") {
    const payload = event.payload;
    const key = registryVersionKey(
      event.log.block.chainId,
      payload.registry,
      payload.entityId,
      payload.version,
    );
    state.registryVersions.set(key, {
      chainId: event.log.block.chainId,
      registry: payload.registry,
      entityId: payload.entityId,
      version: payload.version,
      versionHash: payload.versionHash,
      definitionHash: payload.definitionHash,
      status: payload.initialStatus,
      definition: payload.definition,
      registeredBy: payload.operator,
      registeredAtBlock: event.log.block.number,
      updatedAtBlock: event.log.block.number,
    });
    return;
  }
  if (event.name === "registry.status.changed") {
    const payload = event.payload;
    const key = registryVersionKey(
      event.log.block.chainId,
      payload.registry,
      payload.entityId,
      payload.version,
    );
    const current = state.registryVersions.get(key);
    if (!current || current.status !== payload.previousStatus) {
      throw new Error(`Registry projection precondition failed for ${key}`);
    }
    state.registryVersions.set(key, {
      ...current,
      status: payload.newStatus,
      updatedAtBlock: event.log.block.number,
    });
    return;
  }
  if (event.name === "registry.active-version.changed") {
    const payload = event.payload;
    const key = registryHeadKey(event.log.block.chainId, payload.registry, payload.entityId);
    const current = state.registryHeads.get(key);
    if ((current?.activeVersion ?? 0) !== payload.previousVersion) {
      throw new Error(`Registry active pointer precondition failed for ${key}`);
    }
    state.registryHeads.set(key, {
      chainId: event.log.block.chainId,
      registry: payload.registry,
      entityId: payload.entityId,
      activeVersion: payload.newVersion,
      updatedAtBlock: event.log.block.number,
    });
    return;
  }
  if (event.name === "deployment.identity.observed") {
    const payload = event.payload;
    state.deployments.set(`${payload.chainId}:${payload.contractName}`, {
      ...payload,
      observedAtBlock: event.log.block.number,
    });
    return;
  }

  applyCollateralEvent(state, event.name, event.payload, event.log.block.chainId, event.log.block.number);
}

function applyCollateralEvent(
  state: ProjectionState,
  name: string,
  payload: JsonObject,
  chainId: number,
  blockNumber: bigint,
): void {
  if (name === "collateral.account.created") {
    const accountId = bytes32(payload, "accountId");
    if (state.accounts.has(`${chainId}:${accountId}`)) {
      throw new Error(`Duplicate account ${chainId}:${accountId}`);
    }
    state.accounts.set(`${chainId}:${accountId}`, {
      chainId,
      accountId,
      controller: address(payload, "controller"),
      pendingController: null,
      lockOperatorEpoch: 1,
      createdAtBlock: blockNumber,
      updatedAtBlock: blockNumber,
    });
    return;
  }
  if (name === "collateral.account.control-proposed") {
    updateAccount(state, chainId, bytes32(payload, "accountId"), blockNumber, (current) => ({
      ...requireMatchingController(current, address(payload, "controller")),
      pendingController: address(payload, "pendingController"),
    }));
    return;
  }
  if (name === "collateral.account.control-proposal-cancelled") {
    updateAccount(state, chainId, bytes32(payload, "accountId"), blockNumber, (current) => {
      requireMatchingController(current, address(payload, "controller"));
      const cancelled = address(payload, "cancelledController");
      if (current.pendingController !== cancelled) {
        throw new Error(`Account proposal precondition failed for ${current.accountId}`);
      }
      return { ...current, pendingController: null };
    });
    return;
  }
  if (name === "collateral.account.control-transferred") {
    const accountId = bytes32(payload, "accountId");
    const key = `${chainId}:${accountId}`;
    const current = state.accounts.get(key);
    if (!current) {
      throw new Error(`Unknown account ${key}`);
    }
    const previousController = address(payload, "previousController");
    const newController = address(payload, "newController");
    if (current.controller !== previousController || current.pendingController !== newController) {
      throw new Error(`Account transfer precondition failed for ${key}`);
    }
    const newLockOperatorEpoch = integer(payload, "newLockOperatorEpoch");
    if (newLockOperatorEpoch !== current.lockOperatorEpoch + 1) {
      throw new Error(`Account lock operator epoch progression failed for ${key}`);
    }
    state.accounts.set(key, {
      ...current,
      controller: newController,
      pendingController: null,
      lockOperatorEpoch: newLockOperatorEpoch,
      updatedAtBlock: blockNumber,
    });
    return;
  }
  if (name === "collateral.account.lock-operator-set") {
    const accountId = bytes32(payload, "accountId");
    const operator = address(payload, "operator");
    const account = requireAccount(state, chainId, accountId);
    const epoch = integer(payload, "epoch");
    if (account.lockOperatorEpoch !== epoch) {
      throw new Error(`Lock operator epoch precondition failed for ${chainId}:${accountId}`);
    }
    const controller = address(payload, "controller");
    if (account.controller !== controller) {
      throw new Error(`Lock operator controller precondition failed for ${chainId}:${accountId}`);
    }
    state.lockOperators.set(`${chainId}:${accountId}:${operator}`, {
      chainId,
      accountId,
      operator,
      approved: boolean(payload, "approved"),
      epoch,
      controller,
      updatedAtBlock: blockNumber,
    });
    return;
  }
  if (name === "collateral.deposited" || name === "collateral.withdrawn") {
    setBalance(state, chainId, bytes32(payload, "accountId"), bytes32(payload, "collateralId"), amount(payload, "newTotal"), blockNumber);
    return;
  }
  if (name === "collateral.transferred") {
    const collateralId = bytes32(payload, "collateralId");
    setBalance(state, chainId, bytes32(payload, "fromAccountId"), collateralId, amount(payload, "newFromTotal"), blockNumber);
    setBalance(state, chainId, bytes32(payload, "toAccountId"), collateralId, amount(payload, "newToTotal"), blockNumber);
    return;
  }
  if (name === "collateral.lock.created") {
    const lockId = bytes32(payload, "lockId");
    if (state.locks.has(`${chainId}:${lockId}`)) {
      throw new Error(`Duplicate collateral lock ${chainId}:${lockId}`);
    }
    const lockedAmount = amount(payload, "amount");
    state.locks.set(`${chainId}:${lockId}`, {
      chainId,
      lockId,
      accountId: bytes32(payload, "accountId"),
      collateralId: bytes32(payload, "collateralId"),
      amount: lockedAmount,
      remainingAmount: lockedAmount,
      status: "active",
      settlementOperator: address(payload, "settlementOperator"),
      updatedAtBlock: blockNumber,
    });
    adjustBalance(state, chainId, bytes32(payload, "accountId"), bytes32(payload, "collateralId"), blockNumber, {
      preTradeLocked: lockedAmount,
    });
    return;
  }
  if (name === "collateral.lock.released") {
    const releasedAmount = amount(payload, "releasedAmount");
    const lock = updateLock(state, chainId, payload, blockNumber, "0");
    adjustBalance(state, chainId, lock.accountId, lock.collateralId, blockNumber, {
      preTradeLocked: negate(releasedAmount),
    });
    return;
  }
  if (name === "collateral.lock.consumed") {
    const consumedAmount = amount(payload, "amount");
    const remainingAmount = amount(payload, "remainingAmount");
    const lock = updateLock(state, chainId, payload, blockNumber, remainingAmount);
    const payerAccountId = bytes32(payload, "payerAccountId");
    const recipientAccountId = bytes32(payload, "recipientAccountId");
    adjustBalance(state, chainId, payerAccountId, lock.collateralId, blockNumber, {
      total: negate(consumedAmount),
      preTradeLocked: negate(consumedAmount),
    });
    adjustBalance(state, chainId, recipientAccountId, lock.collateralId, blockNumber, { total: consumedAmount });
    return;
  }
  if (name === "collateral.lock.converted") {
    const convertedAmount = amount(payload, "convertedAmount");
    const remainingAmount = amount(payload, "remainingAmount");
    const lock = updateLock(state, chainId, payload, blockNumber, remainingAmount);
    adjustBalance(state, chainId, bytes32(payload, "payerAccountId"), lock.collateralId, blockNumber, {
      preTradeLocked: negate(convertedAmount),
      terminalReserved: convertedAmount,
    });
    return;
  }
  if (name === "collateral.terminal-reservation.created") {
    const reservationId = bytes32(payload, "reservationId");
    const reservationKey = `${chainId}:${reservationId}`;
    if (state.terminalReservations.has(reservationKey)) {
      throw new Error(`Duplicate terminal reservation ${reservationKey}`);
    }
    const payerAccountId = bytes32(payload, "payerAccountId");
    const collateralId = bytes32(payload, "collateralId");
    const sourceLockId = bytes32(payload, "sourceLockId");
    requireAccount(state, chainId, payerAccountId);
    if (sourceLockId !== `0x${"00".repeat(32)}`) {
      const sourceLock = state.locks.get(`${chainId}:${sourceLockId}`);
      if (!sourceLock || sourceLock.accountId !== payerAccountId || sourceLock.collateralId !== collateralId) {
        throw new Error(`Terminal reservation source lock mismatch for ${reservationKey}`);
      }
    }
    state.terminalReservations.set(reservationKey, {
      chainId,
      reservationId,
      positionId: bytes32(payload, "positionId"),
      payerAccountId,
      collateralId,
      amount: amount(payload, "amount"),
      terminalAmount: null,
      releasedAmount: null,
      terminalAccountId: null,
      terminalOutcomeReference: null,
      terminalOutcome: null,
      status: "active",
      creator: address(payload, "creator"),
      positionEngine: address(payload, "positionEngine"),
      sourceLockId,
      updatedAtBlock: blockNumber,
    });
    if (sourceLockId === `0x${"00".repeat(32)}`) {
      adjustBalance(state, chainId, payerAccountId, collateralId, blockNumber, {
        terminalReserved: amount(payload, "amount"),
      });
    }
    return;
  }
  if (name === "collateral.terminal-reservation.resolved") {
    const reservationId = bytes32(payload, "reservationId");
    const key = `${chainId}:${reservationId}`;
    const current = state.terminalReservations.get(key);
    if (!current) {
      throw new Error(`Unknown terminal reservation ${key}`);
    }
    const terminalAmount = amount(payload, "terminalAmount");
    const releasedAmount = amount(payload, "releasedAmount");
    if (add(terminalAmount, releasedAmount) !== current.amount) {
      throw new Error(`Terminal reservation accounting mismatch for ${key}`);
    }
    const terminalOutcome = terminalOutcomeValue(payload, "terminalOutcome");
    const status = terminalReservationStatus(payload, "newStatus");
    const terminalAccountId = bytes32(payload, "terminalAccountId");
    if (status === "releasedAtTerminal") {
      if ((terminalOutcome !== "noEffect" && terminalOutcome !== "flat") || terminalAmount !== "0") {
        throw new Error(`Released terminal reservation outcome mismatch for ${key}`);
      }
      adjustBalance(state, chainId, current.payerAccountId, current.collateralId, blockNumber, {
        terminalReserved: negate(current.amount),
      });
    } else if (status === "convertedToClaim") {
      if ((terminalOutcome !== "payout" && terminalOutcome !== "claim") || terminalAmount === "0") {
        throw new Error(`Terminal claim conversion outcome mismatch for ${key}`);
      }
      adjustBalance(state, chainId, current.payerAccountId, current.collateralId, blockNumber, {
        terminalReserved: negate(current.amount),
        terminalClaimBacking: terminalAmount,
      });
    } else {
      if (terminalOutcome !== "payout" || terminalAmount === "0") {
        throw new Error(`Settled terminal reservation outcome mismatch for ${key}`);
      }
      adjustBalance(state, chainId, current.payerAccountId, current.collateralId, blockNumber, {
        terminalReserved: negate(current.amount),
        total: negate(terminalAmount),
      });
      adjustBalance(state, chainId, terminalAccountId, current.collateralId, blockNumber, { total: terminalAmount });
    }
    state.terminalReservations.set(key, {
      ...current,
      terminalAmount,
      releasedAmount,
      terminalAccountId,
      terminalOutcomeReference: bytes32(payload, "terminalOutcomeReference"),
      terminalOutcome,
      status,
      updatedAtBlock: blockNumber,
    });
    return;
  }
  if (name === "collateral.terminal-claim.created") {
    const claimId = bytes32(payload, "claimId");
    const claimKey = `${chainId}:${claimId}`;
    if (state.terminalClaims.has(claimKey)) {
      throw new Error(`Duplicate terminal claim ${claimKey}`);
    }
    const reservationId = bytes32(payload, "reservationId");
    const reservation = state.terminalReservations.get(`${chainId}:${reservationId}`);
    if (!reservation || reservation.status !== "convertedToClaim") {
      throw new Error(`Terminal claim reservation precondition failed for ${claimKey}`);
    }
    const positionId = bytes32(payload, "positionId");
    const payerAccountId = bytes32(payload, "payerAccountId");
    const receiverAccountId = bytes32(payload, "receiverAccountId");
    const collateralId = bytes32(payload, "collateralId");
    const terminalOutcomeReference = bytes32(payload, "terminalOutcomeReference");
    const claimAmount = amount(payload, "amount");
    requireAccount(state, chainId, payerAccountId);
    requireAccount(state, chainId, receiverAccountId);
    if (
      reservation.positionId !== positionId ||
      reservation.payerAccountId !== payerAccountId ||
      reservation.terminalAccountId !== receiverAccountId ||
      reservation.collateralId !== collateralId ||
      reservation.terminalOutcomeReference !== terminalOutcomeReference ||
      reservation.terminalAmount !== claimAmount
    ) {
      throw new Error(`Terminal claim details mismatch for ${claimKey}`);
    }
    state.terminalClaims.set(claimKey, {
      chainId,
      claimId,
      reservationId,
      positionId,
      payerAccountId,
      receiverAccountId,
      collateralId,
      terminalOutcomeReference,
      amount: claimAmount,
      status: "active",
      updatedAtBlock: blockNumber,
    });
    return;
  }
  if (name === "collateral.terminal-claim.fulfilled") {
    const claimId = bytes32(payload, "claimId");
    const key = `${chainId}:${claimId}`;
    const current = state.terminalClaims.get(key);
    if (!current) {
      throw new Error(`Unknown terminal claim ${key}`);
    }
    if (
      bytes32(payload, "reservationId") !== current.reservationId ||
      bytes32(payload, "receiverAccountId") !== current.receiverAccountId ||
      bytes32(payload, "payerAccountId") !== current.payerAccountId ||
      bytes32(payload, "collateralId") !== current.collateralId
    ) {
      throw new Error(`Terminal claim fulfillment details mismatch for ${key}`);
    }
    const fulfilledAmount = amount(payload, "amount");
    if (fulfilledAmount !== current.amount) {
      throw new Error(`Terminal claim accounting mismatch for ${key}`);
    }
    adjustBalance(state, chainId, current.payerAccountId, current.collateralId, blockNumber, {
      total: negate(fulfilledAmount),
      terminalClaimBacking: negate(fulfilledAmount),
    });
    adjustBalance(state, chainId, current.receiverAccountId, current.collateralId, blockNumber, {
      total: fulfilledAmount,
    });
    state.terminalClaims.set(key, { ...current, status: "fulfilled", updatedAtBlock: blockNumber });
    return;
  }
  if (name === "collateral.excess-recovered") {
    const token = address(payload, "token");
    const key = `${chainId}:${token}`;
    const current = state.excessRecoveries.get(key);
    state.excessRecoveries.set(key, {
      chainId,
      token,
      assetId: bytes32(payload, "assetId"),
      bindingVersion: integer(payload, "bindingVersion"),
      totalRecovered: add(current?.totalRecovered ?? "0", amount(payload, "amount")),
      tokenLiability: amount(payload, "tokenLiability"),
      lastRecipient: address(payload, "recipient"),
      lastOperator: address(payload, "operator"),
      updatedAtBlock: blockNumber,
    });
    return;
  }
  throw new Error(`Unsupported collateral projection event ${name}`);
}

function updateLock(
  state: ProjectionState,
  chainId: number,
  payload: JsonObject,
  blockNumber: bigint,
  remainingAmount: string,
) {
  const lockId = bytes32(payload, "lockId");
  const key = `${chainId}:${lockId}`;
  const current = state.locks.get(key);
  if (!current) {
    throw new Error(`Unknown collateral lock ${key}`);
  }
  const eventAccountId = payload.accountId ?? payload.payerAccountId;
  if (eventAccountId === undefined || parseBytes32(eventAccountId, "accountId") !== current.accountId) {
    throw new Error(`Collateral lock account mismatch for ${key}`);
  }
  if (bytes32(payload, "collateralId") !== current.collateralId) {
    throw new Error(`Collateral lock binding mismatch for ${key}`);
  }
  const changedAmount = subtract(current.remainingAmount, remainingAmount);
  const eventAmount = payload.amount ?? payload.convertedAmount ?? payload.releasedAmount;
  if (eventAmount !== undefined && amount({ amount: eventAmount }, "amount") !== changedAmount) {
    throw new Error(`Collateral lock accounting mismatch for ${key}`);
  }
  state.locks.set(key, {
    ...current,
    remainingAmount,
    status: lockStatus(payload, "newStatus"),
    updatedAtBlock: blockNumber,
  });
  return current;
}

function setBalance(
  state: ProjectionState,
  chainId: number,
  accountId: `0x${string}`,
  collateralId: `0x${string}`,
  total: string,
  blockNumber: bigint,
): void {
  requireAccount(state, chainId, accountId);
  const key = `${chainId}:${accountId}:${collateralId}`;
  const current = state.balances.get(key);
  const next = {
    chainId,
    accountId,
    collateralId,
    total,
    preTradeLocked: current?.preTradeLocked ?? "0",
    terminalReserved: current?.terminalReserved ?? "0",
    terminalClaimBacking: current?.terminalClaimBacking ?? "0",
    updatedAtBlock: blockNumber,
  };
  assertBalanceInvariant(next);
  state.balances.set(key, next);
}

interface BalanceDeltas {
  readonly total?: string;
  readonly preTradeLocked?: string;
  readonly terminalReserved?: string;
  readonly terminalClaimBacking?: string;
}

function adjustBalance(
  state: ProjectionState,
  chainId: number,
  accountId: `0x${string}`,
  collateralId: `0x${string}`,
  blockNumber: bigint,
  deltas: BalanceDeltas,
): void {
  requireAccount(state, chainId, accountId);
  const key = `${chainId}:${accountId}:${collateralId}`;
  const current = state.balances.get(key) ?? {
    chainId,
    accountId,
    collateralId,
    total: "0",
    preTradeLocked: "0",
    terminalReserved: "0",
    terminalClaimBacking: "0",
    updatedAtBlock: blockNumber,
  };
  const next = {
    ...current,
    total: applyDelta(current.total, deltas.total),
    preTradeLocked: applyDelta(current.preTradeLocked, deltas.preTradeLocked),
    terminalReserved: applyDelta(current.terminalReserved, deltas.terminalReserved),
    terminalClaimBacking: applyDelta(current.terminalClaimBacking, deltas.terminalClaimBacking),
    updatedAtBlock: blockNumber,
  };
  assertBalanceInvariant(next);
  state.balances.set(key, next);
}

function assertBalanceInvariant(balance: {
  total: string;
  preTradeLocked: string;
  terminalReserved: string;
  terminalClaimBacking: string;
}): void {
  const encumbered = BigInt(balance.preTradeLocked) + BigInt(balance.terminalReserved) + BigInt(balance.terminalClaimBacking);
  if (encumbered > BigInt(balance.total)) {
    throw new Error(`Collateral projection encumbrance ${encumbered} exceeds total ${balance.total}`);
  }
}

function updateAccount(
  state: ProjectionState,
  chainId: number,
  accountId: `0x${string}`,
  blockNumber: bigint,
  update: (current: ReturnType<typeof requireAccount>) => ReturnType<typeof requireAccount>,
): void {
  const key = `${chainId}:${accountId}`;
  const current = requireAccount(state, chainId, accountId);
  state.accounts.set(key, { ...update(current), updatedAtBlock: blockNumber });
}

function requireAccount(state: ProjectionState, chainId: number, accountId: `0x${string}`) {
  const key = `${chainId}:${accountId}`;
  const current = state.accounts.get(key);
  if (!current) {
    throw new Error(`Unknown account ${key}`);
  }
  return current;
}

function requireMatchingController<T extends { readonly accountId: `0x${string}`; readonly controller: `0x${string}` }>(
  account: T,
  controller: `0x${string}`,
): T {
  if (account.controller !== controller) {
    throw new Error(`Account controller precondition failed for ${account.accountId}`);
  }
  return account;
}

function applyDelta(current: string, delta: string | undefined): string {
  if (delta === undefined) {
    return current;
  }
  const next = BigInt(current) + BigInt(delta);
  if (next < 0n) {
    throw new Error(`Collateral projection underflow: ${current} + ${delta}`);
  }
  return next.toString();
}

function add(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

function subtract(left: string, right: string): string {
  const difference = BigInt(left) - BigInt(right);
  if (difference < 0n) {
    throw new Error(`Collateral projection underflow: ${left} - ${right}`);
  }
  return difference.toString();
}

function negate(value: string): string {
  return value === "0" ? "0" : `-${value}`;
}

function boolean(payload: JsonObject, key: string): boolean {
  const value = payload[key];
  if (typeof value !== "boolean") {
    throw new TypeError(`${key} must be a boolean`);
  }
  return value;
}

function canonicalEnum(payload: JsonObject, key: string, values: readonly string[]): string {
  const value = string(payload, key);
  if (!values.includes(value)) {
    throw new TypeError(`${key} is unsupported`);
  }
  return value;
}

function lockStatus(payload: JsonObject, key: string): string {
  return canonicalEnum(payload, key, ["active", "released", "consumed", "expired"]);
}

function terminalOutcomeValue(payload: JsonObject, key: string): string {
  return canonicalEnum(payload, key, ["payout", "noEffect", "flat", "claim"]);
}

function terminalReservationStatus(payload: JsonObject, key: string): string {
  return canonicalEnum(payload, key, ["settled", "releasedAtTerminal", "convertedToClaim"]);
}

function registryVersionKey(chainId: number, registry: string, entityId: string, version: number): string {
  return `${chainId}:${registry}:${entityId}:${version}`;
}

function registryHeadKey(chainId: number, registry: string, entityId: string): string {
  return `${chainId}:${registry}:${entityId}`;
}

function bytes32(payload: JsonObject, key: string) {
  return parseBytes32(payload[key], key);
}

function address(payload: JsonObject, key: string) {
  return parseAddress(payload[key], key);
}

function integer(payload: JsonObject, key: string): number {
  return parseNonNegativeInteger(payload[key], key);
}

function amount(payload: JsonObject, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${key} must be a canonical unsigned decimal string`);
  }
  return value;
}

function string(payload: JsonObject, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${key} must be a non-empty string`);
  }
  return value;
}
