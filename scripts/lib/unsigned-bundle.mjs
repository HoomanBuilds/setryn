#!/usr/bin/env node
// Read-only Arbitrum One unsigned production transaction bundle + gas-budget tooling.
// Pure library: deterministic canonicalization, strict intent validation, and
// read-only bundle construction over an injected JSON-RPC transport.
// Built-in Node modules only. Never signs, sends, or broadcasts.

import { createHash } from "node:crypto";

export const TOOL_NAME = "generate-arbitrum-one-unsigned-bundle";
export const HARNESS_VERSION = "1.0.0";
export const EXPECTED_CHAIN_ID = 42161;
export const EXPECTED_CHAIN_ID_HEX = "0xa4b1";
export const RESERVE_MULTIPLIER = 2;
export const MAX_ESTIMATE_GAS = 30_000_000n;

export const ALLOWED_RPC_METHODS = [
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_estimateGas",
  "eth_call",
  "eth_feeHistory",
  "eth_maxPriorityFeePerGas",
];
const ALLOWED_METHOD_SET = new Set(ALLOWED_RPC_METHODS);

const FORBIDDEN_METHOD_SUBSTRINGS = [
  "eth_sendrawtransaction",
  "eth_sendtransaction",
  "personal_",
  "wallet_",
  "eth_sign",
];

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_DATA_PATTERN = /^0x([0-9a-fA-F]{2})*$/;
// Canonical minimal hex quantity: 0x0 or 0x followed by non-zero hex digit then hex digits.
const HEX_QUANTITY_PATTERN = /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const DECIMAL_QUANTITY_PATTERN = /^(0|[1-9][0-9]*)$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const FORBIDDEN_HOST_TOKENS = new Set(["mock", "test", "local", "localhost", "example", "invalid", "internal"]);

export function assertAllowedMethod(method) {
  if (!ALLOWED_METHOD_SET.has(method)) {
    throw new Error(`Refusing non-allowlisted JSON-RPC method: ${method}`);
  }
}

export function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256HexOfString(text) {
  // SHA-256 document hash for source-intent and bundle transcripts.
  // Not an Ethereum runtime code hash.
  return `0x${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function sha256HexOfBytesHex(hexValue) {
  // SHA-256 helper for non-Ethereum bytes. Never use for Ethereum runtime code hashes.
  const bytes = Buffer.from(hexValue.slice(2), "hex");
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

// Ethereum runtime code hash: Keccak-256 of raw bytecode (EXTCODEHASH semantics).
// Dependency-free pure-JS implementation using only built-in BigInt/Uint8Array.
// No npm package, no shell binary.
const KECCAK256_RATE_BYTES = 136;
const KECCAK256_MASK64 = (1n << 64n) - 1n;
const KECCAK256_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK256_ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function keccakRotl64(value, shift) {
  const n = shift % 64;
  if (n === 0) return value & KECCAK256_MASK64;
  return ((value << BigInt(n)) | (value >> BigInt(64 - n))) & KECCAK256_MASK64;
}

function keccakF1600(state) {
  for (let round = 0; round < 24; round += 1) {
    const c = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    const d = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5] ^ keccakRotl64(c[(x + 1) % 5], 1);
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] = (state[x + 5 * y] ^ d[x]) & KECCAK256_MASK64;
      }
    }
    const b = new Array(25);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = keccakRotl64(state[x + 5 * y], KECCAK256_ROT[x][y]);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const cur = b[x + 5 * y];
        const nxt1 = b[((x + 1) % 5) + 5 * y];
        const nxt2 = b[((x + 2) % 5) + 5 * y];
        state[x + 5 * y] = (cur ^ ((~nxt1 & KECCAK256_MASK64) & nxt2)) & KECCAK256_MASK64;
      }
    }
    state[0] = (state[0] ^ KECCAK256_RC[round]) & KECCAK256_MASK64;
  }
}

export function keccak256Bytes(input) {
  const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input);
  const paddedLength = Math.ceil((bytes.length + 1) / KECCAK256_RATE_BYTES) * KECCAK256_RATE_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  // Keccak-256 domain suffix 0x01 (not NIST SHA3-256 0x06), then pad10*1.
  padded[bytes.length] = 0x01;
  padded[paddedLength - 1] |= 0x80;
  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < paddedLength; offset += KECCAK256_RATE_BYTES) {
    for (let i = 0; i < KECCAK256_RATE_BYTES; i += 1) {
      const lane = i >> 3;
      const shift = BigInt(8 * (i & 7));
      state[lane] = (state[lane] ^ (BigInt(padded[offset + i]) << shift)) & KECCAK256_MASK64;
    }
    keccakF1600(state);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number((state[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
  }
  return out;
}

export function keccak256HexOfBytes(bytes) {
  const digest = keccak256Bytes(bytes);
  let hex = "0x";
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function keccak256HexOfBytesHex(hexValue) {
  const normalized = hexValue.toLowerCase();
  if (!/^0x([0-9a-f]{2})*$/.test(normalized)) {
    throw new Error("code bytes must be even-length 0x hex data.");
  }
  const body = normalized.slice(2);
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return keccak256HexOfBytes(bytes);
}

export function codeHashForHex(codeHex) {
  // Ethereum Keccak-256 runtime code hash. Not SHA-256.
  return keccak256HexOfBytesHex(codeHex.toLowerCase());
}

export function toHexQuantity(bigintValue) {
  if (bigintValue === 0n) return "0x0";
  return `0x${bigintValue.toString(16)}`;
}

function isEmptySignatureValue(value) {
  if (value === null || value === undefined) return true;
  if (value === "") return true;
  if (value === "0x" || value === "0x0" || value === "0x00") return true;
  if (value === 0 || value === "0") return true;
  return false;
}

export function parseQuantityToBigInt(raw, field) {
  if (typeof raw !== "string") {
    throw new Error(`${field} must be a decimal or 0x quantity string; floating numbers and numeric types are rejected.`);
  }
  if (raw.length === 0) {
    throw new Error(`${field} is empty; ambiguous hex quantities are rejected.`);
  }
  if (raw.includes(".") || /[eE]/.test(raw) && /[0-9]/.test(raw) && !raw.startsWith("0x") && !raw.startsWith("0X")) {
    throw new Error(`${field} ${raw}: floating numbers are rejected; use an integer quantity string.`);
  }
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    if (!raw.startsWith("0x")) {
      throw new Error(`${field} ${raw}: ambiguous hex quantities are rejected; use lowercase 0x prefix.`);
    }
    if (!HEX_QUANTITY_PATTERN.test(raw)) {
      throw new Error(`${field} ${raw}: ambiguous hex quantities are rejected; use minimal 0x quantity (0x0 or non-zero without leading zeros).`);
    }
    // Reject leading-zero non-zero quantities explicitly (covered by pattern, but keep message clear).
    if (raw.length > 3 && raw[2] === "0") {
      throw new Error(`${field} ${raw}: ambiguous hex quantities are rejected; leading zeros are not allowed.`);
    }
    return BigInt(raw);
  }
  if (!DECIMAL_QUANTITY_PATTERN.test(raw)) {
    throw new Error(`${field} ${raw}: must be a decimal integer string or minimal 0x quantity; floating numbers are rejected.`);
  }
  return BigInt(raw);
}

export function validateAddress(value, field) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    throw new Error(`${field} must be a 0x address.`);
  }
  if (value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${field} must not be the zero address.`);
  }
  return value;
}

export function validateBytes32(value, field) {
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) {
    throw new Error(`${field} must be a 0x bytes32 value.`);
  }
  if (value.toLowerCase() === ZERO_HASH) {
    throw new Error(`${field} must not be the zero hash.`);
  }
  return value;
}

export function validateHexData(value, field, { allowEmpty = true } = {}) {
  if (typeof value !== "string" || !HEX_DATA_PATTERN.test(value)) {
    throw new Error(`${field} must be even-length 0x hex data; ambiguous hex quantities are rejected.`);
  }
  if (!allowEmpty && value === "0x") {
    throw new Error(`${field} must not be empty; CREATE transactions require exact init code.`);
  }
  return value.toLowerCase();
}

function scanIntentForSecretsAndMethods(node, path = "$") {
  if (typeof node === "number") {
    if (!Number.isInteger(node)) {
      throw new Error(`${path}: floating numbers are rejected; use integer quantity strings.`);
    }
    if (!Number.isSafeInteger(node)) {
      throw new Error(`${path}: unsafe integer is rejected.`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((entry, index) => scanIntentForSecretsAndMethods(entry, `${path}[${index}]`));
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, "");
      if (normalized.includes("privatekey") || normalized === "mnemonic" || normalized.includes("seedphrase") || normalized.includes("secretkey") || normalized.includes("signingkey")) {
        throw new Error(`${path}.${key}: private keys are rejected; the bundle tool is unsigned and read-only.`);
      }
      if ((normalized === "password" || normalized === "passphrase") && !isEmptySignatureValue(value)) {
        throw new Error(`${path}.${key}: private keys and secrets are rejected.`);
      }
      if ((normalized === "broadcast" || normalized === "signed") && value === true) {
        throw new Error(`${path}.${key}: signed transactions and broadcast payloads are rejected; output stays unsigned with broadcast:false/signed:false.`);
      }
      if ((normalized === "signature" || normalized === "signatures" || normalized === "rawtransaction" || normalized === "signedtransaction" || normalized === "signedtx" || normalized === "sig") && !isEmptySignatureValue(value)) {
        throw new Error(`${path}.${key}: signed transactions and nonempty signatures are rejected; the bundle is unsigned.`);
      }
      if ((key === "method" || normalized === "rpcmethod" || normalized === "rpcmethodname") && typeof value === "string") {
        const lowered = value.toLowerCase();
        for (const forbidden of FORBIDDEN_METHOD_SUBSTRINGS) {
          if (lowered.includes(forbidden)) {
            throw new Error(`${path}.${key}: mainnet send/broadcast method ${value} is rejected.`);
          }
        }
      }
      scanIntentForSecretsAndMethods(value, `${path}.${key}`);
    }
    return;
  }
  if (typeof node === "string") {
    const lowered = node.toLowerCase();
    // Only reject when the string itself names a forbidden broadcast/signing method.
    // Plain prose is scanned at the raw-text level; structured fields are checked above.
    if (
      lowered === "eth_sendrawtransaction" ||
      lowered === "eth_sendtransaction" ||
      lowered === "personal_sign" ||
      lowered === "eth_signtransaction" ||
      lowered === "eth_signtypeddata"
    ) {
      throw new Error(`${path}: mainnet send/broadcast method ${node} is rejected.`);
    }
  }
}

function assertRawTextHasNoForbiddenMethods(rawText) {
  if (typeof rawText !== "string" || rawText.length === 0) return;
  const lowered = rawText.toLowerCase();
  for (const forbidden of FORBIDDEN_METHOD_SUBSTRINGS) {
    if (lowered.includes(forbidden)) {
      throw new Error(`Deployment intent contains forbidden mainnet send/broadcast method pattern ${forbidden}; rejected.`);
    }
  }
}

function validateAccessList(raw, field) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${field} must be an access list array.`);
  }
  const entries = raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`${field}[${index}] must be an access-list entry.`);
    }
    validateAddress(entry.address, `${field}[${index}].address`);
    const keys = entry.storageKeys ?? [];
    if (!Array.isArray(keys)) {
      throw new Error(`${field}[${index}].storageKeys must be an array.`);
    }
    for (const key of keys) {
      validateBytes32(key, `${field}[${index}].storageKeys entry`);
    }
    return {
      address: entry.address.toLowerCase(),
      storageKeys: [...keys].map((key) => key.toLowerCase()).sort(),
    };
  });
  entries.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  return entries;
}

export function validateIntent(intent, { from, expectedChainId = EXPECTED_CHAIN_ID, rawText = "" } = {}) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
    throw new Error("Deployment intent must be a JSON object.");
  }
  assertRawTextHasNoForbiddenMethods(rawText);
  scanIntentForSecretsAndMethods(intent, "$");

  if (intent.chainId !== expectedChainId) {
    throw new Error(`Deployment intent chainId must be exactly ${expectedChainId}; received ${String(intent.chainId)}.`);
  }
  const deployerRaw = intent.deployer ?? intent.from;
  if (typeof deployerRaw !== "string" || !ADDRESS_PATTERN.test(deployerRaw)) {
    throw new Error("Deployment intent must declare an exact deployer/from 0x address.");
  }
  if (deployerRaw.toLowerCase() === ZERO_ADDRESS) {
    throw new Error("Deployment intent deployer must not be the zero address.");
  }
  if (typeof from === "string" && deployerRaw.toLowerCase() !== from.toLowerCase()) {
    throw new Error(`Deployment intent deployer ${deployerRaw} does not match explicit --from ${from}.`);
  }

  const operations = intent.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("Deployment intent must declare a non-empty operations array.");
  }
  const dependencies = intent.dependencies ?? [];
  if (!Array.isArray(dependencies)) {
    throw new Error("Deployment intent dependencies must be an array.");
  }

  if (intent.feeCaps !== undefined && intent.feeCaps !== null) {
    if (typeof intent.feeCaps !== "object" || Array.isArray(intent.feeCaps)) {
      throw new Error("Deployment intent feeCaps must be an object.");
    }
    for (const field of ["maxFeePerGas", "maxPriorityFeePerGas"]) {
      if (intent.feeCaps[field] !== undefined) {
        parseQuantityToBigInt(intent.feeCaps[field], `feeCaps.${field}`);
      }
    }
  }

  // Top-level declared CREATE targets (explicit allowlist for not-yet-deployed calls).
  const declaredCreateTargets = new Set();
  if (intent.expectedCreateTargets !== undefined && intent.expectedCreateTargets !== null) {
    if (!Array.isArray(intent.expectedCreateTargets)) {
      throw new Error("Deployment intent expectedCreateTargets must be an array of addresses.");
    }
    for (const target of intent.expectedCreateTargets) {
      validateAddress(target, "expectedCreateTargets entry");
      const lowered = target.toLowerCase();
      if (declaredCreateTargets.has(lowered)) {
        throw new Error(`Duplicate declared CREATE target ${target}.`);
      }
      declaredCreateTargets.add(lowered);
    }
  }

  const seenIds = new Set();
  const seenOrders = new Set();
  const seenOpHashes = new Set();
  const normalizedOps = [];

  for (const [index, op] of operations.entries()) {
    const where = `operations[${index}]`;
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      throw new Error(`${where} must be an object.`);
    }
    // Operation-level signature rejection (v/r/s/yParity/signature must be absent or empty).
    for (const sigField of ["signature", "signatures", "rawTransaction", "signedTransaction", "v", "r", "s", "yParity"]) {
      if (Object.hasOwn(op, sigField) && !isEmptySignatureValue(op[sigField])) {
        throw new Error(`${where}.${sigField}: signed transactions and nonempty signatures are rejected.`);
      }
    }
    if (typeof op.id !== "string" || op.id.length === 0) {
      throw new Error(`${where}.id must be a non-empty string.`);
    }
    if (seenIds.has(op.id)) {
      throw new Error(`Duplicate operation id ${op.id}; duplicate operations are rejected.`);
    }
    seenIds.add(op.id);
    if (typeof op.order !== "number" || !Number.isInteger(op.order) || !Number.isSafeInteger(op.order) || op.order < 0) {
      throw new Error(`${where}.order must be a non-negative safe integer; floating numbers are rejected.`);
    }
    if (seenOrders.has(op.order)) {
      throw new Error(`Duplicate operation order ${op.order}; duplicate operations are rejected.`);
    }
    seenOrders.add(op.order);
    if (op.kind !== "CREATE" && op.kind !== "CALL") {
      throw new Error(`${where}.kind must be CREATE or CALL.`);
    }
    if (!Array.isArray(op.predecessors)) {
      throw new Error(`${where}.predecessors must be an array of operation ids.`);
    }
    for (const predecessor of op.predecessors) {
      if (typeof predecessor !== "string" || predecessor.length === 0) {
        throw new Error(`${where}.predecessors entries must be non-empty operation ids.`);
      }
    }
    if (typeof op.value !== "string") {
      throw new Error(`${where}.value must be an explicit decimal or 0x quantity string; missing value transfers are rejected.`);
    }
    const valueBigint = parseQuantityToBigInt(op.value, `${where}.value`);
    if (typeof op.valueDeclared !== "boolean") {
      throw new Error(`${where}.valueDeclared must be an explicit boolean; any value transfer not explicitly declared is rejected.`);
    }
    if (valueBigint !== 0n && op.valueDeclared !== true) {
      throw new Error(`${where}: value transfer of ${op.value} is not explicitly declared; set valueDeclared:true or zero value.`);
    }
    const accessList = validateAccessList(op.accessList ?? [], `${where}.accessList`);

    if (op.kind === "CREATE") {
      if (op.to !== undefined && op.to !== null) {
        throw new Error(`${where}: CREATE transactions must use to:null; calls use CALL.`);
      }
      if (typeof op.initCode !== "string" || op.initCode === "0x" || !HEX_DATA_PATTERN.test(op.initCode)) {
        throw new Error(`${where}: CREATE transactions require exact init code; missing or ambiguous init code is rejected.`);
      }
      if (op.initCode.length <= 2 || op.initCode.length % 2 !== 0) {
        throw new Error(`${where}: CREATE transactions require exact init code with even-length 0x hex.`);
      }
      if (Object.hasOwn(op, "data") && op.data !== undefined && op.data !== null && op.data !== op.initCode) {
        throw new Error(`${where}: CREATE transactions carry initCode only; data must be absent or equal to initCode.`);
      }
      let expectedAddressLower = null;
      if (op.expectedAddress !== undefined && op.expectedAddress !== null) {
        validateAddress(op.expectedAddress, `${where}.expectedAddress`);
        expectedAddressLower = op.expectedAddress.toLowerCase();
        declaredCreateTargets.add(expectedAddressLower);
      }
      normalizedOps.push({
        id: op.id,
        order: op.order,
        kind: "CREATE",
        predecessors: [...op.predecessors],
        initCode: op.initCode.toLowerCase(),
        value: op.value,
        valueBigint,
        valueDeclared: op.valueDeclared,
        accessList,
        expectedAddress: expectedAddressLower,
      });
    } else {
      if (typeof op.to !== "string" || !ADDRESS_PATTERN.test(op.to)) {
        throw new Error(`${where}.to must be an exact 0x address for CALL operations.`);
      }
      if (op.to.toLowerCase() === ZERO_ADDRESS) {
        throw new Error(`${where}.to must not be the zero address.`);
      }
      if (typeof op.data !== "string" || !HEX_DATA_PATTERN.test(op.data)) {
        throw new Error(`${where}.data must be even-length 0x hex data; ambiguous hex quantities are rejected.`);
      }
      if (Object.hasOwn(op, "initCode") && op.initCode !== undefined && op.initCode !== null) {
        throw new Error(`${where}: CALL transactions must not carry initCode.`);
      }
      normalizedOps.push({
        id: op.id,
        order: op.order,
        kind: "CALL",
        predecessors: [...op.predecessors],
        to: op.to.toLowerCase(),
        data: op.data.toLowerCase(),
        value: op.value,
        valueBigint,
        valueDeclared: op.valueDeclared,
        accessList,
      });
    }
  }

  // Canonical order: orders must be exactly 0..n-1 with no gaps.
  const sortedByOrder = [...normalizedOps].sort((a, b) => a.order - b.order);
  for (const [position, op] of sortedByOrder.entries()) {
    if (op.order !== position) {
      throw new Error(`Operation ${op.id} has order ${op.order}; canonical orders must be contiguous 0..${sortedByOrder.length - 1}.`);
    }
  }
  const idToOrder = new Map(sortedByOrder.map((op) => [op.id, op.order]));
  for (const op of sortedByOrder) {
    const seenPredecessors = new Set();
    for (const predecessor of op.predecessors) {
      if (seenPredecessors.has(predecessor)) {
        throw new Error(`Operation ${op.id} lists duplicate predecessor ${predecessor}.`);
      }
      seenPredecessors.add(predecessor);
      if (!idToOrder.has(predecessor)) {
        throw new Error(`Operation ${op.id} references unknown predecessor ${predecessor}.`);
      }
      if (idToOrder.get(predecessor) >= op.order) {
        throw new Error(`Operation ${op.id} predecessor ${predecessor} must have a smaller canonical order.`);
      }
      if (predecessor === op.id) {
        throw new Error(`Operation ${op.id} must not list itself as a predecessor.`);
      }
    }
    if (op.order === 0 && op.predecessors.length !== 0) {
      throw new Error(`Operation ${op.id} is first in canonical order and must declare empty predecessors.`);
    }
    // Duplicate canonical operation content (same kind/to/data/value/initCode) is rejected.
    const contentKey = op.kind === "CREATE"
      ? `CREATE|${op.initCode}|${toHexQuantity(op.valueBigint)}`
      : `CALL|${op.to}|${op.data}|${toHexQuantity(op.valueBigint)}`;
    const contentHash = sha256HexOfString(contentKey);
    if (seenOpHashes.has(contentHash)) {
      throw new Error(`Duplicate operation content for ${op.id}; duplicate operations are rejected.`);
    }
    seenOpHashes.add(contentHash);
  }

  const normalizedDependencies = dependencies.map((dep, index) => {
    const where = `dependencies[${index}]`;
    if (!dep || typeof dep !== "object" || Array.isArray(dep)) {
      throw new Error(`${where} must be an object.`);
    }
    if (typeof dep.name !== "string" || dep.name.length === 0) {
      throw new Error(`${where}.name must be a non-empty string.`);
    }
    validateAddress(dep.address, `${where}.address`);
    validateBytes32(dep.expectedCodeHash, `${where}.expectedCodeHash`);
    return {
      name: dep.name,
      address: dep.address.toLowerCase(),
      expectedCodeHash: dep.expectedCodeHash.toLowerCase(),
    };
  });
  const depNames = new Set();
  const depAddresses = new Set();
  for (const dep of normalizedDependencies) {
    if (depNames.has(dep.name)) {
      throw new Error(`Duplicate dependency name ${dep.name}.`);
    }
    depNames.add(dep.name);
    if (depAddresses.has(dep.address)) {
      throw new Error(`Duplicate dependency address ${dep.address}.`);
    }
    depAddresses.add(dep.address);
  }
  normalizedDependencies.sort((a, b) => a.name.localeCompare(b.name));

  return { operationsSorted: sortedByOrder, dependenciesSorted: normalizedDependencies, declaredCreateTargets };
}

function validateBlockPayload(block, context) {
  if (!block || typeof block.number !== "string" || typeof block.hash !== "string") {
    throw new Error(`${context} is missing its block payload.`);
  }
  if (!HEX_QUANTITY_PATTERN.test(block.number)) {
    throw new Error(`${context} returned a malformed block number; ambiguous hex quantities are rejected.`);
  }
  if (!BYTES32_PATTERN.test(block.hash) || block.hash.toLowerCase() === ZERO_HASH) {
    throw new Error(`${context} returned a malformed block hash.`);
  }
  const number = Number(BigInt(block.number));
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${context} block number is not a safe integer.`);
  }
  return { number, hash: block.hash.toLowerCase(), numberHex: toHexQuantity(BigInt(block.number)) };
}

async function callRpc(transport, method, params) {
  assertAllowedMethod(method);
  if (method === "eth_call" && String(params?.[0]?.to).toLowerCase() !== ARBITRUM_NODE_INTERFACE) {
    throw new Error("eth_call is only allowed against the Arbitrum NodeInterface L1 gas estimator.");
  }
  return transport(method, params);
}

export function createFixtureTransport(fixture) {
  if (!fixture || typeof fixture !== "object") {
    throw new Error("Fixture transport requires a fixture object.");
  }
  return async (method, params = []) => {
    assertAllowedMethod(method);
    switch (method) {
      case "eth_chainId":
        return fixture.chainIdHex ?? EXPECTED_CHAIN_ID_HEX;
      case "eth_getBlockByNumber": {
        const tag = params[0];
        if (tag === "latest") {
          if (!fixture.latestBlock) throw new Error("Fixture is missing latestBlock.");
          return fixture.latestBlock;
        }
        if (!fixture.pinnedBlock) throw new Error("Fixture is missing pinnedBlock.");
        return fixture.pinnedBlock;
      }
      case "eth_getTransactionCount": {
        const tag = params[1];
        if (tag === "latest") return fixture.nonceLatestHex ?? fixture.noncePinnedHex;
        return fixture.noncePinnedHex;
      }
      case "eth_getCode": {
        const address = String(params[0]).toLowerCase();
        const tag = params[1];
        const entry = fixture.codes?.[address];
        if (!entry) return "0x";
        if (tag === "latest") return entry.latest ?? entry.pinned;
        return entry.pinned ?? entry.latest;
      }
      case "eth_estimateGas": {
        if (fixture.failEstimate) {
          throw new Error("eth_estimateGas failed (fixture injected estimate failure).");
        }
        const tag = params[1];
        if (tag === "latest") return fixture.estimateLatestHex ?? fixture.estimatePinnedHex;
        return fixture.estimatePinnedHex;
      }
      case "eth_feeHistory":
        if (!fixture.feeHistory) throw new Error("Fixture is missing feeHistory.");
        return fixture.feeHistory;
      case "eth_call": {
        if (String(params[0]?.to).toLowerCase() !== ARBITRUM_NODE_INTERFACE) {
          throw new Error("Fixture eth_call is only served for the Arbitrum NodeInterface.");
        }
        const l1 = BigInt(fixture.l1ComponentHex ?? "0x0").toString(16);
        return `0x${l1.padStart(64, "0")}${"0".repeat(128)}`;
      }
      case "eth_maxPriorityFeePerGas":
        if (!fixture.maxPriorityFeeHex) throw new Error("Fixture is missing maxPriorityFeeHex.");
        return fixture.maxPriorityFeeHex;
      default:
        throw new Error(`Fixture has no canned response for ${method}.`);
    }
  };
}

// Arbitrum's NodeInterface virtual contract. eth_call is only ever sent here, to read the L1 data-posting gas
// component that a local Anvil fork cannot model.
export const ARBITRUM_NODE_INTERFACE = "0x00000000000000000000000000000000000000c8";

function abiWord(hexWithoutPrefix) {
  return hexWithoutPrefix.padStart(64, "0");
}

export function encodeGasEstimateL1Component({ to, contractCreation, data }) {
  const selector = keccak256HexOfBytes(new TextEncoder().encode("gasEstimateL1Component(address,bool,bytes)")).slice(2, 10);
  const payload = data.slice(2);
  const padded = payload.padEnd(Math.ceil(payload.length / 64) * 64, "0");
  return `0x${selector}${abiWord((to ?? ZERO_ADDRESS).slice(2))}${abiWord(contractCreation ? "1" : "0")}${abiWord("60")}${abiWord((payload.length / 2).toString(16))}${padded}`;
}

async function estimateL1ComponentGas(transport, op, blockTag) {
  const request = {
    to: ARBITRUM_NODE_INTERFACE,
    data: encodeGasEstimateL1Component({
      to: op.kind === "CREATE" ? null : op.to,
      contractCreation: op.kind === "CREATE",
      data: op.kind === "CREATE" ? op.initCode : op.data,
    }),
  };
  const raw = await callRpc(transport, "eth_call", [request, blockTag]);
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{192}$/.test(raw)) {
    throw new Error(`NodeInterface L1 component for ${op.id} is malformed.`);
  }
  return BigInt(`0x${raw.slice(2, 66)}`);
}

export async function buildBundle({
  intent,
  intentRawText = "",
  from,
  pinnedBlockNumber,
  expectedChainId = EXPECTED_CHAIN_ID,
  transport,
  sequentialEstimates = null,
  timestamp = new Date().toISOString(),
}) {
  if (typeof transport !== "function") {
    throw new Error("A JSON-RPC transport function is required; network mode needs explicit inputs and tests use a fake transport.");
  }
  if (!Number.isSafeInteger(pinnedBlockNumber) || pinnedBlockNumber <= 0) {
    throw new Error("Pinned block must be a positive safe integer; decimal pinned block input is required.");
  }
  validateAddress(from, "--from");
  const fromLower = from.toLowerCase();

  const { operationsSorted, dependenciesSorted, declaredCreateTargets } = validateIntent(intent, {
    from: fromLower,
    expectedChainId,
    rawText: intentRawText,
  });
  // Exact source-intent hash over order-independent canonical intent: operations
  // sorted by canonical order and dependencies sorted by name, keys sorted.
  const canonicalIntentForHash = {
    ...canonicalize(intent),
    operations: [...operationsSorted].map((op) => {
      const raw = intent.operations.find((entry) => entry?.id === op.id);
      return canonicalize(raw);
    }),
    dependencies: dependenciesSorted.map((dep) => {
      const raw = (intent.dependencies ?? []).find((entry) => entry?.name === dep.name);
      return canonicalize(raw ?? dep);
    }),
  };
  const sourceIntentHash = sha256HexOfString(JSON.stringify(canonicalIntentForHash));

  const chainIdHex = await callRpc(transport, "eth_chainId", []);
  if (typeof chainIdHex !== "string" || !HEX_QUANTITY_PATTERN.test(chainIdHex)) {
    throw new Error("eth_chainId returned a malformed quantity; ambiguous hex quantities are rejected.");
  }
  const chainId = Number(BigInt(chainIdHex));
  if (chainId !== expectedChainId) {
    throw new Error(`RPC must resolve to Arbitrum One: expected chain ID ${expectedChainId}, received ${chainId}.`);
  }

  const pinnedHex = toHexQuantity(BigInt(pinnedBlockNumber));
  const pinnedBlock = validateBlockPayload(await callRpc(transport, "eth_getBlockByNumber", [pinnedHex, false]), "Pinned block");
  if (pinnedBlock.number !== pinnedBlockNumber) {
    throw new Error(`Pinned block mismatch: requested ${pinnedBlockNumber}, received ${pinnedBlock.number}.`);
  }
  const latestBlock = validateBlockPayload(await callRpc(transport, "eth_getBlockByNumber", ["latest", false]), "Latest block");
  if (latestBlock.number === 0) {
    throw new Error("Rejected zero latest block number from the Arbitrum One RPC.");
  }
  if (pinnedBlockNumber > latestBlock.number) {
    throw new Error(`Pinned block ${pinnedBlockNumber} is ahead of latest block ${latestBlock.number}.`);
  }

  const noncePinnedHex = await callRpc(transport, "eth_getTransactionCount", [fromLower, pinnedHex]);
  const nonceLatestHex = await callRpc(transport, "eth_getTransactionCount", [fromLower, "latest"]);
  for (const [label, raw] of [["Pinned nonce", noncePinnedHex], ["Latest nonce", nonceLatestHex]]) {
    if (typeof raw !== "string" || !HEX_QUANTITY_PATTERN.test(raw)) {
      throw new Error(`${label} is malformed; ambiguous hex quantities are rejected.`);
    }
  }
  const noncePinned = BigInt(noncePinnedHex);
  const nonceLatest = BigInt(nonceLatestHex);
  if (noncePinned !== nonceLatest) {
    throw new Error(`Nonce drift for ${fromLower}: pinned ${noncePinnedHex} differs from latest ${nonceLatestHex}; bundle would be stale.`);
  }
  if (noncePinned < 0n || noncePinned > 0xffffffffn) {
    throw new Error(`Nonce ${noncePinnedHex} is out of range.`);
  }
  const baseNonce = Number(noncePinned);

  const dependencyEvidence = [];
  for (const dep of dependenciesSorted) {
    const pinnedCodeRaw = await callRpc(transport, "eth_getCode", [dep.address, pinnedHex]);
    const latestCodeRaw = await callRpc(transport, "eth_getCode", [dep.address, "latest"]);
    validateHexData(pinnedCodeRaw, `${dep.name} pinned bytecode`);
    validateHexData(latestCodeRaw, `${dep.name} latest bytecode`);
    if (pinnedCodeRaw === "0x") {
      throw new Error(`Missing-code configuration: ${dep.name} has no bytecode at pinned block ${pinnedBlockNumber}.`);
    }
    if (latestCodeRaw === "0x") {
      throw new Error(`Missing-code configuration: ${dep.name} has no bytecode at latest block ${latestBlock.number}.`);
    }
    const pinnedLower = pinnedCodeRaw.toLowerCase();
    const latestLower = latestCodeRaw.toLowerCase();
    const pinnedCodeHash = codeHashForHex(pinnedLower);
    const latestCodeHash = codeHashForHex(latestLower);
    if (pinnedLower !== latestLower || pinnedCodeHash !== latestCodeHash) {
      throw new Error(`Code-hash drift for ${dep.name} between pinned block ${pinnedBlockNumber} and latest block ${latestBlock.number}; rejected.`);
    }
    if (pinnedCodeHash !== dep.expectedCodeHash) {
      throw new Error(`Runtime code hash mismatch for ${dep.name} at pinned block ${pinnedBlockNumber}; expected ${dep.expectedCodeHash}, observed ${pinnedCodeHash}.`);
    }
    dependencyEvidence.push({
      address: dep.address,
      codeStable: true,
      expectedCodeHash: dep.expectedCodeHash,
      latestCodeHash,
      matchesExpected: true,
      name: dep.name,
      pinnedCodeHash,
    });
  }

  // CALL targets must have code at both blocks unless explicitly declared CREATE targets.
  for (const op of operationsSorted) {
    if (op.kind !== "CALL") continue;
    const pinnedCodeRaw = await callRpc(transport, "eth_getCode", [op.to, pinnedHex]);
    const latestCodeRaw = await callRpc(transport, "eth_getCode", [op.to, "latest"]);
    validateHexData(pinnedCodeRaw, `CALL target ${op.to} pinned bytecode`);
    validateHexData(latestCodeRaw, `CALL target ${op.to} latest bytecode`);
    const hasPinned = pinnedCodeRaw !== "0x";
    const hasLatest = latestCodeRaw !== "0x";
    if (!hasPinned || !hasLatest) {
      const targetLower = op.to.toLowerCase();
      if (!declaredCreateTargets.has(targetLower)) {
        throw new Error(`CALL ${op.id} targets ${op.to} without code; calls to accounts without code are rejected unless the target is an explicitly declared CREATE target.`);
      }
      const creator = operationsSorted.find(
        (candidate) => candidate.kind === "CREATE" && candidate.expectedAddress === targetLower && candidate.order < op.order,
      );
      if (!creator) {
        throw new Error(`CALL ${op.id} targets not-yet-deployed ${op.to} without a lower-order declared CREATE operation; rejected.`);
      }
      continue;
    }
    if (pinnedCodeRaw.toLowerCase() !== latestCodeRaw.toLowerCase()) {
      throw new Error(`Code-hash drift for CALL target ${op.to} of ${op.id} between pinned and latest blocks; rejected.`);
    }
  }

  const transactions = [];
  for (const [index, op] of operationsSorted.entries()) {
    const txForEstimate = op.kind === "CREATE"
      ? { from: fromLower, data: op.initCode, value: toHexQuantity(op.valueBigint) }
      : { from: fromLower, to: op.to, data: op.data, value: toHexQuantity(op.valueBigint) };
    if (op.accessList.length > 0) {
      txForEstimate.accessList = op.accessList;
    }
    let pinnedEstimateRaw;
    let latestEstimateRaw;
    let l1Component = null;
    if (sequentialEstimates) {
      // Dependent operations were estimated in order on local forks of the pinned and latest blocks. Local forks
      // only meter L2 execution, so the Arbitrum L1 data-posting component is read from NodeInterface and added.
      const estimate = sequentialEstimates.get(op.id);
      if (!estimate) throw new Error(`Sequential fork estimate is missing for ${op.id}.`);
      l1Component = {
        pinned: await estimateL1ComponentGas(transport, op, pinnedHex),
        latest: await estimateL1ComponentGas(transport, op, "latest"),
      };
      pinnedEstimateRaw = toHexQuantity(estimate.pinned + l1Component.pinned);
      latestEstimateRaw = toHexQuantity(estimate.latest + l1Component.latest);
    } else {
      try {
        pinnedEstimateRaw = await callRpc(transport, "eth_estimateGas", [txForEstimate, pinnedHex]);
      } catch (error) {
        throw new Error(`eth_estimateGas failed for ${op.id} at pinned block ${pinnedBlockNumber}: ${error.message}`);
      }
      try {
        latestEstimateRaw = await callRpc(transport, "eth_estimateGas", [txForEstimate, "latest"]);
      } catch (error) {
        throw new Error(`eth_estimateGas failed for ${op.id} at latest block ${latestBlock.number}: ${error.message}`);
      }
    }
    for (const [label, raw] of [[`${op.id} pinned estimate`, pinnedEstimateRaw], [`${op.id} latest estimate`, latestEstimateRaw]]) {
      if (typeof raw !== "string" || !HEX_QUANTITY_PATTERN.test(raw)) {
        throw new Error(`${label} is malformed; ambiguous hex quantities are rejected.`);
      }
    }
    const pinnedEstimate = BigInt(pinnedEstimateRaw);
    const latestEstimate = BigInt(latestEstimateRaw);
    if (pinnedEstimate <= 0n || latestEstimate <= 0n) {
      throw new Error(`eth_estimateGas returned zero gas for ${op.id}; rejected.`);
    }
    if (pinnedEstimate > MAX_ESTIMATE_GAS || latestEstimate > MAX_ESTIMATE_GAS) {
      throw new Error(`eth_estimateGas for ${op.id} exceeds the ${MAX_ESTIMATE_GAS} gas budgeting cap; rejected.`);
    }
    const chosenGas = pinnedEstimate > latestEstimate ? pinnedEstimate : latestEstimate;
    transactions.push({
      op,
      estimatedGasPinned: toHexQuantity(pinnedEstimate),
      estimatedGasLatest: toHexQuantity(latestEstimate),
      l1Component,
      chosenGas,
      nonce: baseNonce + index,
    });
  }

  const feeHistoryRaw = await callRpc(transport, "eth_feeHistory", ["0x4", "latest", [50]]);
  const priorityRaw = await callRpc(transport, "eth_maxPriorityFeePerGas", []);
  const baseFeeList = feeHistoryRaw?.baseFeePerGas;
  if (!Array.isArray(baseFeeList) || baseFeeList.length === 0) {
    throw new Error("eth_feeHistory returned no base-fee data.");
  }
  for (const entry of baseFeeList) {
    if (typeof entry !== "string" || !HEX_QUANTITY_PATTERN.test(entry)) {
      throw new Error("eth_feeHistory returned a malformed base-fee quantity; ambiguous hex quantities are rejected.");
    }
  }
  if (typeof priorityRaw !== "string" || !HEX_QUANTITY_PATTERN.test(priorityRaw)) {
    throw new Error("eth_maxPriorityFeePerGas returned a malformed quantity; ambiguous hex quantities are rejected.");
  }
  const baseFee = BigInt(baseFeeList[baseFeeList.length - 1]);
  const priorityFee = BigInt(priorityRaw);
  if (baseFee <= 0n) {
    throw new Error("eth_feeHistory returned a zero base fee; rejected.");
  }
  if (priorityFee < 0n) {
    throw new Error("eth_maxPriorityFeePerGas returned a negative fee; rejected.");
  }
  const maxFee = 2n * baseFee + priorityFee;
  if (maxFee <= 0n) {
    throw new Error("Derived max fee per gas is not positive; rejected.");
  }
  if (intent.feeCaps?.maxFeePerGas !== undefined) {
    const cap = parseQuantityToBigInt(intent.feeCaps.maxFeePerGas, "feeCaps.maxFeePerGas");
    if (maxFee > cap) {
      throw new Error(`Live max fee per gas ${toHexQuantity(maxFee)} exceeds declared fee cap ${intent.feeCaps.maxFeePerGas}; rejected.`);
    }
  }
  if (intent.feeCaps?.maxPriorityFeePerGas !== undefined) {
    const cap = parseQuantityToBigInt(intent.feeCaps.maxPriorityFeePerGas, "feeCaps.maxPriorityFeePerGas");
    if (priorityFee > cap) {
      throw new Error(`Live priority fee ${toHexQuantity(priorityFee)} exceeds declared fee cap; rejected.`);
    }
  }
  const maxFeeHex = toHexQuantity(maxFee);
  const priorityHex = toHexQuantity(priorityFee);
  const baseFeeHex = toHexQuantity(baseFee);

  const unsignedTransactions = [];
  let aggregateMaxFee = 0n;
  let aggregateValue = 0n;
  for (const entry of transactions) {
    const maxCost = entry.chosenGas * maxFee + entry.op.valueBigint;
    aggregateMaxFee += entry.chosenGas * maxFee;
    aggregateValue += entry.op.valueBigint;
    unsignedTransactions.push({
      accessList: entry.op.accessList,
      chainId: EXPECTED_CHAIN_ID_HEX,
      data: entry.op.kind === "CREATE" ? entry.op.initCode : entry.op.data,
      estimatedGasLatest: entry.estimatedGasLatest,
      estimatedGasPinned: entry.estimatedGasPinned,
      ...(entry.l1Component
        ? {
            estimatedL1GasLatest: toHexQuantity(entry.l1Component.latest),
            estimatedL1GasPinned: toHexQuantity(entry.l1Component.pinned),
          }
        : {}),
      from: fromLower,
      gas: toHexQuantity(entry.chosenGas),
      id: entry.op.id,
      kind: entry.op.kind,
      maxCostWei: maxCost.toString(10),
      maxFeePerGas: maxFeeHex,
      maxPriorityFeePerGas: priorityHex,
      nonce: toHexQuantity(BigInt(entry.nonce)),
      nonceDecimal: entry.nonce,
      order: entry.op.order,
      predecessors: [...entry.op.predecessors],
      to: entry.op.kind === "CREATE" ? null : entry.op.to,
      type: "0x2",
      value: toHexQuantity(entry.op.valueBigint),
    });
  }
  const aggregateRequirement = aggregateMaxFee + aggregateValue;
  const reserveRequirement = aggregateRequirement * BigInt(RESERVE_MULTIPLIER);

  const deterministicPart = {
    broadcast: false,
    chainId: expectedChainId,
    dependencies: dependencyEvidence,
    estimationMode: sequentialEstimates ? "sequential-local-fork-plus-l1-component" : "independent-rpc",
    feeEvidence: {
      baseFeePerGas: baseFeeHex,
      maxFeePerGas: maxFeeHex,
      maxPriorityFeePerGas: priorityHex,
      sources: ["eth_feeHistory", "eth_maxPriorityFeePerGas"],
    },
    from: fromLower,
    gasBudget: {
      aggregateMaxFeeWei: aggregateMaxFee.toString(10),
      aggregateRequirementWei: aggregateRequirement.toString(10),
      aggregateValueWei: aggregateValue.toString(10),
      reserveMultiplier: RESERVE_MULTIPLIER,
      reserveRequirementHex: toHexQuantity(reserveRequirement),
      reserveRequirementWei: reserveRequirement.toString(10),
    },
    harnessVersion: HARNESS_VERSION,
    latestBlock: { hash: latestBlock.hash, number: latestBlock.number },
    launchApproval: false,
    nonce: {
      base: baseNonce,
      baseHex: toHexQuantity(BigInt(baseNonce)),
      latest: nonceLatestHex.toLowerCase(),
      pinned: noncePinnedHex.toLowerCase(),
    },
    notes: "Unsigned read-only Arbitrum One production transaction bundle with gas budget. No transactions sent, signed, broadcast, or chain writes performed. Fund nothing until explicit launch approval.",
    pinnedBlock: { hash: pinnedBlock.hash, number: pinnedBlock.number },
    readOnly: true,
    rpcMethodsUsed: [...ALLOWED_RPC_METHODS],
    signaturesRequested: 0,
    signed: false,
    sourceIntentHash,
    tool: TOOL_NAME,
    transactions: unsignedTransactions,
    transactionsSent: 0,
  };
  const bundleHash = sha256HexOfString(canonicalJson(deterministicPart));
  return { ...deterministicPart, bundleHash, generatedAt: timestamp };
}

// CLI input guards (also unit-tested).
export function assertExplicitRpcUrl(raw) {
  if (!raw) {
    throw new Error("Explicit --rpc-url is required for Arbitrum One unsigned-bundle construction.");
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
    throw new Error(`Rejected local RPC configuration: --rpc-url must use https for Arbitrum One (received ${parsed.protocol}).`);
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

export function assertPinnedBlockNumber(raw) {
  if (!raw) {
    throw new Error("Explicit --block-number is required.");
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid --block-number ${raw}: must be a decimal integer.`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid --block-number ${raw}: must be a positive safe integer.`);
  }
  return value;
}

export function assertFromAddress(raw) {
  if (!raw || typeof raw !== "string" || !ADDRESS_PATTERN.test(raw)) {
    throw new Error("Explicit --from must be a 0x address.");
  }
  if (raw.toLowerCase() === ZERO_ADDRESS) {
    throw new Error("Explicit --from must not be the zero address.");
  }
  return raw;
}
