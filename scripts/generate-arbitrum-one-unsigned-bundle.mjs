#!/usr/bin/env node
// Read-only Arbitrum One unsigned production transaction bundle (Phase 4).
//
// - Never sends, signs, broadcasts, unlocks accounts, or writes to any chain.
// - Only allowlisted read/estimate/fee JSON-RPC methods are ever called.
// - Requires explicit --rpc-url (https), --block-number (decimal), --from,
//   and --intent (deployment-intent JSON outside inspiration/ and docs/).
// - Supports --fixture <canned-rpc.json> dry mode with a fake transport for
//   focused tests; network mode requires all explicit inputs.
// - Default output is stdout; --output must stay inside
//   deployments/arbitrum-one/qualification/ when explicitly requested.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_RPC_METHODS,
  EXPECTED_CHAIN_ID,
  assertAllowedMethod,
  assertExplicitRpcUrl,
  assertFromAddress,
  assertPinnedBlockNumber,
  buildBundle,
  createFixtureTransport,
} from "./lib/unsigned-bundle.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentsRoot = resolve(repositoryRoot, "deployments");
const qualificationRoot = resolve(repositoryRoot, "deployments/arbitrum-one/qualification");

function usage() {
  process.stdout.write(`Usage:
  node scripts/generate-arbitrum-one-unsigned-bundle.mjs --rpc-url <https-url> --block-number <pinned-decimal> --from <0x-address> --intent <path> [--output <path>]
  node scripts/generate-arbitrum-one-unsigned-bundle.mjs --fixture <canned-rpc.json> --block-number <pinned-decimal> --from <0x-address> --intent <path> [--output <path>]

Read-only unsigned EIP-1559 bundle with gas budget. Only ${ALLOWED_RPC_METHODS.join(", ")} are ever called.
No transactions are sent, signed, or broadcast. Default output is stdout.
--intent must stay outside inspiration/ and docs/. --output, when given, must stay
inside deployments/arbitrum-one/qualification/.
`);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    if (!argument.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${argument}`);
    }
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function resolveIntentPath(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.includes("\0")) {
    throw new Error("Explicit --intent is required: path to a deployment-intent JSON file.");
  }
  if (isAbsolute(raw)) {
    throw new Error("Rejected --intent: absolute paths are not allowed; pass a repository-relative path.");
  }
  const absolute = resolve(repositoryRoot, raw);
  const relativePath = relative(repositoryRoot, absolute);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Rejected --intent: path must remain inside the repository.");
  }
  const segments = relativePath.split(sep);
  if (segments[0] === "inspiration" || segments[0] === "docs" || segments.includes("inspiration") || segments.includes("docs")) {
    throw new Error("Rejected --intent: deployment intent must live outside inspiration/ and docs/.");
  }
  return { absolute, reportPath: relativePath.split(sep).join("/") };
}

function resolveOutputPath(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  if (typeof raw !== "string" || raw.includes("\0")) {
    throw new Error("Invalid --output: must be a non-empty path.");
  }
  if (isAbsolute(raw)) {
    throw new Error("Rejected --output: absolute paths are not allowed; stay inside deployments/arbitrum-one/qualification/.");
  }
  const absolute = resolve(repositoryRoot, raw);
  const traversal = relative(qualificationRoot, absolute);
  if (traversal === "" || traversal.startsWith("..") || isAbsolute(traversal)) {
    throw new Error("Rejected --output: path must remain inside deployments/arbitrum-one/qualification/.");
  }
  return { absolute, reportPath: relative(repositoryRoot, absolute).split(sep).join("/") };
}

function resolveFixturePath(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.includes("\0")) {
    throw new Error("Invalid --fixture: must be a non-empty path.");
  }
  if (isAbsolute(raw)) {
    throw new Error("Rejected --fixture: absolute paths are not allowed.");
  }
  const absolute = resolve(repositoryRoot, raw);
  const traversal = relative(repositoryRoot, absolute);
  if (traversal.startsWith("..") || isAbsolute(traversal)) {
    throw new Error("Rejected --fixture: path must remain inside the repository.");
  }
  return absolute;
}

function createNetworkTransport(url) {
  return async (method, params = []) => {
    assertAllowedMethod(method);
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) {
      throw new Error(`${method} failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(`${method} failed: ${payload.error.message}`);
    }
    return payload.result;
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const fixturePath = resolveFixturePath(options.fixture);
  let rpcUrl = null;
  if (fixturePath === null) {
    rpcUrl = assertExplicitRpcUrl(options["rpc-url"]);
  } else if (options["rpc-url"] !== undefined) {
    rpcUrl = assertExplicitRpcUrl(options["rpc-url"]);
  }
  const pinnedBlockNumber = assertPinnedBlockNumber(options["block-number"]);
  const from = assertFromAddress(options.from);
  const { absolute: intentAbsolute } = resolveIntentPath(options.intent);
  const output = resolveOutputPath(options.output);

  const intentRawText = readFileSync(intentAbsolute, "utf8");
  let intent;
  try {
    intent = JSON.parse(intentRawText);
  } catch {
    throw new Error("Deployment intent is not valid JSON.");
  }

  let transport;
  if (fixturePath !== null) {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    transport = createFixtureTransport(fixture);
  } else {
    transport = createNetworkTransport(rpcUrl);
  }

  const bundle = await buildBundle({
    intent,
    intentRawText,
    from,
    pinnedBlockNumber,
    expectedChainId: EXPECTED_CHAIN_ID,
    transport,
    timestamp: new Date().toISOString(),
  });

  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (output === null) {
    process.stdout.write(serialized);
    return;
  }
  mkdirSync(dirname(output.absolute), { recursive: true });
  writeFileSync(output.absolute, serialized);
  process.stdout.write(`Wrote unsigned bundle to ${output.reportPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
