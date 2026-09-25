import assert from "node:assert/strict";
import test from "node:test";

import { parseCanonicalBlock } from "@setryn/internal-schemas";

import { SetrynProjector } from "../src/projector.ts";
import { InMemoryProjectionStore } from "../src/store.ts";

const zero = `0x${"00".repeat(32)}`;
const blockOneHash = `0x${"01".repeat(32)}`;
const orphanHash = `0x${"02".repeat(32)}`;
const canonicalHash = `0x${"03".repeat(32)}`;
const accountId = `0x${"aa".repeat(32)}`;
const collateralId = `0x${"cc".repeat(32)}`;
const controller = `0x${"22".repeat(20)}`;
const vault = `0x${"11".repeat(20)}`;

test("reorg rollback removes orphaned projection writes", () => {
  const store = new InMemoryProjectionStore();
  const projector = new SetrynProjector(store);
  projector.ingest(block(1, blockOneHash, zero, [event("collateral.account.created", blockOneHash, zero, 1, 0, { accountId, controller })]));
  projector.ingest(block(2, orphanHash, blockOneHash, [event("collateral.deposited", orphanHash, blockOneHash, 2, 0, { accountId, collateralId, newTotal: "10" })]));

  assert.equal(store.state().balances.size, 1);
  projector.ingest(block(2, canonicalHash, blockOneHash, []));

  assert.equal(store.head()?.hash, canonicalHash);
  assert.equal(store.state().balances.size, 0);
  assert.equal(store.state().accounts.size, 1);
  assert.equal(store.state().accounts.get(`31337:${accountId}`)?.lockOperatorEpoch, 1);
});

test("failed block projection is transactional", () => {
  const store = new InMemoryProjectionStore();
  const projector = new SetrynProjector(store);
  projector.ingest(block(1, blockOneHash, zero, [event("collateral.account.created", blockOneHash, zero, 1, 0, { accountId, controller })]));

  const invalidBlock = block(2, orphanHash, blockOneHash, [
    event("collateral.deposited", orphanHash, blockOneHash, 2, 0, { accountId, collateralId, newTotal: "10" }),
    event("collateral.lock.consumed", orphanHash, blockOneHash, 2, 1, {
      lockId: `0x${"dd".repeat(32)}`,
      payerAccountId: accountId,
      recipientAccountId: `0x${"bb".repeat(32)}`,
      collateralId,
      amount: "1",
      remainingAmount: "0",
      newStatus: "consumed",
    }),
  ]);

  assert.throws(() => projector.ingest(invalidBlock), /Unknown collateral lock/);
  assert.equal(store.head()?.hash, blockOneHash);
  assert.equal(store.state().balances.size, 0);
});

test("duplicate logs inside a block are idempotent", () => {
  const store = new InMemoryProjectionStore();
  const projector = new SetrynProjector(store);
  const created = event("collateral.account.created", blockOneHash, zero, 1, 0, { accountId, controller });

  projector.ingest(block(1, blockOneHash, zero, [created, created]));

  assert.equal(store.state().accounts.size, 1);
  assert.equal(store.state().processedLogIds.size, 1);
});

test("duplicate blocks are idempotent", () => {
  const store = new InMemoryProjectionStore();
  const projector = new SetrynProjector(store);
  const first = block(1, blockOneHash, zero, []);
  assert.equal(projector.ingest(first), "applied");
  assert.equal(projector.ingest(first), "duplicate");
});

test("protocol projections rollback with their block", () => {
  const store = new InMemoryProjectionStore();
  const projector = new SetrynProjector(store);
  projector.ingest(block(1, blockOneHash, zero, []));
  const actionId = `0x${"ab".repeat(32)}`;
  projector.ingest(block(2, orphanHash, blockOneHash, [
    event("protocol.transition", orphanHash, blockOneHash, 2, 0, {
      domain: "asyncAdapters",
      eventName: "ExternalActionAdvanced",
      subjectId: actionId,
      payload: { previousState: "submitted", newState: "included" },
    }),
  ]));

  assert.equal(store.state().protocolSubjects.size, 1);
  projector.ingest(block(2, canonicalHash, blockOneHash, []));
  assert.equal(store.state().protocolSubjects.size, 0);
  assert.equal(store.state().protocolTransitions.size, 0);
});

function block(number: number, hash: string, parentHash: string, events: unknown[]) {
  return parseCanonicalBlock({ chainId: 31337, number, hash, parentHash, timestamp: number, events });
}

function event(
  name: string,
  blockHash: string,
  parentHash: string,
  blockNumber: number,
  logIndex: number,
  payload: Record<string, unknown>,
) {
  return {
    name,
    contractName: "CollateralVault",
    log: {
      block: { chainId: 31337, number: blockNumber, hash: blockHash, parentHash, timestamp: blockNumber },
      transactionHash: `0x${(BigInt(blockNumber) * 1_000n + BigInt(logIndex + 1)).toString(16).padStart(64, "0")}`,
      transactionIndex: 0,
      logIndex,
      contractAddress: vault,
    },
    payload,
  };
}
