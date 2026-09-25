import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDecodedLog } from "../src/normalizer.ts";

const hash = `0x${"11".repeat(32)}` as const;
const parentHash = `0x${"00".repeat(32)}` as const;
const vault = `0x${"22".repeat(20)}` as const;

const vaultEvents = [
  "AccountCreated",
  "AccountControlProposed",
  "AccountControlProposalCancelled",
  "AccountControlTransferred",
  "LockOperatorSet",
  "CollateralDeposited",
  "CollateralWithdrawn",
  "CollateralTransferred",
  "CollateralLockCreated",
  "CollateralLockReleased",
  "CollateralLockConsumed",
  "CollateralLockConverted",
  "TerminalLiabilityReservationCreated",
  "TerminalLiabilityReservationResolved",
  "TerminalClaimCreated",
  "TerminalClaimFulfilled",
  "ExcessRecovered",
] as const;

test("normalizer recognizes every CollateralVault event", () => {
  vaultEvents.forEach((eventName, logIndex) => {
    const args: Record<string, unknown> = {};
    if (eventName.startsWith("CollateralLock") && eventName !== "CollateralLockCreated") {
      args.newStatus = 1n;
    }
    if (eventName === "TerminalLiabilityReservationResolved") {
      args.terminalOutcome = 4n;
      args.newStatus = 4n;
    }
    const normalized = normalizeDecodedLog({
      contractName: "CollateralVault",
      eventName,
      args,
      log: {
        block: { chainId: 31337, number: 1n, hash, parentHash, timestamp: 1n },
        transactionHash: hash,
        transactionIndex: 0,
        logIndex,
        contractAddress: vault,
      },
    });
    assert.ok(normalized, eventName);
  });
});

test("normalizer emits canonical terminal enum values", () => {
  const normalized = normalizeDecodedLog({
    contractName: "CollateralVault",
    eventName: "TerminalLiabilityReservationResolved",
    args: { terminalOutcome: 4n, newStatus: 4n },
    log: {
      block: { chainId: 31337, number: 1n, hash, parentHash, timestamp: 1n },
      transactionHash: hash,
      transactionIndex: 0,
      logIndex: 0,
      contractAddress: vault,
    },
  });

  assert.equal(normalized?.name, "collateral.terminal-reservation.resolved");
  if (normalized?.name !== "collateral.terminal-reservation.resolved") {
    assert.fail("terminal resolution did not normalize as a collateral event");
  }
  assert.equal(normalized.payload.terminalOutcome, "claim");
  assert.equal(normalized.payload.newStatus, "convertedToClaim");
});

test("normalizer rejects unknown enum ordinals", () => {
  assert.throws(() =>
    normalizeDecodedLog({
      contractName: "CollateralVault",
      eventName: "CollateralLockReleased",
      args: { newStatus: 99n },
      log: {
        block: { chainId: 31337, number: 1n, hash, parentHash, timestamp: 1n },
        transactionHash: hash,
        transactionIndex: 0,
        logIndex: 0,
        contractAddress: vault,
      },
    }),
  );
});
