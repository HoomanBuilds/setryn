#!/usr/bin/env node
// Build the complete unsigned Arbitrum One deployment intent from a planning-only Foundry simulation.
//
// - Runs contracts/script/PlanArbitrumOneDeployment.s.sol with --sig "plan()" against a local fork of the pinned
//   Arbitrum One block and never passes --broadcast. The script itself refuses broadcast and resume contexts.
// - Converts Foundry's dry-run transaction list, including linked-library deployments, exact linked creation code
//   with constructor arguments, and every configuration call, into canonical intent operations.
// - Never signs, broadcasts, unlocks accounts, funds accounts, or writes to any chain. No private key is read:
//   key-bearing environment variables are removed from the child process.
// - Output stays inside deployments/arbitrum-one/qualification/.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertExplicitRpcUrl, assertPinnedBlockNumber } from "./lib/unsigned-bundle.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "deployments/arbitrum-one/manifest.json"), "utf8"));
const inventory = JSON.parse(readFileSync(resolve(repositoryRoot, "deployments/phase2-contract-inventory.json"), "utf8"));
const outputPath = resolve(repositoryRoot, "deployments/arbitrum-one/qualification/arbitrum-one-unsigned-deployment-intent.json");
const dryRunDirectory = resolve(repositoryRoot, "contracts/broadcast/PlanArbitrumOneDeployment.s.sol/42161/dry-run");

const CHAIN_ID = 42161;
// Foundry deploys linked libraries through the deterministic CREATE2 deployer with a 32-byte salt prefix.
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
// Keyless planning sender with no code and nonce 0 at the pinned block. Never an approved deployer.
const PLANNING_SENDER = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const PLANNING_PRINCIPALS = {
  bootstrapAdmin: PLANNING_SENDER,
  governanceAdmin: "0xa4b1000000000000000000000000000000000001",
  governanceOperator: "0xa4b1000000000000000000000000000000000002",
  guardian: "0xa4b1000000000000000000000000000000000003",
  excessRecovery: "0xa4b1000000000000000000000000000000000004",
  privacyKeyPublisher: "0xa4b1000000000000000000000000000000000005",
  lifecycleWitnessStager: "0xa4b1000000000000000000000000000000000006",
};
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

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith("--") || index + 1 >= argv.length) throw new Error(`Invalid argument: ${argv[index]}`);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  return options;
}

function cast(args) {
  return execFileSync("cast", args, { encoding: "utf8" }).trim();
}

function keylessEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/PRIVATE_KEY|MNEMONIC|KEYSTORE|PASSWORD|ETH_FROM/i.test(name)) delete environment[name];
  }
  return environment;
}

function latestDryRun() {
  const files = readdirSync(dryRunDirectory)
    .filter((file) => file.endsWith("-latest.json"))
    .map((file) => resolve(dryRunDirectory, file))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (files.length === 0) throw new Error("Planning simulation produced no dry-run transaction file.");
  return JSON.parse(readFileSync(files[0], "utf8"));
}

// DeploySetryn creates every contract and library from its standalone full-build artifact, so each creation matches
// a linked artifact exactly. A creation Foundry leaves unnamed is identified by that exact match, else by the unique
// production contract whose complete external selector set appears in the init code.
function artifactPathFor(contractName) {
  const sourceName = contractName.endsWith("PayoffModule")
    ? "ProductionPayoffModules"
    : contractName.endsWith("ReceiptAuthority")
      ? "ProtocolReceiptAuthorities"
      : contractName;
  return resolve(repositoryRoot, `contracts/out/${sourceName}.sol/${contractName}.json`);
}

function linkedCreationCode(artifact, libraryAddresses) {
  let code = artifact.bytecode.object.toLowerCase();
  for (const [source, libraries] of Object.entries(artifact.bytecode.linkReferences ?? {})) {
    for (const [library, references] of Object.entries(libraries)) {
      const address = libraryAddresses.get(`${source}:${library}`);
      if (!address) throw new Error(`Library ${library} was not deployed by the simulation.`);
      for (const { start, length } of references) {
        const offset = 2 + start * 2;
        code = code.slice(0, offset) + address.slice(2) + code.slice(offset + length * 2);
      }
    }
  }
  return code;
}

function resolveUnnamedCreation(input, libraryAddresses, candidateNames) {
  const artifacts = candidateNames
    .map((name) => ({ name, path: artifactPathFor(name) }))
    .filter(({ path }) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .map(({ name, path }) => ({ name, artifact: JSON.parse(readFileSync(path, "utf8")) }))
    .filter(({ artifact }) => artifact.bytecode?.object?.length > 2);
  const exact = artifacts.filter(({ artifact }) => {
    try {
      return input.startsWith(linkedCreationCode(artifact, libraryAddresses));
    } catch {
      return false;
    }
  });
  if (exact.length === 1) return exact[0].name;
  const bySelectors = artifacts
    .map(({ name, artifact }) => {
      const selectors = Object.values(artifact.methodIdentifiers ?? {}).map((selector) => selector.toLowerCase());
      return { name, count: selectors.length, complete: selectors.every((selector) => input.includes(selector)) };
    })
    .filter(({ count, complete }) => count >= 4 && complete)
    .sort((left, right) => right.count - left.count);
  if (bySelectors.length === 0 || bySelectors[0].count === bySelectors[1]?.count) {
    throw new Error("Unable to identify an unnamed contract creation.");
  }
  return bySelectors[0].name;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const rpcUrl = assertExplicitRpcUrl(options["rpc-url"]);
  const pinnedBlock = assertPinnedBlockNumber(options["block-number"] ?? String(manifest.blockReference.number));
  if (pinnedBlock !== manifest.blockReference.number) {
    throw new Error(`Planning must use the manifest's pinned block ${manifest.blockReference.number}.`);
  }
  const pinnedHash = cast(["block", String(pinnedBlock), "--field", "hash", "--rpc-url", rpcUrl]).toLowerCase();
  if (pinnedHash !== manifest.blockReference.hash.toLowerCase()) {
    throw new Error(`Pinned block hash mismatch: manifest ${manifest.blockReference.hash}, RPC ${pinnedHash}.`);
  }
  const senderNonce = Number(cast(["nonce", PLANNING_SENDER, "--block", String(pinnedBlock), "--rpc-url", rpcUrl]));
  const senderCode = cast(["code", PLANNING_SENDER, "--block", String(pinnedBlock), "--rpc-url", rpcUrl]);
  if (senderCode !== "0x") throw new Error("Planning sender must not have code at the pinned block.");
  const create2DeployerCode = cast(["code", CREATE2_DEPLOYER, "--block", String(pinnedBlock), "--rpc-url", rpcUrl]);
  if (create2DeployerCode === "0x") throw new Error("CREATE2 deployer has no code at the pinned block.");
  const create2DeployerCodeHash = cast(["keccak", create2DeployerCode]).toLowerCase();

  execFileSync(
    "forge",
    [
      "script",
      "script/PlanArbitrumOneDeployment.s.sol:PlanArbitrumOneDeployment",
      "--sig",
      "plan()",
      "--root",
      resolve(repositoryRoot, "contracts"),
      "--fork-url",
      rpcUrl,
      "--fork-block-number",
      String(pinnedBlock),
      "--sender",
      PLANNING_SENDER,
      "--fork-retries",
      "12",
      "--fork-retry-backoff",
      "3000",
      "--compute-units-per-second",
      "200",
      "--non-interactive",
    ],
    { cwd: resolve(repositoryRoot, "contracts"), stdio: ["ignore", "ignore", "inherit"], env: keylessEnvironment() },
  );

  const dryRun = latestDryRun();
  if (Number(dryRun.chain) !== CHAIN_ID) throw new Error(`Dry run chain ${dryRun.chain} is not Arbitrum One.`);
  const libraryNames = new Set((inventory.linkedLibraries ?? []).map(({ name }) => name));
  const names = new Map(manifest.externalDependencies.map(({ name, address }) => [address.toLowerCase(), name]));
  const operations = [];
  const counts = new Map();
  // Libraries are created in dependency order through the CREATE2 deployer; each is identified by its exact linked
  // init code and then linked into every later creation.
  const libraryAddresses = new Map();
  const librarySources = new Map(
    [...libraryNames].map((name) => {
      const artifact = JSON.parse(readFileSync(artifactPathFor(name), "utf8"));
      const [source] = Object.entries(artifact.metadata?.settings?.compilationTarget ?? {}).find(([, target]) => target === name) ?? [];
      if (!source) throw new Error(`Library ${name} artifact has no compilation target.`);
      return [name, { source, artifact }];
    }),
  );
  let expectedNonce = senderNonce;
  for (const entry of dryRun.transactions) {
    const transaction = entry.transaction;
    if (transaction.from?.toLowerCase() !== PLANNING_SENDER) throw new Error("Dry run contains a non-planning sender.");
    if (Number(transaction.nonce) !== expectedNonce) {
      throw new Error(`Dry run nonce ${Number(transaction.nonce)} is not the expected ${expectedNonce}.`);
    }
    expectedNonce += 1;
    const value = transaction.value ?? "0x0";
    if (BigInt(value) !== 0n) throw new Error("Deployment graph must not transfer value.");
    let op;
    if (entry.transactionType === "CREATE") {
      const contractName =
        entry.contractName ??
        resolveUnnamedCreation(
          transaction.input.toLowerCase(),
          libraryAddresses,
          inventory.contracts.map(({ name }) => name),
        );
      const address = entry.contractAddress.toLowerCase();
      names.set(address, contractName);
      op = { kind: "CREATE", base: contractName, initCode: transaction.input.toLowerCase(), expectedAddress: address };
    } else if (entry.transactionType === "CREATE2") {
      const to = transaction.to?.toLowerCase();
      if (to !== CREATE2_DEPLOYER) throw new Error(`CREATE2 deployment ${entry.contractAddress} is not via the CREATE2 deployer.`);
      const input = transaction.input.toLowerCase();
      const salt = `0x${input.slice(2, 66)}`;
      const initCode = `0x${input.slice(66)}`;
      const matches = [...librarySources].filter(([, { artifact }]) => {
        try {
          return initCode === linkedCreationCode(artifact, libraryAddresses);
        } catch {
          return false;
        }
      });
      if (matches.length !== 1) throw new Error(`CREATE2 deployment ${entry.contractAddress} is not exactly one declared library.`);
      const [libraryName, { source }] = matches[0];
      if (entry.contractName && entry.contractName !== libraryName) {
        throw new Error(`Foundry named ${entry.contractName} but the init code is ${libraryName}.`);
      }
      entry.contractName = libraryName;
      const address = entry.contractAddress.toLowerCase();
      libraryAddresses.set(`${source}:${libraryName}`, address);
      const derived = cast(["compute-address", CREATE2_DEPLOYER, "--salt", salt, "--init-code", initCode])
        .match(/0x[0-9a-fA-F]{40}/)?.[0]
        ?.toLowerCase();
      if (derived !== address) throw new Error(`Library ${entry.contractName} CREATE2 address ${address} != ${derived}.`);
      const existingCode = cast(["code", address, "--block", String(pinnedBlock), "--rpc-url", rpcUrl]);
      if (existingCode !== "0x") throw new Error(`Library ${entry.contractName} address ${address} already has code.`);
      names.set(address, entry.contractName);
      op = {
        kind: "CALL",
        base: entry.contractName,
        to,
        data: input,
        create2: { deployer: to, salt, initCodeHash: cast(["keccak", initCode]).toLowerCase(), expectedAddress: address },
      };
    } else if (entry.transactionType === "CALL") {
      const to = transaction.to.toLowerCase();
      const target = names.get(to);
      if (!target) throw new Error(`Configuration call targets unknown address ${to}.`);
      const method = (entry.function ?? transaction.input.slice(0, 10)).split("(")[0];
      op = { kind: "CALL", base: `${target}.${method}`, to, data: transaction.input.toLowerCase() };
    } else {
      throw new Error(`Unsupported dry-run transaction type ${entry.transactionType}.`);
    }
    const count = (counts.get(op.base) ?? 0) + 1;
    counts.set(op.base, count);
    const id = count === 1 ? op.base : `${op.base}#${count}`;
    const order = operations.length;
    operations.push({
      id,
      order,
      kind: op.kind,
      predecessors: order === 0 ? [] : [operations[order - 1].id],
      ...(op.kind === "CREATE"
        ? { initCode: op.initCode, expectedAddress: op.expectedAddress, linkedLibrary: false }
        : { to: op.to, data: op.data, ...(op.create2 ? { linkedLibrary: true, create2: op.create2 } : {}) }),
      value: "0x0",
      valueDeclared: false,
      accessList: [],
    });
  }
  // Every declared library the graph links must be deployed by this intent.
  const deployed = new Set(operations.filter((op) => op.kind === "CREATE" || op.linkedLibrary).map((op) => op.id));
  for (const library of inventory.linkedLibraries ?? []) {
    const needed = library.linkedBy.some((name) => deployed.has(name));
    if (needed && !deployed.has(library.name)) throw new Error(`Linked library ${library.name} is not deployed.`);
  }

  const creates = operations.filter((op) => op.kind === "CREATE");
  const libraries = operations.filter((op) => op.linkedLibrary);
  const intent = {
    protocol: "setryn-arbitrum-one-deployment-intent",
    version: "2.0.0",
    chainId: CHAIN_ID,
    deployer: PLANNING_SENDER,
    unsigned: true,
    planningOnly: true,
    broadcast: false,
    signed: false,
    readOnly: true,
    transactionsSent: 0,
    pinnedBlockReference: pinnedBlock,
    pinnedBlockHash: pinnedHash,
    planningSenderNote:
      "Keyless planning sender used only for local fork simulation and eth_estimateGas. Not an approved deployer. Do not fund without explicit launch approval.",
    principalsNote:
      "All principals are planning-only placeholders with the A4B1 marker, distinct as DeploySetryn separation checks require. Not approved governance or operator addresses.",
    deploymentParameters: {
      ...PLANNING_PARAMS,
      deploymentId: cast(["keccak", "SetrynArbitrumOneUnsignedPlanningV1"]).toLowerCase(),
      ...PLANNING_PRINCIPALS,
      sequencerUptimeFeed: "0xfdb631f5ee196f0ed6faa767959853a9f217697d",
    },
    source: {
      deploymentScript: "contracts/script/DeploySetryn.s.sol",
      planningScript: "contracts/script/PlanArbitrumOneDeployment.s.sol",
      note:
        "Operations are Foundry's dry-run of DeploySetryn._deployAndWire on a local fork of the pinned block: the complete production graph with linked libraries, exact linked creation code and constructor arguments, and every wiring, role, revocation, and admin-transfer call in order.",
      addressDerivation: `Nonce-based CREATE addresses from the planning sender starting at its pinned nonce ${senderNonce}. Linked libraries use CREATE2 through ${CREATE2_DEPLOYER} with the recorded salt, so their addresses are sender-independent.`,
      libraryNote:
        "Each library operation is a CALL to the deterministic CREATE2 deployer whose data is salt || linked init code. Before any approved signing, re-check that every library address is still empty or already holds the identical runtime code; an occupied address makes that CALL revert and must be dropped from the signed sequence.",
    },
    counts: {
      operations: operations.length,
      contractCreations: creates.length,
      libraryCreations: libraries.length,
      configurationCalls: operations.length - creates.length - libraries.length,
    },
    baseNonceAssumed: senderNonce,
    expectedCreateTargets: creates.map((op) => op.expectedAddress),
    expectedLibraryTargets: libraries.map((op) => op.create2.expectedAddress),
    dependencies: [
      ...manifest.externalDependencies.map(({ name, address, runtimeCodeHash }) => ({
        name,
        address: address.toLowerCase(),
        expectedCodeHash: runtimeCodeHash.toLowerCase(),
      })),
      ...(libraries.length > 0
        ? [{ name: "Create2Deployer", address: CREATE2_DEPLOYER, expectedCodeHash: create2DeployerCodeHash }]
        : []),
    ],
    operations,
    notes:
      "Unsigned planning-only Arbitrum One deployment intent. Broadcast false. No private keys or signatures. Network fees are estimated separately in the bundle. Protocol capital such as collateral, keeper, oracle, and insurance budgets is not part of this intent and needs separate approval.",
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(intent, null, 2)}\n`);
  process.stdout.write(
    `Wrote planning intent with ${intent.counts.contractCreations} contract creations, ${intent.counts.libraryCreations} library creations, and ${intent.counts.configurationCalls} configuration calls.\n`,
  );
}

main();
