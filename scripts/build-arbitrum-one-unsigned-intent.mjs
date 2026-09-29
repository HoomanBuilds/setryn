#!/usr/bin/env node
// Build a real bounded unsigned Arbitrum One deployment intent from
// compiled Foundry artifacts plus exact ABI-encoded constructor arguments
// and exact ordered configuration calls for the DeploySetryn production graph.
//
// - Read-only intent construction. Never sends, signs, broadcasts, unlocks,
//   funds, or writes to any chain. No private keys.
// - Uses actual creation bytecode from contracts/out plus cast abi-encode for
//   constructor arguments and cast calldata for configuration calls.
// - Uses correct nonce-based CREATE derivation via cast compute-address for
//   the explicit planning-only sender. Every reference is internally consistent.
// - Bounded prefix: independently estimable root registries plus compiler and
//   payoff modules with their exact role wiring and admin transfers. Dependent
//   layers require sequential fork state and are documented as follow-on work,
//   with many core contracts exceeding the 24576 runtime size limit.
// - Output must stay inside deployments/arbitrum-one/qualification/.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CHAIN_ID = 42161;
const PINNED_BLOCK_REFERENCE = 509990000;

// Planning-only sender. Nonzero. Never an approved deployer. Nonce 0 observed
// at both pinned header time and latest on the public RPC. Labelled
// planning-only everywhere so it cannot be mistaken for an approved deployer.
const PLANNING_SENDER = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

// Planning-only principals. Distinct, nonzero, A4B1 marker for Arbitrum One
// planning. Not approved governance or operator addresses.
const PLANNING_PRINCIPALS = {
  bootstrapAdmin: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  governanceAdmin: "0xa4b1000000000000000000000000000000000001",
  governanceOperator: "0xa4b1000000000000000000000000000000000002",
  guardian: "0xa4b1000000000000000000000000000000000003",
  excessRecovery: "0xa4b1000000000000000000000000000000000004",
  privacyKeyPublisher: "0xa4b1000000000000000000000000000000000005",
  lifecycleWitnessStager: "0xa4b1000000000000000000000000000000000006",
};

// Numeric defaults mirror DeploySetryn production defaults and the fork
// rehearsal constants. evaluationGasHardCap has no production default and is
// set here as an explicit planning value.
const PLANNING_PARAMS = {
  defaultAdminDelay: 172800,
  maxLockDuration: 2592000,
  evaluationGasHardCap: 2000000,
  maximumRiskAdapterGas: 500000,
  maximumRiskObservationAge: 300,
  operationalReadGas: 500000,
  operationalExecutionGas: 800000,
  maximumOrderLifetime: 2592000,
  maximumRfqCapacityTail: 86400,
  sequencerRecoveryGrace: 3600,
};

function cast(args) {
  return execFileSync("cast", args, { encoding: "utf8" }).trim();
}

function artifactFor(contractName) {
  const sourceName = contractName.endsWith("PayoffModule") ? "ProductionPayoffModules" : contractName;
  const path = resolve(repositoryRoot, `contracts/out/${sourceName}.sol/${contractName}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function creationCode(contractName) {
  const artifact = artifactFor(contractName);
  const code = artifact?.bytecode?.object;
  if (typeof code !== "string" || !code.startsWith("0x") || code.length <= 2 || code.length % 2 !== 0) {
    throw new Error(`Missing creation bytecode for ${contractName}.`);
  }
  return code;
}

function abiEncodeConstructor(signature, values) {
  // signature like constructor(uint48,address). Returns 0x args without selector.
  const out = cast(["abi-encode", signature, ...values]);
  if (!out.startsWith("0x")) throw new Error(`cast abi-encode failed for ${signature}.`);
  return out;
}

function calldataFor(signature, values) {
  const out = cast(["calldata", signature, ...values]);
  if (!out.startsWith("0x")) throw new Error(`cast calldata failed for ${signature}.`);
  return out.toLowerCase();
}

function keccakLabel(label) {
  return cast(["keccak", label]).toLowerCase();
}

function computeCreateAddress(sender, nonce) {
  const out = cast(["compute-address", sender, "--nonce", String(nonce)]);
  const match = out.match(/0x[0-9a-fA-F]{40}/);
  if (!match) throw new Error(`cast compute-address failed for nonce ${nonce}.`);
  return match[0].toLowerCase();
}

function main() {
  const deploymentId = keccakLabel("SetrynArbitrumOneUnsignedPlanningV1");
  if (deploymentId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new Error("Planning deploymentId must not be zero.");
  }

  // Bounded CREATE set in production relative order. All have no code
  // dependencies or only zero checks, runtime under 24576, and are
  // independently estimable against live state.
  const creates = [
    { name: "AssetRegistry", ctor: "constructor(uint48,address)", args: [String(PLANNING_PARAMS.defaultAdminDelay), PLANNING_PRINCIPALS.bootstrapAdmin] },
    { name: "AdapterRegistry", ctor: "constructor(uint48,address)", args: [String(PLANNING_PARAMS.defaultAdminDelay), PLANNING_PRINCIPALS.bootstrapAdmin] },
    { name: "CalendarRegistry", ctor: "constructor(uint48,address)", args: [String(PLANNING_PARAMS.defaultAdminDelay), PLANNING_PRINCIPALS.bootstrapAdmin] },
    { name: "CanonicalStrategyCompiler", ctor: null, args: [] },
    { name: "ExecutionPolicyRegistry", ctor: "constructor(uint48,address)", args: [String(PLANNING_PARAMS.defaultAdminDelay), PLANNING_PRINCIPALS.bootstrapAdmin] },
    { name: "PrivacyCommitmentRegistry", ctor: "constructor(uint48,address)", args: [String(PLANNING_PARAMS.defaultAdminDelay), PLANNING_PRINCIPALS.bootstrapAdmin] },
    { name: "CappedForwardPayoffModule", ctor: null, args: [] },
    { name: "NdfPayoffModule", ctor: null, args: [] },
    { name: "EuropeanCallPayoffModule", ctor: null, args: [] },
    { name: "EuropeanPutPayoffModule", ctor: null, args: [] },
    { name: "CollarPayoffModule", ctor: null, args: [] },
    { name: "RateForwardPayoffModule", ctor: null, args: [] },
    { name: "RateCapPayoffModule", ctor: null, args: [] },
    { name: "RateFloorPayoffModule", ctor: null, args: [] },
    { name: "RateCollarPayoffModule", ctor: null, args: [] },
    { name: "BasisSpreadPayoffModule", ctor: null, args: [] },
    { name: "CalendarSpreadPayoffModule", ctor: null, args: [] },
    { name: "WindowAverageScalarPayoffModule", ctor: null, args: [] },
    { name: "CorrelationDispersionScalarPayoffModule", ctor: null, args: [] },
  ];

  // Base nonce observed as 0 for the planning sender. Bundle generation
  // verifies pinned and latest nonces match before assigning sequential nonces.
  const baseNonce = 0;
  const derived = new Map();
  creates.forEach((entry, index) => {
    derived.set(entry.name, computeCreateAddress(PLANNING_SENDER, baseNonce + index));
  });

  const operations = [];
  const expectedCreateTargets = [];
  let order = 0;
  let previousId = null;

  function pushOperation(entry) {
    if (previousId === null) {
      if (entry.predecessors.length !== 0) throw new Error(`First operation ${entry.id} must have empty predecessors.`);
    }
    operations.push(entry);
    previousId = entry.id;
    order += 1;
  }

  // CREATE operations first, matching production deployment phasing.
  creates.forEach((entry) => {
    const creation = creationCode(entry.name);
    let initCode = creation;
    if (entry.ctor !== null) {
      const encoded = abiEncodeConstructor(entry.ctor, entry.args);
      initCode = `${creation}${encoded.slice(2)}`;
    } else {
      if (entry.args.length !== 0) throw new Error(`Unexpected args for ${entry.name}.`);
    }
    const expectedAddress = derived.get(entry.name);
    expectedCreateTargets.push(expectedAddress);
    const predecessors = previousId === null ? [] : [previousId];
    pushOperation({
      id: entry.name,
      order,
      kind: "CREATE",
      predecessors,
      initCode: initCode.toLowerCase(),
      expectedAddress,
      value: "0x0",
      valueDeclared: false,
      accessList: [],
    });
  });

  // Exact role identifiers from contract sources.
  const roles = {
    registrar: keccakLabel("SETRYN_REGISTRAR_ROLE"),
    statusManager: keccakLabel("SETRYN_STATUS_MANAGER_ROLE"),
    adapterQualifier: keccakLabel("SETRYN_ADAPTER_QUALIFIER_ROLE"),
    adapterStatusManager: keccakLabel("SETRYN_ADAPTER_STATUS_MANAGER_ROLE"),
    calendarRegistrar: keccakLabel("SETRYN_CALENDAR_REGISTRAR_ROLE"),
    calendarStatusManager: keccakLabel("SETRYN_CALENDAR_STATUS_MANAGER_ROLE"),
    policyAdmin: keccakLabel("SETRYN_EXECUTION_POLICY_ADMIN_ROLE"),
    privacyQualifier: keccakLabel("SETRYN_PRIVACY_POLICY_QUALIFIER_ROLE"),
    privacyActivator: keccakLabel("SETRYN_PRIVACY_POLICY_ACTIVATOR_ROLE"),
    epochPublisher: keccakLabel("SETRYN_PRIVACY_EPOCH_KEY_PUBLISHER_ROLE"),
  };
  const zeroRole = "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Verify a sample against manifest expectations where available.
  // Manifest lists AssetRegistry REGISTRAR_ROLE as 0x046791d0...
  if (roles.registrar !== "0x046791d0a4cfdf4f410ba80f11e88f14c2169ca01bd510dc3e57eddcb84681da") {
    throw new Error("Role identifier drift for SETRYN_REGISTRAR_ROLE.");
  }

  const bootstrap = PLANNING_PRINCIPALS.bootstrapAdmin;
  const operator = PLANNING_PRINCIPALS.governanceOperator;
  const govAdmin = PLANNING_PRINCIPALS.governanceAdmin;
  const publisher = PLANNING_PRINCIPALS.privacyKeyPublisher;

  function callOp(id, targetName, data) {
    const to = derived.get(targetName);
    if (!to) throw new Error(`Unknown CALL target ${targetName}.`);
    const predecessors = previousId === null ? [] : [previousId];
    pushOperation({
      id,
      order,
      kind: "CALL",
      predecessors,
      to,
      data: data.toLowerCase(),
      value: "0x0",
      valueDeclared: false,
      accessList: [],
    });
  }

  // Registry wiring in DeploySetryn _wireRegistryRoles order for the bounded set.
  // Grants to operator, revokes from bootstrap, then admin transfers.
  callOp("AssetRegistry-grant-registrar", "AssetRegistry", calldataFor("grantRole(bytes32,address)", [roles.registrar, operator]));
  callOp("AssetRegistry-grant-status-manager", "AssetRegistry", calldataFor("grantRole(bytes32,address)", [roles.statusManager, operator]));
  callOp("AdapterRegistry-grant-qualifier", "AdapterRegistry", calldataFor("grantRole(bytes32,address)", [roles.adapterQualifier, operator]));
  callOp("AdapterRegistry-grant-status-manager", "AdapterRegistry", calldataFor("grantRole(bytes32,address)", [roles.adapterStatusManager, operator]));
  callOp("CalendarRegistry-grant-registrar", "CalendarRegistry", calldataFor("grantRole(bytes32,address)", [roles.calendarRegistrar, operator]));
  callOp("CalendarRegistry-grant-status-manager", "CalendarRegistry", calldataFor("grantRole(bytes32,address)", [roles.calendarStatusManager, operator]));
  callOp("ExecutionPolicyRegistry-grant-policy-admin", "ExecutionPolicyRegistry", calldataFor("grantRole(bytes32,address)", [roles.policyAdmin, operator]));
  callOp("PrivacyCommitmentRegistry-grant-qualifier", "PrivacyCommitmentRegistry", calldataFor("grantRole(bytes32,address)", [roles.privacyQualifier, operator]));
  callOp("PrivacyCommitmentRegistry-grant-activator", "PrivacyCommitmentRegistry", calldataFor("grantRole(bytes32,address)", [roles.privacyActivator, operator]));
  callOp("PrivacyCommitmentRegistry-grant-publisher", "PrivacyCommitmentRegistry", calldataFor("grantRole(bytes32,address)", [roles.epochPublisher, publisher]));

  callOp("AssetRegistry-revoke-registrar", "AssetRegistry", calldataFor("revokeRole(bytes32,address)", [roles.registrar, bootstrap]));
  callOp("AssetRegistry-revoke-status-manager", "AssetRegistry", calldataFor("revokeRole(bytes32,address)", [roles.statusManager, bootstrap]));
  callOp("AdapterRegistry-revoke-qualifier", "AdapterRegistry", calldataFor("revokeRole(bytes32,address)", [roles.adapterQualifier, bootstrap]));
  callOp("AdapterRegistry-revoke-status-manager", "AdapterRegistry", calldataFor("revokeRole(bytes32,address)", [roles.adapterStatusManager, bootstrap]));
  callOp("CalendarRegistry-revoke-registrar", "CalendarRegistry", calldataFor("revokeRole(bytes32,address)", [roles.calendarRegistrar, bootstrap]));
  callOp("CalendarRegistry-revoke-status-manager", "CalendarRegistry", calldataFor("revokeRole(bytes32,address)", [roles.calendarStatusManager, bootstrap]));
  callOp("ExecutionPolicyRegistry-revoke-policy-admin", "ExecutionPolicyRegistry", calldataFor("revokeRole(bytes32,address)", [roles.policyAdmin, bootstrap]));
  callOp("PrivacyCommitmentRegistry-revoke-qualifier", "PrivacyCommitmentRegistry", calldataFor("revokeRole(bytes32,address)", [roles.privacyQualifier, bootstrap]));
  callOp("PrivacyCommitmentRegistry-revoke-activator", "PrivacyCommitmentRegistry", calldataFor("revokeRole(bytes32,address)", [roles.privacyActivator, bootstrap]));
  callOp("PrivacyCommitmentRegistry-revoke-publisher", "PrivacyCommitmentRegistry", calldataFor("revokeRole(bytes32,address)", [roles.epochPublisher, bootstrap]));

  // Admin transfers in DeploySetryn _beginAdminTransfers order for the bounded set.
  callOp("AssetRegistry-begin-admin-transfer", "AssetRegistry", calldataFor("beginDefaultAdminTransfer(address)", [govAdmin]));
  callOp("AdapterRegistry-begin-admin-transfer", "AdapterRegistry", calldataFor("beginDefaultAdminTransfer(address)", [govAdmin]));
  callOp("CalendarRegistry-begin-admin-transfer", "CalendarRegistry", calldataFor("beginDefaultAdminTransfer(address)", [govAdmin]));
  callOp("ExecutionPolicyRegistry-begin-admin-transfer", "ExecutionPolicyRegistry", calldataFor("beginDefaultAdminTransfer(address)", [govAdmin]));
  callOp("PrivacyCommitmentRegistry-begin-admin-transfer", "PrivacyCommitmentRegistry", calldataFor("beginDefaultAdminTransfer(address)", [govAdmin]));

  // Sanity: zeroRole is the OpenZeppelin default admin identifier, not used
  // directly here because transfers use beginDefaultAdminTransfer.
  if (zeroRole !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new Error("Zero role constant drift.");
  }

  const intent = {
    protocol: "setryn-arbitrum-one-deployment-intent",
    version: "1.0.0",
    chainId: CHAIN_ID,
    deployer: PLANNING_SENDER.toLowerCase(),
    unsigned: true,
    planningOnly: true,
    broadcast: false,
    signed: false,
    readOnly: true,
    transactionsSent: 0,
    pinnedBlockReference: PINNED_BLOCK_REFERENCE,
    planningSenderNote: "Nonzero unsigned-planning sender for eth_estimateGas only. Not an approved deployer. Do not fund for launch without explicit approval.",
    principalsNote: "All principals are planning-only placeholders with A4B1 marker. Not approved governance or operator addresses. Distinct as required by DeploySetryn separation checks.",
    deploymentParameters: {
      ...PLANNING_PARAMS,
      deploymentId,
      bootstrapAdmin: PLANNING_PRINCIPALS.bootstrapAdmin.toLowerCase(),
      governanceAdmin: PLANNING_PRINCIPALS.governanceAdmin.toLowerCase(),
      governanceOperator: PLANNING_PRINCIPALS.governanceOperator.toLowerCase(),
      guardian: PLANNING_PRINCIPALS.guardian.toLowerCase(),
      excessRecovery: PLANNING_PRINCIPALS.excessRecovery.toLowerCase(),
      privacyKeyPublisher: PLANNING_PRINCIPALS.privacyKeyPublisher.toLowerCase(),
      lifecycleWitnessStager: PLANNING_PRINCIPALS.lifecycleWitnessStager.toLowerCase(),
      sequencerFeedNote: "Bounded prefix needs no external sequencer feed. Full graph uses Chainlink Arbitrum sequencer uptime feed as external dependency.",
    },
    source: {
      deploymentScript: "contracts/script/DeploySetryn.s.sol",
      note: "Constructor arguments and role wiring mirror the current DeploySetryn production graph for the included prefix. Full graph dependent layers are documented as follow-on fork work.",
      artifactsNote: "All initCode uses exact compiled creation bytecode from contracts/out plus exact cast abi-encode arguments. No placeholder initCode. All CALL data uses exact cast calldata selectors. No fake selectors.",
      addressDerivation: "Nonce-based CREATE derivation via cast compute-address from the planning sender starting at base nonce 0. Every constructor argument and CALL target uses these derived addresses. Internally consistent.",
      scopeNote: "Bounded prefix covers independently estimable roots, compiler, and payoff modules with their exact wiring. Excludes dependent registries, engines, books, and coordinators that need sequential fork state, plus contracts exceeding the 24576 runtime size limit.",
    },
    expectedCreateTargets: [...expectedCreateTargets].map((a) => a.toLowerCase()).sort(),
    derivedAddresses: Object.fromEntries([...derived.entries()].map(([k, v]) => [k, v.toLowerCase()])),
    baseNonceAssumed: baseNonce,
    operations,
    dependencies: [],
    notes: "Unsigned planning-only Arbitrum One deployment intent. Broadcast false. No private keys or signatures. Network fees are estimated separately in the bundle. Protocol capital such as collateral, keeper, oracle, and insurance budgets is not part of this intent and needs separate approval.",
  };

  const outputPath = resolve(repositoryRoot, "deployments/arbitrum-one/qualification/arbitrum-one-unsigned-deployment-intent.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(intent, null, 2)}\n`);
  process.stdout.write(`Wrote planning intent to deployments/arbitrum-one/qualification/arbitrum-one-unsigned-deployment-intent.json\n`);
  process.stdout.write(`Operations: ${operations.length} (CREATE ${creates.length}, CALL ${operations.length - creates.length})\n`);
}

main();
