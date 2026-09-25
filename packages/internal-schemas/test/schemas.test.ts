import assert from "node:assert/strict";
import test from "node:test";

import { parseAddress, parseBlockIdentity, parseBytes32, parseDeploymentManifestIdentity } from "../src/index.ts";

const hash = `0x${"ab".repeat(32)}`;
const address = `0x${"12".repeat(20)}`;

test("canonical hex values normalize to lowercase", () => {
  assert.equal(parseAddress(address.toUpperCase().replace("0X", "0x")), address);
  assert.equal(parseBytes32(hash.toUpperCase().replace("0X", "0x")), hash);
});

test("block identities reject unsafe numbers", () => {
  assert.throws(() =>
    parseBlockIdentity({ chainId: 421614, number: -1, hash, parentHash: hash, timestamp: 1 }),
  );
});

test("deployment identity requires a real contract list", () => {
  assert.throws(() =>
    parseDeploymentManifestIdentity({
      schemaVersion: "1.0.0",
      environment: "local",
      chainId: 31337,
      status: "planned",
      blockReference: { number: null, hash: null },
      contracts: [],
    }),
  );
});
