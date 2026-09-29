#!/usr/bin/env node
// Read-only Arbitrum One RPC dependency observation (Phase 4 slice 1).
//
// - Never sends transactions, signs, broadcasts, unlocks accounts, or writes to any chain.
// - Only uses eth_chainId, eth_getBlockByNumber, and eth_getCode via plain JSON-RPC.
// - Requires an explicit --rpc-url and --block-number; environment variables are ignored
//   so observation cannot silently inherit ambient configuration.
// - Validates the production manifest with scripts/validate-deployment-manifests.mjs,
//   then applies fail-closed hygiene (mock/test/local/zero/missing-code/unexpected-role).
// - Reads each declared external dependency bytecode at the pinned block and at latest,
//   hashes runtime code with `cast keccak` (same as deployment evidence), and compares
//   against manifest expectations where declared. A pinned/latest bytecode change fails.
// - Emits one deterministic JSON report to stdout and writes no files, so point-in-time
//   reports are never committed. This is dependency observation only, not a complete
//   fork qualification or launch approval.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentsRoot = resolve(repositoryRoot, "deployments");
const HARNESS_VERSION = "1.0.0";
const EXPECTED_CHAIN_ID = 42161;
const DEFAULT_MANIFEST = "deployments/arbitrum-one/manifest.json";
const READ_ONLY_METHODS = ["eth_chainId", "eth_getBlockByNumber", "eth_getCode"];
const READ_ONLY_METHOD_SET = new Set(READ_ONLY_METHODS);
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_PATTERN = /^0x([0-9a-fA-F]*)$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const MOCK_TEST_LOCAL_WORD = /\b(mock|test|local)\b/i;
const FORBIDDEN_HOST_TOKENS = new Set(["mock", "test", "local", "localhost", "example", "invalid", "internal"]);
const PROVENANCE_KINDS = new Set(["official-documentation", "onchain-registry", "operator-attestation"]);
const QUALIFICATION_STATUSES = new Set(["pending", "code-hash-recorded", "qualified", "rejected"]);

function usage() {
  process.stdout.write(`Usage:
  node scripts/qualify-arbitrum-one-fork.mjs --rpc-url <https-url> --block-number <pinned-decimal> [--manifest <path>]

Read-only Arbitrum One RPC dependency observation. Only eth_chainId,
eth_getBlockByNumber, and eth_getCode are ever called. No transactions are
sent, signed, broadcast, or simulated as writes. A deterministic JSON report
is printed to stdout; no files are written. --manifest must stay inside
deployments/; absolute paths and traversal escapes are rejected.

Example:
  pnpm phase4:fork:qualify -- --rpc-url https://arb1.arbitrum.io/rpc --block-number 12345678
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

function readJson(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

async function rpc(url, method, params = []) {
  if (!READ_ONLY_METHOD_SET.has(method)) {
    throw new Error(`Refusing non-read-only JSON-RPC method: ${method}`);
  }
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
}

function keccak(hexValue) {
  return execFileSync("cast", ["keccak", hexValue], { encoding: "utf8" }).trim().toLowerCase();
}

function isZeroAddress(address) {
  return address.toLowerCase() === ZERO_ADDRESS;
}

function assertExplicitRpcUrl(raw) {
  if (!raw) {
    throw new Error("Explicit --rpc-url is required for Arbitrum One dependency observation.");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid --rpc-url: must be a parseable URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Rejected unexpected-role RPC configuration: --rpc-url must not embed credentials.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Rejected local RPC configuration: --rpc-url must use https for Arbitrum One (received ${parsed.protocol}).`,
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
    throw new Error("Rejected local RPC configuration: hostname is a local address.");
  }
  if (
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Rejected local RPC configuration: hostname is private or local.");
  }
  const labels = hostname.split(".");
  if (labels.some((label) => FORBIDDEN_HOST_TOKENS.has(label))) {
    throw new Error("Rejected mock/test/local RPC configuration: hostname is not allowed.");
  }
  return raw;
}

function resolveManifestPath(rawOption) {
  const raw = rawOption ?? DEFAULT_MANIFEST;
  if (typeof raw !== "string" || raw.length === 0 || raw.includes("\0")) {
    throw new Error("Invalid --manifest: must be a non-empty path.");
  }
  if (isAbsolute(raw)) {
    throw new Error("Rejected --manifest: absolute paths are not allowed; stay inside deployments/.");
  }
  const absolute = resolve(repositoryRoot, raw);
  const traversal = relative(deploymentsRoot, absolute);
  if (traversal === "" || traversal.startsWith("..") || isAbsolute(traversal)) {
    throw new Error("Rejected --manifest: path must remain inside the repository deployments directory.");
  }
  return { absolute, reportPath: relative(repositoryRoot, absolute).split(sep).join("/") };
}

function assertPinnedBlockNumber(raw) {
  if (!raw) {
    throw new Error("Explicit --block-number is required for Arbitrum One dependency observation.");
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid --block-number ${raw}: must be a decimal integer.`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid --block-number ${raw}: must be a safe integer.`);
  }
  if (value === 0) {
    throw new Error("Rejected zero block number: --block-number must be greater than zero.");
  }
  return value;
}

function validateHexCode(value, context) {
  if (typeof value !== "string" || !HEX_PATTERN.test(value)) {
    throw new Error(`${context} returned malformed bytecode.`);
  }
  return value;
}

function assertProductionManifestHygiene(manifest, manifestPath) {
  if (manifest.environment !== "arbitrum-one") {
    throw new Error(`${manifestPath}: unexpected manifest environment ${manifest.environment}; expected arbitrum-one.`);
  }
  if (manifest.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`${manifestPath}: unexpected chain ID ${manifest.chainId}; expected ${EXPECTED_CHAIN_ID}.`);
  }
  if (manifest.status !== "disabled") {
    throw new Error(`${manifestPath}: unexpected Arbitrum One status ${manifest.status}; must remain disabled.`);
  }
  if (
    manifest.broadcast?.enabled !== false ||
    manifest.broadcast?.signed !== false ||
    manifest.broadcast?.transactionCount !== 0
  ) {
    throw new Error(`${manifestPath}: unexpected Arbitrum One broadcast configuration; must remain disabled.`);
  }
  if (manifest.phase2?.mainnetBroadcastAllowed !== false) {
    throw new Error(`${manifestPath}: unexpected mainnet broadcast permission; must remain false.`);
  }

  const contractNames = new Set((manifest.contracts ?? []).map((contract) => contract.name));
  const phase2Names = new Set(manifest.phase2?.contracts ?? []);
  for (const contract of manifest.contracts ?? []) {
    if (contract.address !== null) {
      throw new Error(
        `${manifestPath}: unexpected live contract address for ${contract.name} while Arbitrum One is disabled.`,
      );
    }
    if (contract.implementation !== null) {
      throw new Error(
        `${manifestPath}: unexpected live contract implementation for ${contract.name} while Arbitrum One is disabled.`,
      );
    }
    if (contract.owner?.address !== null && contract.owner?.address !== undefined) {
      throw new Error(
        `${manifestPath}: unexpected-role configuration: ${contract.name} owner address must be null before qualification.`,
      );
    }
    for (const role of contract.roles ?? []) {
      if (!role.name || typeof role.name !== "string") {
        throw new Error(`${manifestPath}: unexpected-role configuration: ${contract.name} has a nameless role.`);
      }
      if (MOCK_TEST_LOCAL_WORD.test(role.name) || MOCK_TEST_LOCAL_WORD.test(role.id ?? "")) {
        throw new Error(
          `${manifestPath}: rejected mock/test/local role configuration: ${contract.name}.${role.name}.`,
        );
      }
      if (!Array.isArray(role.members)) {
        throw new Error(`${manifestPath}: unexpected-role configuration: ${contract.name}.${role.name} members.`);
      }
      if (role.members.length !== 0) {
        throw new Error(
          `${manifestPath}: unexpected-role configuration: ${contract.name}.${role.name} must have no members before qualification.`,
        );
      }
      for (const member of role.members) {
        if (member?.source && MOCK_TEST_LOCAL_WORD.test(member.source)) {
          throw new Error(
            `${manifestPath}: rejected mock/test/local role configuration: ${contract.name}.${role.name}.`,
          );
        }
      }
    }
  }

  const dependencies = manifest.externalDependencies;
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    throw new Error(`${manifestPath}: no external dependencies declared for Arbitrum One qualification.`);
  }
  const seenNames = new Set();
  const seenAddresses = new Set();
  for (const dependency of dependencies) {
    if (!dependency.name || typeof dependency.name !== "string") {
      throw new Error(`${manifestPath}: external dependency is missing its name.`);
    }
    if (MOCK_TEST_LOCAL_WORD.test(dependency.name)) {
      throw new Error(`${manifestPath}: rejected mock/test/local external dependency name: ${dependency.name}.`);
    }
    if (seenNames.has(dependency.name)) {
      throw new Error(`${manifestPath}: duplicate external dependency ${dependency.name}.`);
    }
    seenNames.add(dependency.name);
    if (!dependency.address || typeof dependency.address !== "string" || !ADDRESS_PATTERN.test(dependency.address)) {
      throw new Error(`${manifestPath}: missing-code configuration: ${dependency.name} has no usable address.`);
    }
    if (isZeroAddress(dependency.address)) {
      throw new Error(`${manifestPath}: rejected zero address for external dependency ${dependency.name}.`);
    }
    const normalizedAddress = dependency.address.toLowerCase();
    if (seenAddresses.has(normalizedAddress)) {
      throw new Error(`${manifestPath}: duplicate external dependency address for ${dependency.name}.`);
    }
    seenAddresses.add(normalizedAddress);
    for (const field of [dependency.purpose, dependency.provenance?.reference]) {
      if (typeof field === "string" && MOCK_TEST_LOCAL_WORD.test(field)) {
        throw new Error(
          `${manifestPath}: rejected mock/test/local external dependency configuration: ${dependency.name}.`,
        );
      }
    }
    if (!PROVENANCE_KINDS.has(dependency.provenance?.kind)) {
      throw new Error(`${manifestPath}: unexpected provenance for external dependency ${dependency.name}.`);
    }
    if (!Array.isArray(dependency.consumers) || dependency.consumers.length === 0) {
      throw new Error(`${manifestPath}: unexpected consumer wiring for external dependency ${dependency.name}.`);
    }
    for (const consumer of dependency.consumers) {
      if (!contractNames.has(consumer) && !phase2Names.has(consumer)) {
        throw new Error(
          `${manifestPath}: unexpected-role configuration: ${dependency.name} lists unknown consumer ${consumer}.`,
        );
      }
    }
    if (!QUALIFICATION_STATUSES.has(dependency.qualificationStatus)) {
      throw new Error(
        `${manifestPath}: unexpected qualification status for external dependency ${dependency.name}.`,
      );
    }
    if (dependency.qualificationStatus === "qualified") {
      throw new Error(
        `${manifestPath}: unexpected qualified status for external dependency ${dependency.name}; must remain code-hash-recorded.`,
      );
    }
    if (dependency.qualificationStatus !== "code-hash-recorded") {
      throw new Error(
        `${manifestPath}: unexpected qualification status for external dependency ${dependency.name}; expected code-hash-recorded.`,
      );
    }
    if (typeof dependency.runtimeCodeHash !== "string" || !BYTES32_PATTERN.test(dependency.runtimeCodeHash)) {
      throw new Error(
        `${manifestPath}: missing-code configuration: ${dependency.name} must declare an exact runtime code hash.`,
      );
    }
    if (dependency.runtimeCodeHash.toLowerCase() === ZERO_HASH) {
      throw new Error(
        `${manifestPath}: rejected zero runtime code hash for external dependency ${dependency.name}.`,
      );
    }
  }
}

function validateBlockPayload(block, context) {
  if (!block || typeof block.number !== "string" || typeof block.hash !== "string") {
    throw new Error(`${context} is missing its block payload.`);
  }
  if (!/^0x[0-9a-fA-F]+$/.test(block.number) || !BYTES32_PATTERN.test(block.hash)) {
    throw new Error(`${context} returned a malformed block payload.`);
  }
  return { number: Number.parseInt(block.number, 16), hash: block.hash.toLowerCase() };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const rpcUrl = assertExplicitRpcUrl(options["rpc-url"]);
  const pinnedBlockNumber = assertPinnedBlockNumber(options["block-number"]);

  const { absolute: manifestAbsolute, reportPath: manifestRelative } = resolveManifestPath(options.manifest);
  const manifest = readJson(manifestAbsolute);

  try {
    execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/validate-deployment-manifests.mjs"), "--manifest", manifestAbsolute],
      { cwd: repositoryRoot, encoding: "utf8", stdio: "pipe" },
    );
  } catch (error) {
    const detail = error?.stdout ?? error?.stderr ?? error?.message ?? "unknown validation failure";
    throw new Error(`Production manifest validation failed: ${String(detail).trim()}`);
  }

  assertProductionManifestHygiene(manifest, manifestRelative);

  const chainId = Number.parseInt(await rpc(rpcUrl, "eth_chainId"), 16);
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`RPC must resolve to Arbitrum One: expected chain ID ${EXPECTED_CHAIN_ID}, received ${chainId}.`);
  }

  const pinnedHex = `0x${pinnedBlockNumber.toString(16)}`;
  const pinnedBlock = validateBlockPayload(
    await rpc(rpcUrl, "eth_getBlockByNumber", [pinnedHex, false]),
    "Pinned block",
  );
  if (pinnedBlock.number !== pinnedBlockNumber) {
    throw new Error(
      `Pinned block mismatch: requested ${pinnedBlockNumber}, received ${pinnedBlock.number}.`,
    );
  }
  const latestBlock = validateBlockPayload(await rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]), "Latest block");
  if (!Number.isSafeInteger(latestBlock.number) || latestBlock.number === 0) {
    throw new Error("Rejected zero latest block number from the Arbitrum One RPC.");
  }
  if (pinnedBlockNumber > latestBlock.number) {
    throw new Error(
      `Pinned block ${pinnedBlockNumber} is ahead of latest block ${latestBlock.number}.`,
    );
  }
  if (
    manifest.blockReference?.number !== pinnedBlockNumber ||
    typeof manifest.blockReference?.hash !== "string" ||
    manifest.blockReference.hash.toLowerCase() !== pinnedBlock.hash ||
    manifest.blockReference?.mode !== "pinned"
  ) {
    throw new Error(
      `${manifestRelative}: pinned block reference must match observed block ${pinnedBlockNumber} (${pinnedBlock.hash}).`,
    );
  }

  const dependencies = [];
  for (const dependency of [...manifest.externalDependencies].sort((a, b) => a.name.localeCompare(b.name))) {
    const pinnedCode = validateHexCode(
      await rpc(rpcUrl, "eth_getCode", [dependency.address, pinnedHex]),
      `${dependency.name} pinned bytecode`,
    );
    if (pinnedCode === "0x") {
      throw new Error(
        `${manifestRelative}: missing-code configuration: ${dependency.name} has no bytecode at pinned block ${pinnedBlockNumber}.`,
      );
    }
    const latestCode = validateHexCode(
      await rpc(rpcUrl, "eth_getCode", [dependency.address, "latest"]),
      `${dependency.name} latest bytecode`,
    );
    if (latestCode === "0x") {
      throw new Error(
        `${manifestRelative}: missing-code configuration: ${dependency.name} has no bytecode at latest block ${latestBlock.number}.`,
      );
    }
    const pinnedCodeHash = keccak(pinnedCode);
    const latestCodeHash = keccak(latestCode);
    if (pinnedCodeHash === ZERO_HASH || latestCodeHash === ZERO_HASH) {
      throw new Error(
        `${manifestRelative}: rejected zero runtime code hash for external dependency ${dependency.name}.`,
      );
    }
    if (pinnedCode !== latestCode || pinnedCodeHash !== latestCodeHash) {
      throw new Error(
        `${manifestRelative}: bytecode change for ${dependency.name} between pinned block ${pinnedBlockNumber} and latest block ${latestBlock.number}.`,
      );
    }
    const declared = dependency.runtimeCodeHash ?? null;
    const normalizedDeclared = declared === null ? null : declared.toLowerCase();
    if (normalizedDeclared === null) {
      throw new Error(
        `${manifestRelative}: missing-code configuration: ${dependency.name} must declare an exact runtime code hash.`,
      );
    }
    if (pinnedCodeHash !== normalizedDeclared) {
      throw new Error(
        `${manifestRelative}: runtime code hash mismatch for ${dependency.name} at pinned block ${pinnedBlockNumber}.`,
      );
    }
    if (latestCodeHash !== normalizedDeclared) {
      throw new Error(
        `${manifestRelative}: runtime code hash mismatch for ${dependency.name} at latest block ${latestBlock.number}.`,
      );
    }
    dependencies.push({
      address: dependency.address,
      codeStable: true,
      consumers: [...dependency.consumers].sort(),
      latestCodeHash,
      manifestRuntimeCodeHash: normalizedDeclared,
      matchesManifest: normalizedDeclared === null ? null : true,
      name: dependency.name,
      pinnedCodeHash,
      qualificationStatus: dependency.qualificationStatus,
    });
  }

  const manifestHashesComplete = dependencies.every((entry) => entry.manifestRuntimeCodeHash !== null);
  if (!manifestHashesComplete) {
    throw new Error(`${manifestRelative}: incomplete runtime code hash evidence; every dependency must declare an exact hash.`);
  }

  const report = {
    chainId: EXPECTED_CHAIN_ID,
    dependencies,
    harnessVersion: HARNESS_VERSION,
    latestBlock,
    launchApproval: false,
    manifest: manifestRelative,
    manifestHashesComplete,
    manifestValid: true,
    notes:
      "Read-only RPC dependency observation only; not a complete fork qualification and not launch approval. No transactions sent, signed, broadcast, or chain writes performed. This report is point-in-time stdout only and must not be committed.",
    pinnedBlock,
    qualification: "dependency-read-observed",
    readOnly: true,
    rpcMethodsUsed: READ_ONLY_METHODS,
    signaturesRequested: 0,
    tool: "qualify-arbitrum-one-fork",
    transactionsSent: 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
