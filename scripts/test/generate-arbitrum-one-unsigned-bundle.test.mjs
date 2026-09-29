import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_RPC_METHODS,
  EXPECTED_CHAIN_ID,
  ARBITRUM_NODE_INTERFACE,
  assertAllowedMethod,
  encodeGasEstimateL1Component,
  assertExplicitRpcUrl,
  buildBundle,
  canonicalJson,
  codeHashForHex,
  createFixtureTransport,
  sha256HexOfString,
} from "../lib/unsigned-bundle.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");
const intentFixture = JSON.parse(readFileSync(resolve(repoRoot, "scripts/fixtures/arbitrum-one-unsigned-bundle-intent.json"), "utf8"));
const rpcFixture = JSON.parse(readFileSync(resolve(repoRoot, "scripts/fixtures/arbitrum-one-unsigned-bundle-rpc.json"), "utf8"));

const FROM = "0x1111111111111111111111111111111111111111";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const PINNED_BLOCK = 200_000_000;
const FIXED_TIME_A = "2026-09-29T00:00:00.000Z";
const FIXED_TIME_B = "2026-09-29T00:00:01.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureTransportWith(overrides = {}) {
  return createFixtureTransport({ ...clone(rpcFixture), ...overrides });
}

function baseIntent() {
  return clone(intentFixture);
}

async function buildSuccess(intent = baseIntent(), fixtureOverrides = {}, timestamp = FIXED_TIME_A) {
  const transport = fixtureTransportWith(fixtureOverrides);
  return buildBundle({
    intent,
    intentRawText: JSON.stringify(intent),
    from: FROM,
    pinnedBlockNumber: PINNED_BLOCK,
    expectedChainId: EXPECTED_CHAIN_ID,
    transport,
    timestamp,
  });
}

describe("deterministic canonicalization", () => {
  it("produces the same bundle hash for reordered keys and reordered operation input", async () => {
    const intentA = baseIntent();
    // Shuffle top-level key order and operation array order (orders stay canonical).
    const intentB = {
      version: intentA.version,
      protocol: intentA.protocol,
      operations: [intentA.operations[2], intentA.operations[0], intentA.operations[1]],
      deployer: intentA.deployer,
      dependencies: intentA.dependencies,
      chainId: intentA.chainId,
    };
    const bundleA = await buildSuccess(intentA);
    const bundleB = await buildSuccess(intentB);
    assert.equal(bundleA.sourceIntentHash, bundleB.sourceIntentHash);
    assert.equal(bundleA.bundleHash, bundleB.bundleHash);
    assert.deepEqual(
      bundleA.transactions.map((tx) => tx.id),
      ["AssetRegistry", "AdapterRegistry", "usdc-approve-probe"],
    );
    assert.deepEqual(
      bundleB.transactions.map((tx) => tx.id),
      ["AssetRegistry", "AdapterRegistry", "usdc-approve-probe"],
    );
  });

  it("separates generated timestamp from the deterministic bundle hash", async () => {
    const bundleA = await buildSuccess(baseIntent(), {}, FIXED_TIME_A);
    const bundleB = await buildSuccess(baseIntent(), {}, FIXED_TIME_B);
    assert.equal(bundleA.bundleHash, bundleB.bundleHash);
    assert.notEqual(bundleA.generatedAt, bundleB.generatedAt);
    // Recompute the hash without generatedAt/bundleHash to prove separation.
    const { generatedAt: _a, bundleHash: _b, ...deterministic } = bundleA;
    assert.equal(sha256HexOfString(canonicalJson(deterministic)), bundleA.bundleHash);
  });
});

describe("two-times reserve math", () => {
  it("computes per-operation maxima, aggregate requirement, and a 2x reserve", async () => {
    const bundle = await buildSuccess();
    const maxFee = BigInt(bundle.feeEvidence.maxFeePerGas);
    assert.ok(maxFee > 0n);
    let aggregate = 0n;
    for (const tx of bundle.transactions) {
      const expected = BigInt(tx.gas) * maxFee + BigInt(tx.value);
      assert.equal(BigInt(tx.maxCostWei), expected);
      aggregate += expected;
    }
    assert.equal(BigInt(bundle.gasBudget.aggregateRequirementWei), aggregate);
    assert.equal(BigInt(bundle.gasBudget.reserveRequirementWei), aggregate * 2n);
    assert.equal(bundle.gasBudget.reserveMultiplier, 2);
    // Fee derivation: maxFee = 2*base + priority (100 gwei base, 1 gwei priority).
    assert.equal(bundle.feeEvidence.baseFeePerGas, "0x174876e800");
    assert.equal(bundle.feeEvidence.maxPriorityFeePerGas, "0x3b9aca00");
    assert.equal(bundle.feeEvidence.maxFeePerGas, "0x2ecc889a00");
  });
});

describe("rejection paths", () => {
  it("rejects private keys", async () => {
    const intent = baseIntent();
    intent.privateKey = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    await assert.rejects(() => buildSuccess(intent), /private keys are rejected/);
  });

  it("rejects signed-transaction flags", async () => {
    const intent = baseIntent();
    intent.signed = true;
    await assert.rejects(() => buildSuccess(intent), /signed transactions/);
  });

  it("rejects nonempty signatures on operations", async () => {
    const intent = baseIntent();
    intent.operations[0].signature = "0xdeadbeef";
    await assert.rejects(() => buildSuccess(intent), /nonempty signatures/);
  });

  it("rejects v/r/s signature fields", async () => {
    const intent = baseIntent();
    intent.operations[1].v = "0x1";
    intent.operations[1].r = "0x1234";
    await assert.rejects(() => buildSuccess(intent), /nonempty signatures/);
  });

  it("rejects ambiguous hex quantities", async () => {
    for (const bad of ["0x", "0x00", "0x01", "0X1", "00", ""]) {
      const intent = baseIntent();
      intent.operations[0].value = bad;
      await assert.rejects(() => buildSuccess(intent), /ambiguous|explicit|quantity/i, `value ${bad} should be rejected`);
    }
  });

  it("rejects floating numbers", async () => {
    const intent = baseIntent();
    intent.operations[0].value = 1.5;
    await assert.rejects(() => buildSuccess(intent), /floating/);
  });

  it("rejects duplicate operations", async () => {
    const intent = baseIntent();
    intent.operations[1].id = "AssetRegistry";
    await assert.rejects(() => buildSuccess(intent), /Duplicate operation/);
  });

  it("rejects duplicate operation content", async () => {
    const intent = baseIntent();
    intent.operations[1].initCode = intent.operations[0].initCode;
    await assert.rejects(() => buildSuccess(intent), /Duplicate operation content/);
  });

  it("rejects CREATE without exact init code", async () => {
    const intent = baseIntent();
    delete intent.operations[0].initCode;
    await assert.rejects(() => buildSuccess(intent), /exact init code/);
    const empty = baseIntent();
    empty.operations[0].initCode = "0x";
    await assert.rejects(() => buildSuccess(empty), /exact init code/);
  });

  it("rejects CALLs to accounts without code unless explicitly declared CREATE targets", async () => {
    const intent = baseIntent();
    intent.operations[2].to = "0x2222222222222222222222222222222222222222";
    await assert.rejects(() => buildSuccess(intent), /without code/);
  });

  it("accepts CALLs to explicitly declared CREATE targets", async () => {
    const intent = baseIntent();
    const future = "0x3333333333333333333333333333333333333333";
    intent.operations[0].expectedAddress = future;
    intent.operations[2].to = future;
    const bundle = await buildSuccess(intent);
    assert.equal(bundle.transactions[2].to, future.toLowerCase());
  });

  it("rejects value transfers that are not explicitly declared", async () => {
    const intent = baseIntent();
    intent.operations[2].value = "0x1";
    intent.operations[2].valueDeclared = false;
    await assert.rejects(() => buildSuccess(intent), /not explicitly declared/);
  });

  it("rejects intents naming mainnet send/broadcast methods", async () => {
    const intent = baseIntent();
    intent.notes = "please use eth_sendTransaction now";
    await assert.rejects(() => buildSuccess(intent), /send\/broadcast/);
  });

  it("rejects predecessor violations and non-canonical orders", async () => {
    const intent = baseIntent();
    intent.operations[0].predecessors = ["AdapterRegistry"];
    await assert.rejects(() => buildSuccess(intent), /predecessor/);
    const gap = baseIntent();
    gap.operations[2].order = 7;
    await assert.rejects(() => buildSuccess(gap), /canonical orders/);
  });

  it("rejects deployer mismatch and wrong chain", async () => {
    const intent = baseIntent();
    intent.deployer = "0x9999999999999999999999999999999999999999";
    await assert.rejects(() => buildSuccess(intent), /does not match/);
    const wrongChain = baseIntent();
    wrongChain.chainId = 1;
    await assert.rejects(() => buildSuccess(wrongChain), /chainId must be exactly 42161/);
  });
});

describe("RPC allowlist and input guards", () => {
  it("allows only read/estimate/fee methods", () => {
    for (const method of ALLOWED_RPC_METHODS) {
      assertAllowedMethod(method);
    }
    for (const forbidden of ["eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "wallet_sendTransaction", "eth_sign", "eth_signTransaction"]) {
      assert.throws(() => assertAllowedMethod(forbidden), /non-allowlisted/);
    }
  });

  it("rejects non-https, local, and mock RPC URLs", () => {
    assert.throws(() => assertExplicitRpcUrl("http://arb1.arbitrum.io/rpc"), /https/);
    assert.throws(() => assertExplicitRpcUrl("https://localhost:8545"), /local/i);
    assert.throws(() => assertExplicitRpcUrl("https://mock-arbitrum.example.com"), /mock\/test\/local/i);
    assert.throws(() => assertExplicitRpcUrl("https://user:pass@arb1.arbitrum.io/rpc"), /credentials/);
    assert.equal(assertExplicitRpcUrl("https://arb1.arbitrum.io/rpc"), "https://arb1.arbitrum.io/rpc");
  });

  it("only calls allowlisted methods during bundle construction", async () => {
    const seen = new Set();
    const inner = fixtureTransportWith();
    const recording = async (method, params) => {
      seen.add(method);
      return inner(method, params);
    };
    await buildBundle({
      intent: baseIntent(),
      intentRawText: JSON.stringify(baseIntent()),
      from: FROM,
      pinnedBlockNumber: PINNED_BLOCK,
      expectedChainId: EXPECTED_CHAIN_ID,
      transport: recording,
      timestamp: FIXED_TIME_A,
    });
    assert.ok(seen.size > 0);
    for (const method of seen) {
      assert.ok(ALLOWED_RPC_METHODS.includes(method), `unexpected RPC method ${method}`);
    }
    assert.ok(![...seen].some((method) => method.startsWith("eth_send") || method.startsWith("personal_") || method.startsWith("wallet_")));
  });
});

describe("sequential fork estimates", () => {
  it("uses precomputed pinned and latest estimates without estimating dependent operations upstream", async () => {
    const seen = [];
    const inner = fixtureTransportWith();
    const recording = async (method, params) => {
      seen.push(method);
      return inner(method, params);
    };
    const intent = baseIntent();
    const sequentialEstimates = new Map(
      intent.operations.map((op, index) => [op.id, { pinned: 100_000n + BigInt(index), latest: 90_000n + BigInt(index) }]),
    );
    const bundle = await buildBundle({
      intent,
      intentRawText: JSON.stringify(intent),
      from: FROM,
      pinnedBlockNumber: PINNED_BLOCK,
      expectedChainId: EXPECTED_CHAIN_ID,
      transport: recording,
      sequentialEstimates,
      timestamp: FIXED_TIME_A,
    });
    assert.ok(!seen.includes("eth_estimateGas"));
    assert.equal(bundle.estimationMode, "sequential-local-fork-plus-l1-component");
    for (const tx of bundle.transactions) {
      const index = intent.operations.findIndex((op) => op.id === tx.id);
      assert.equal(BigInt(tx.gas), 100_000n + BigInt(index), "chooses the larger of the pinned and latest estimates");
    }
  });

  it("adds the Arbitrum L1 data-posting component read from NodeInterface", async () => {
    const calls = [];
    const inner = fixtureTransportWith({ l1ComponentHex: "0x1f4" });
    const recording = async (method, params) => {
      if (method === "eth_call") calls.push(params[0]);
      return inner(method, params);
    };
    const intent = baseIntent();
    const sequentialEstimates = new Map(intent.operations.map((op) => [op.id, { pinned: 100_000n, latest: 100_000n }]));
    const bundle = await buildBundle({
      intent,
      intentRawText: JSON.stringify(intent),
      from: FROM,
      pinnedBlockNumber: PINNED_BLOCK,
      expectedChainId: EXPECTED_CHAIN_ID,
      transport: recording,
      sequentialEstimates,
      timestamp: FIXED_TIME_A,
    });
    assert.equal(calls.length, intent.operations.length * 2);
    for (const call of calls) {
      assert.equal(call.to, ARBITRUM_NODE_INTERFACE);
      assert.ok(call.data.startsWith(encodeGasEstimateL1Component({ to: null, contractCreation: true, data: "0x" }).slice(0, 10)));
    }
    for (const tx of bundle.transactions) {
      assert.equal(BigInt(tx.gas), 100_500n);
      assert.equal(BigInt(tx.estimatedL1GasPinned), 500n);
    }
  });

  it("encodes gasEstimateL1Component calldata exactly", () => {
    assert.equal(
      encodeGasEstimateL1Component({ to: "0x00000000000000000000000000000000000000aa", contractCreation: false, data: "0x1234" }),
      `0x77d488a2${"0".repeat(62)}aa${"0".repeat(64)}${"0".repeat(62)}60${"0".repeat(63)}2${"1234".padEnd(64, "0")}`,
    );
  });

  it("rejects a missing sequential estimate", async () => {
    const intent = baseIntent();
    await assert.rejects(
      buildBundle({
        intent,
        intentRawText: JSON.stringify(intent),
        from: FROM,
        pinnedBlockNumber: PINNED_BLOCK,
        expectedChainId: EXPECTED_CHAIN_ID,
        transport: fixtureTransportWith(),
        sequentialEstimates: new Map(),
        timestamp: FIXED_TIME_A,
      }),
      /Sequential fork estimate is missing/,
    );
  });
});

describe("state drift and estimate failure", () => {
  it("rejects dependency code-hash drift between pinned and latest", async () => {
    const usdcLower = USDC.toLowerCase();
    const drifted = clone(rpcFixture);
    drifted.codes[usdcLower] = { pinned: "0x60016001015f3560e01c", latest: "0x6002600202600055" };
    await assert.rejects(() => buildSuccess(baseIntent(), drifted), /Code-hash drift/);
  });

  it("rejects dependency hash mismatch against the declared expectation", async () => {
    const intent = baseIntent();
    intent.dependencies[0].expectedCodeHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    await assert.rejects(() => buildSuccess(intent), /mismatch/);
  });

  it("rejects nonce drift between pinned and latest", async () => {
    await assert.rejects(() => buildSuccess(baseIntent(), { nonceLatestHex: "0x6" }), /Nonce drift/);
  });

  it("surfaces estimate failures without fallback", async () => {
    await assert.rejects(() => buildSuccess(baseIntent(), { failEstimate: true }), /eth_estimateGas failed/);
  });
});

describe("unsigned output guarantees", () => {
  it("contains no secret or signed payload and stays broadcast:false/signed:false", async () => {
    const bundle = await buildSuccess();
    assert.equal(bundle.broadcast, false);
    assert.equal(bundle.signed, false);
    assert.equal(bundle.readOnly, true);
    assert.equal(bundle.signaturesRequested, 0);
    assert.equal(bundle.transactionsSent, 0);
    assert.equal(bundle.chainId, 42161);
    const serialized = JSON.stringify(bundle).toLowerCase();
    // signaturesRequested is an explicit zero counter (as in the fork
    // qualification report) and must not be mistaken for a signature payload.
    const serializedWithoutCounter = serialized.split("signaturesrequested").join("");
    for (const forbidden of ["privatekey", "mnemonic", "\"signature\"", "rawtransaction", "eth_sendrawtransaction", "eth_sendtransaction", "personal_", "wallet_"]) {
      assert.ok(!serializedWithoutCounter.includes(forbidden), `output must not contain ${forbidden}`);
    }
    for (const tx of bundle.transactions) {
      assert.ok(!("v" in tx) && !("r" in tx) && !("s" in tx) && !("signature" in tx));
      assert.ok(["0xa4b1"].includes(tx.chainId));
      assert.equal(tx.from, FROM.toLowerCase());
      assert.ok(typeof tx.nonce === "string" && tx.nonce.startsWith("0x"));
      assert.ok(tx.to === null || /^0x[0-9a-f]{40}$/.test(tx.to));
      assert.ok(tx.value.startsWith("0x") && tx.data.startsWith("0x"));
      assert.ok(Array.isArray(tx.accessList));
      assert.ok(tx.gas.startsWith("0x") && tx.maxFeePerGas.startsWith("0x"));
    }
    assert.ok(typeof bundle.sourceIntentHash === "string" && bundle.sourceIntentHash.startsWith("0x"));
    assert.ok(typeof bundle.bundleHash === "string" && bundle.bundleHash.startsWith("0x"));
    assert.notEqual(bundle.bundleHash, bundle.sourceIntentHash);
    assert.ok(bundle.pinnedBlock.hash.startsWith("0x") && bundle.latestBlock.hash.startsWith("0x"));
    assert.equal(codeHashForHex("0x60016001015f3560e01c"), bundle.dependencies[0].pinnedCodeHash);
  });
});

describe("ethereum runtime code hashes (Keccak-256)", () => {
  it("matches Keccak-256 vectors for empty and single-zero bytecode", () => {
    // Ethereum Keccak-256, not NIST SHA-256.
    assert.equal(
      codeHashForHex("0x"),
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    assert.equal(
      codeHashForHex("0x00"),
      "0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a",
    );
    // Guard against NIST SHA-256 regression: SHA-256("") is e3b0c44... not c5d246...
    assert.notEqual(
      codeHashForHex("0x"),
      "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    assert.notEqual(
      codeHashForHex("0x60016001015f3560e01c"),
      "0x13d25878c3379628ab9888269677cbc2bba3f01bbf469a03a81d929319d8e710",
    );
  });

  it("reports Keccak values in dependency evidence", async () => {
    const bundle = await buildSuccess();
    const expectedKeccak = "0xabb1775bd46b81722ea96e43e0e7fc46010788e390cba3927c06d2e8e2acc965";
    assert.equal(codeHashForHex("0x60016001015f3560e01c"), expectedKeccak);
    assert.equal(bundle.dependencies[0].expectedCodeHash, expectedKeccak);
    assert.equal(bundle.dependencies[0].pinnedCodeHash, expectedKeccak);
    assert.equal(bundle.dependencies[0].latestCodeHash, expectedKeccak);
    assert.equal(bundle.dependencies[0].matchesExpected, true);
    assert.equal(bundle.dependencies[0].codeStable, true);
  });
});
