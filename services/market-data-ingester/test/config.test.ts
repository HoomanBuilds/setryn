import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments, resolveIngestConfig } from "../src/config.ts";

test("the ingester only reads: it has no Arbitrum One deployment and needs https for Sepolia", () => {
  assert.throws(() => resolveIngestConfig(parseArguments(["--environment", "arbitrum-one"]), {}), /no Setryn deployment/);
  assert.throws(() => resolveIngestConfig(parseArguments(["--environment", "arbitrum-sepolia"]), {}), /SETRYN_RPC_URL is required/);
  assert.throws(
    () => resolveIngestConfig(parseArguments(["--environment", "arbitrum-sepolia"]), { SETRYN_RPC_URL: "http://rpc.example" }),
    /https/,
  );
  assert.throws(() => resolveIngestConfig(parseArguments([]), { LOCAL_RPC_URL: "http://10.0.0.5:8545" }), /loopback/);
});

test("defaults: the network scope, confirmations behind the head, and a 30-day backfill", () => {
  const local = resolveIngestConfig(parseArguments(["--once"]), {});
  assert.equal(local.scope, "local");
  assert.equal(local.confirmations, 0);
  assert.equal(local.backfillDays, 30);
  const sepolia = resolveIngestConfig(parseArguments(["--environment", "arbitrum-sepolia", "--backfill-days", "180"]), {
    SETRYN_RPC_URL: "https://sepolia.example",
  });
  assert.equal(sepolia.scope, "arbitrum-sepolia");
  assert.equal(sepolia.chainId, 421614);
  assert.equal(sepolia.confirmations, 3);
  assert.equal(sepolia.backfillDays, 180);
  assert.match(sepolia.runtimePath, /deployments\/arbitrum-sepolia\/runtime\.json$/);
});
