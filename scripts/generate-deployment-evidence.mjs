#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const phase2Inventory = readJson(resolve(repositoryRoot, "deployments/phase2-contract-inventory.json"));
const phase2ContractNames = new Set(phase2Inventory.contracts.map(({name}) => name));
const phase2Contracts = new Map(phase2Inventory.contracts.map((contract) => [contract.name, contract]));
const linkedLibraries = new Map((phase2Inventory.linkedLibraries ?? []).map((library) => [library.name, library]));
const environments = {
  local: {
    chainIds: [1337, 31337],
    template: "deployments/arbitrum-sepolia/manifest.json",
    output: "deployments/local/manifest.json",
  },
  "arbitrum-sepolia": {
    chainIds: [421614],
    template: "deployments/arbitrum-sepolia/manifest.json",
    output: "deployments/arbitrum-sepolia/manifest.json",
  },
};

function usage() {
  process.stdout.write(`Usage:
  pnpm contracts:deployment:evidence -- --environment <local|arbitrum-sepolia> --rpc-url <url> --broadcast <run-latest.json> [--output <manifest.json>]

Reads a completed Foundry broadcast artifact, checks the target chain, reads deployed bytecode at
the final broadcast block, and writes deployment evidence conforming to the tracked manifest schema.
Arbitrum One is intentionally unsupported. This command performs read-only JSON-RPC calls.
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
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
  return execFileSync("cast", ["keccak", hexValue], {encoding: "utf8"}).trim();
}

function sha256(value) {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function requiredPrincipal(source) {
  const address = process.env[source];
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`${source} must be provided as a deployment evidence environment variable.`);
  }
  return address.toLowerCase();
}

function principalSource(address, principals, contracts) {
  const principal = Object.entries(principals).find(([, value]) => value === address);
  if (principal) return manifestPrincipalSource(principal[0]);
  const contract = [...contracts.entries()].find(([, value]) => value?.toLowerCase() === address.toLowerCase());
  if (contract) return `$contracts.${contract[0]}.address`;
  throw new Error(`No evidence source for role member ${address}`);
}

function manifestPrincipalSource(name) {
  const sources = {
    governanceAdmin: "SETRYN_GOVERNANCE_ADMIN",
    governanceOperator: "SETRYN_GOVERNANCE_OPERATOR",
    guardian: "SETRYN_GUARDIAN",
    excessRecoveryOperator: "SETRYN_EXCESS_RECOVERY_OPERATOR",
    privacyKeyPublisher: "SETRYN_PRIVACY_KEY_PUBLISHER",
    lifecycleWitnessStager: "SETRYN_LIFECYCLE_WITNESS_STAGER",
  };
  return sources[name];
}

function calldata(signature, values = []) {
  return execFileSync("cast", ["calldata", signature, ...values], {encoding: "utf8"}).trim();
}

async function ethCall(rpcUrl, to, data, blockTag) {
  return rpc(rpcUrl, "eth_call", [{to, data}, blockTag]);
}

function roleId(label) {
  return execFileSync("cast", ["keccak", label], {encoding: "utf8"}).trim();
}

async function verifyRole(rpcUrl, addresses, blockTag, check, bootstrap) {
  const target = addresses.get(check.contractName);
  const member = addresses.get(check.memberContract) ?? check.member;
  if (!target || !member) throw new Error(`Cannot resolve role evidence for ${check.contractName}.${check.role}`);
  const id = roleId(check.label);
  const expected = await ethCall(rpcUrl, target, calldata("hasRole(bytes32,address)", [id, member]), blockTag);
  if (BigInt(expected) !== 1n) throw new Error(`${check.contractName}.${check.role} is not held by ${member}`);
  const bootstrapState = await ethCall(rpcUrl, target, calldata("hasRole(bytes32,address)", [id, bootstrap]), blockTag);
  if (BigInt(bootstrapState) !== 0n) throw new Error(`${check.contractName}.${check.role} remains held by bootstrap`);
  return {contractName: check.contractName, role: check.role, roleId: id, member};
}

function transactionHash(transaction) {
  return transaction.hash ?? transaction.transactionHash ?? null;
}

function receiptByHash(receipts) {
  return new Map(receipts.map((receipt) => [receipt.transactionHash?.toLowerCase(), receipt]));
}

function artifactFor(contractName) {
  return readJson(resolve(repositoryRoot, artifactPathFor(contractName)));
}

/// Creation code with every linked library placeholder replaced by the recorded library address.
function linkedCreationCode(artifact, libraryAddresses) {
  let code = artifact.bytecode.object.toLowerCase();
  for (const libraries of Object.values(artifact.bytecode.linkReferences ?? {})) {
    for (const [name, references] of Object.entries(libraries)) {
      const address = libraryAddresses.get(name);
      if (!address) throw new Error(`Linked library ${name} has no recorded deployment.`);
      for (const {start, length} of references) {
        code = code.slice(0, 2 + start * 2) + address.slice(2).toLowerCase() + code.slice(2 + (start + length) * 2);
      }
    }
  }
  if (code.includes("__$")) throw new Error("Creation code still contains an unlinked library placeholder.");
  return code;
}

const CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";

/// The deployment creates linked libraries itself by calling the deterministic CREATE2 deployer with a 32-byte salt
/// and the linked init code, dependencies first. Each call is identified by exact init code against the declared
/// libraries, and its address is derived from the salt and init code, so later libraries link against it.
function normalizeLibraryDeployments(transactions, libraryAddresses) {
  return transactions.map((transaction) => {
    const to = transaction.transaction?.to?.toLowerCase();
    const viaDeployer = transaction.transactionType === "CALL" || transaction.transactionType === "CREATE2";
    if (!viaDeployer || to !== CREATE2_DEPLOYER) return transaction;
    const input = transaction.transaction.input.toLowerCase();
    const salt = `0x${input.slice(2, 66)}`;
    const initCode = `0x${input.slice(66)}`;
    const matches = [...linkedLibraries.keys()].filter((name) => {
      try {
        return initCode === linkedCreationCode(artifactFor(name), libraryAddresses);
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) {
      throw new Error(`CREATE2 deployer call ${transactionHash(transaction)} does not match exactly one declared library.`);
    }
    if (transaction.contractName && transaction.contractName !== matches[0]) {
      throw new Error(`Foundry named ${transaction.contractName} but the init code is ${matches[0]}.`);
    }
    const address = execFileSync("cast", ["compute-address", CREATE2_DEPLOYER, "--salt", salt, "--init-code", initCode], {
      encoding: "utf8",
    })
      .match(/0x[0-9a-fA-F]{40}/)?.[0]
      ?.toLowerCase();
    if (!address) throw new Error(`Unable to derive the CREATE2 address for library ${matches[0]}.`);
    if (transaction.contractAddress && transaction.contractAddress.toLowerCase() !== address) {
      throw new Error(`Library ${matches[0]} was recorded at ${transaction.contractAddress} but derives to ${address}.`);
    }
    libraryAddresses.set(matches[0], address);
    return {...transaction, transactionType: "CREATE2", contractName: matches[0], contractAddress: address};
  });
}

function linkedLibraryNames(artifact) {
  return Object.values(artifact.bytecode.linkReferences ?? {}).flatMap((libraries) => Object.keys(libraries)).sort();
}

function resolveCreateIdentity(transaction, libraryAddresses) {
  if (transaction.contractName) return transaction;
  const input = transaction.transaction?.input?.toLowerCase();
  if (!input?.startsWith("0x")) throw new Error("Unidentified contract creation has no input bytecode.");
  const candidates = [...phase2ContractNames, ...linkedLibraries.keys()];
  const exactMatches = candidates.filter((contractName) => {
    const artifact = artifactFor(contractName);
    if (!artifact.bytecode?.object || artifact.bytecode.object === "0x") return false;
    try {
      return input.startsWith(linkedCreationCode(artifact, libraryAddresses));
    } catch {
      return false;
    }
  });
  if (exactMatches.length === 1) {
    const creationCode = linkedCreationCode(artifactFor(exactMatches[0]), libraryAddresses);
    return {
      ...transaction,
      contractName: exactMatches[0],
      arguments: [{encoding: "abi", data: `0x${input.slice(creationCode.length)}`}],
    };
  }
  const selectorMatches = [...phase2ContractNames]
    .map((contractName) => {
      const selectors = Object.values(artifactFor(contractName).methodIdentifiers ?? {}).map((selector) =>
        selector.toLowerCase(),
      );
      return {contractName, selectors, score: selectors.filter((selector) => input.includes(selector)).length};
    })
    .filter(({selectors, score}) => selectors.length >= 4 && score === selectors.length)
    .sort((first, second) => second.score - first.score);
  if (selectorMatches.length === 0 || selectorMatches[0].score === selectorMatches[1]?.score) {
    throw new Error(`Unable to identify contract creation at ${transaction.contractAddress}.`);
  }
  return {
    ...transaction,
    contractName: selectorMatches[0].contractName,
    arguments: [{encoding: "unavailable", deploymentInputHash: sha256(input)}],
  };
}

function artifactPathFor(contractName) {
  const sourceName = contractName.endsWith("PayoffModule")
    ? "ProductionPayoffModules"
    : contractName.endsWith("ReceiptAuthority")
      ? "ProtocolReceiptAuthorities"
      : contractName;
  return `contracts/out/${sourceName}.sol/${contractName}.json`;
}

function sourceCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function compilerMetadata(artifact) {
  const metadata = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
  return {
    name: "solc",
    version: metadata.compiler.version,
    evmVersion: metadata.settings.evmVersion,
    optimizer: {
      enabled: metadata.settings.optimizer.enabled,
      runs: metadata.settings.optimizer.runs,
    },
    viaIR: metadata.settings.viaIR === true,
    bytecodeHashMode: metadata.settings.metadata?.bytecodeHash ?? "none",
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const environment = environments[options.environment];
  if (!environment || !options["rpc-url"] || !options.broadcast) {
    usage();
    throw new Error("Environment, RPC URL, and Foundry broadcast artifact are required.");
  }

  execFileSync(
    process.execPath,
    [resolve(repositoryRoot, "scripts/validate-deployment-manifests.mjs"), "--manifest", environment.template],
    {cwd: repositoryRoot, stdio: "inherit"},
  );

  const rpcUrl = options["rpc-url"];
  const chainId = Number.parseInt(await rpc(rpcUrl, "eth_chainId"), 16);
  if (chainId === 42161) {
    throw new Error("Arbitrum One evidence generation is disabled until launch approval.");
  }
  if (!environment.chainIds.includes(chainId)) {
    throw new Error(`Environment ${options.environment} does not permit chain ID ${chainId}.`);
  }

  const broadcastPath = resolve(repositoryRoot, options.broadcast);
  const broadcast = readJson(broadcastPath);
  const templatePath = resolve(repositoryRoot, environment.template);
  const manifest = structuredClone(readJson(templatePath));
  const reusableLibraryEvidence = new Map();
  if (manifest.chainId === chainId) {
    for (const library of manifest.linkedLibraries ?? []) {
      if (!linkedLibraries.has(library.name)) {
        throw new Error(`Template records undeclared library ${library.name}.`);
      }
      reusableLibraryEvidence.set(library.name, library);
    }
  }
  // Linked libraries are recorded by Foundry as `path:Name:address`; every one must be a declared library.
  const libraryAddresses = new Map(
    [...reusableLibraryEvidence.entries()].map(([name, library]) => [name, library.address.toLowerCase()]),
  );
  for (const entry of broadcast.libraries ?? []) {
    const [, name, address] = entry.split(":");
    if (!linkedLibraries.has(name)) throw new Error(`Broadcast links undeclared library ${name}.`);
    const reusableAddress = libraryAddresses.get(name);
    if (reusableAddress && reusableAddress !== address.toLowerCase()) {
      throw new Error(`Broadcast links ${name} at ${address}, but reusable evidence records ${reusableAddress}.`);
    }
    libraryAddresses.set(name, address.toLowerCase());
  }
  const transactions = normalizeLibraryDeployments(broadcast.transactions, libraryAddresses);
  const allCreates = transactions
    .filter((transaction) => transaction.transactionType === "CREATE" || transaction.transactionType === "CREATE2")
    .map((transaction) => resolveCreateIdentity(transaction, libraryAddresses));
  const libraryCreates = allCreates.filter((transaction) => linkedLibraries.has(transaction.contractName));
  const creates = allCreates.filter((transaction) => !linkedLibraries.has(transaction.contractName));
  const receipts = receiptByHash(broadcast.receipts ?? []);
  if (creates.length === 0) {
    throw new Error("Broadcast artifact contains no contract creation transactions.");
  }

  const blockNumbers = (broadcast.receipts ?? []).map((receipt) => {
    if (!receipt?.blockNumber) throw new Error("Broadcast receipt is missing its block number.");
    return Number.parseInt(receipt.blockNumber, 16);
  });
  const finalBlockNumber = Math.max(...blockNumbers);
  const blockTag = `0x${finalBlockNumber.toString(16)}`;
  const finalBlock = await rpc(rpcUrl, "eth_getBlockByNumber", [blockTag, false]);

  if (options.environment === "local") {
    manifest.externalDependencies = [];
  }
  const templateContracts = new Map(manifest.contracts.map((contract) => [contract.name, contract]));
  manifest.phase2.deployments = [];
  let compiler;

  const libraryEvidence = [];
  for (const transaction of libraryCreates) {
    const receipt = receipts.get(transactionHash(transaction).toLowerCase());
    const address = (transaction.contractAddress ?? receipt.contractAddress).toLowerCase();
    const recorded = libraryAddresses.get(transaction.contractName);
    if (recorded && recorded !== address) {
      throw new Error(`Library ${transaction.contractName} was linked at ${recorded} but deployed at ${address}.`);
    }
    libraryAddresses.set(transaction.contractName, address);
    const artifact = artifactFor(transaction.contractName);
    let input = transaction.transaction?.input?.toLowerCase();
    if (transaction.transactionType === "CREATE2") {
      // Foundry deploys libraries through the deterministic CREATE2 deployer: 32-byte salt, then init code.
      const deployer = transaction.transaction.to.toLowerCase();
      const salt = `0x${input.slice(2, 66)}`;
      input = `0x${input.slice(66)}`;
      const derived = execFileSync(
        "cast",
        ["compute-address", deployer, "--salt", salt, "--init-code", input],
        {encoding: "utf8"},
      ).match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase();
      if (derived !== address) {
        throw new Error(`Library ${transaction.contractName} CREATE2 address ${address} does not derive from its init code.`);
      }
    }
    if (!input?.startsWith(linkedCreationCode(artifact, libraryAddresses))) {
      throw new Error(`Library ${transaction.contractName} deployment input does not match its linked creation code.`);
    }
    const runtimeCode = await rpc(rpcUrl, "eth_getCode", [address, blockTag]);
    if (runtimeCode === "0x") throw new Error(`No bytecode found for library ${transaction.contractName} at ${address}.`);
    libraryEvidence.push({
      name: transaction.contractName,
      artifact: artifactPathFor(transaction.contractName),
      address,
      creationCodeHash: keccak(linkedCreationCode(artifact, libraryAddresses)),
      runtimeCodeHash: keccak(runtimeCode),
      transactionHash: transactionHash(transaction),
      blockNumber: Number.parseInt(receipt.blockNumber, 16),
      linkedLibraries: linkedLibraryNames(artifact),
      linkedBy: linkedLibraries.get(transaction.contractName).linkedBy,
    });
  }
  for (const name of libraryAddresses.keys()) {
    if (!libraryEvidence.some((library) => library.name === name)) {
      const reusable = reusableLibraryEvidence.get(name);
      if (!reusable || reusable.address.toLowerCase() !== libraryAddresses.get(name)) {
        throw new Error(`Linked library ${name} has neither a deployment transaction nor reusable evidence.`);
      }
      const artifact = artifactFor(name);
      const creationCodeHash = keccak(linkedCreationCode(artifact, libraryAddresses));
      if (creationCodeHash !== reusable.creationCodeHash) {
        throw new Error(`Reusable library ${name} creation code no longer matches its recorded deployment.`);
      }
      const runtimeCode = await rpc(rpcUrl, "eth_getCode", [reusable.address, blockTag]);
      if (runtimeCode === "0x") throw new Error(`No bytecode found for reusable library ${name} at ${reusable.address}.`);
      const runtimeCodeHash = keccak(runtimeCode);
      if (runtimeCodeHash !== reusable.runtimeCodeHash) {
        throw new Error(`Reusable library ${name} runtime code no longer matches its recorded deployment.`);
      }
      libraryEvidence.push({
        ...reusable,
        address: reusable.address.toLowerCase(),
        creationCodeHash,
        runtimeCodeHash,
        linkedLibraries: linkedLibraryNames(artifact),
        linkedBy: linkedLibraries.get(name).linkedBy,
      });
    }
  }
  libraryEvidence.sort((first, second) => first.name.localeCompare(second.name));

  for (const transaction of creates) {
    const contract = templateContracts.get(transaction.contractName);
    if (!contract && !phase2ContractNames.has(transaction.contractName)) {
      throw new Error(`No Phase 2 inventory entry exists for ${transaction.contractName}.`);
    }
    const receipt = receipts.get(transactionHash(transaction).toLowerCase());
    const address = transaction.contractAddress ?? receipt.contractAddress;
    const runtimeCode = await rpc(rpcUrl, "eth_getCode", [address, blockTag]);
    if (runtimeCode === "0x") {
      throw new Error(`No bytecode found for ${transaction.contractName} at ${address}.`);
    }

    const artifact = artifactFor(transaction.contractName);
    compiler ??= compilerMetadata(artifact);
    const creationCode = linkedCreationCode(artifact, libraryAddresses);
    // Selector-resolved creations already carry unavailable constructor arguments; exact identities must match.
    const selectorResolved = transaction.arguments?.[0]?.encoding === "unavailable";
    if (!selectorResolved && !transaction.transaction?.input?.toLowerCase().startsWith(creationCode)) {
      throw new Error(`${transaction.contractName} deployment input does not match its linked creation code.`);
    }
    if (!contract) {
      const inventory = phase2Contracts.get(transaction.contractName);
      const constructorArguments = transaction.arguments ?? [];
      const configurationHash = sha256({
        chainId,
        contractName: transaction.contractName,
        constructorArguments,
        dependencies: inventory.dependencies,
      });
      const capabilityHash = sha256({
        contractName: transaction.contractName,
        roleAuthority: inventory.roleAuthority,
        supported: inventory.supported,
        disabled: inventory.disabled,
      });
      const runtimeCodeHash = keccak(runtimeCode);
      const deploymentEvidence = {
        name: transaction.contractName,
        artifact: artifactPathFor(transaction.contractName),
        address,
        runtimeCodeHash,
        configurationHash,
        capabilityHash,
        transactionHash: transactionHash(transaction),
        blockNumber: Number.parseInt(receipt.blockNumber, 16),
        constructorArguments,
        linkedLibraries: linkedLibraryNames(artifact),
        dependencies: inventory.dependencies,
        roleAuthority: inventory.roleAuthority,
        supported: inventory.supported,
        disabled: inventory.disabled,
        activation: "qualified",
      };
      manifest.phase2.deployments.push({
        ...deploymentEvidence,
        evidenceHash: sha256(deploymentEvidence),
      });
      continue;
    }
    contract.address = address;
    contract.bytecode.creationCodeHash = keccak(creationCode);
    contract.bytecode.runtimeCodeHash = keccak(runtimeCode);
    contract.deploymentTransaction = {
      hash: transactionHash(transaction),
      blockNumber: Number.parseInt(receipt.blockNumber, 16),
      broadcast: true,
    };

    if (Array.isArray(transaction.arguments)) {
      contract.constructorArguments.forEach((argument, index) => {
        if (typeof argument.value !== "string" || !argument.value.startsWith("$contracts.")) {
          argument.value = transaction.arguments[index] ?? argument.value;
        }
      });
      const argumentValues = new Map(contract.constructorArguments.map((argument) => [argument.name, argument.value]));
      contract.caps.forEach((cap) => {
        if (argumentValues.has(cap.name)) {
          cap.value = argumentValues.get(cap.name);
        }
      });
    }
  }

  const missingContracts = manifest.contracts.filter((contract) => !contract.address);
  if (missingContracts.length > 0) {
    throw new Error(`Broadcast evidence is missing: ${missingContracts.map((contract) => contract.name).join(", ")}.`);
  }

  const principalValues = Object.fromEntries(
    Object.entries(manifest.phase2.finalPrincipals).map(([name, principal]) => [name, requiredPrincipal(principal.source)]),
  );
  for (const [name, principal] of Object.entries(manifest.phase2.finalPrincipals)) {
    principal.address = principalValues[name];
  }
  if (new Set(Object.values(principalValues)).size !== Object.values(principalValues).length) {
    throw new Error("Final deployment principals must be pairwise distinct.");
  }
  const bootstrap = requiredPrincipal(manifest.phase2.bootstrapAuthority.source);
  const addresses = new Map([
    ...manifest.contracts.map((contract) => [contract.name, contract.address]),
    ...manifest.phase2.deployments.map((contract) => [contract.name, contract.address]),
  ]);
  const operatorRoles = [
    ["AssetRegistry", "REGISTRAR_ROLE", "SETRYN_REGISTRAR_ROLE"],
    ["AdapterRegistry", "ADAPTER_QUALIFIER_ROLE", "SETRYN_ADAPTER_QUALIFIER_ROLE"],
    ["CalendarRegistry", "CALENDAR_REGISTRAR_ROLE", "SETRYN_CALENDAR_REGISTRAR_ROLE"],
    ["SessionRegistry", "SESSION_REGISTRAR_ROLE", "SETRYN_SESSION_REGISTRAR_ROLE"],
    ["SettlementAssetRegistry", "QUALIFIER_ROLE", "SETRYN_QUALIFIER_ROLE"],
    ["BenchmarkRegistry", "BENCHMARK_QUALIFIER_ROLE", "SETRYN_BENCHMARK_QUALIFIER_ROLE"],
    ["FeeScheduleRegistry", "FEE_SCHEDULE_QUALIFIER_ROLE", "SETRYN_FEE_SCHEDULE_QUALIFIER_ROLE"],
    ["RiskDomainRegistry", "RISK_DOMAIN_QUALIFIER_ROLE", "SETRYN_RISK_DOMAIN_QUALIFIER_ROLE"],
    ["InstrumentRegistry", "INSTRUMENT_QUALIFIER_ROLE", "SETRYN_INSTRUMENT_QUALIFIER_ROLE"],
    ["MarketRegistry", "MARKET_QUALIFIER_ROLE", "SETRYN_MARKET_QUALIFIER_ROLE"],
    ["SeriesRegistry", "SERIES_QUALIFIER_ROLE", "SETRYN_SERIES_QUALIFIER_ROLE"],
    ["PackageRegistry", "PACKAGE_QUALIFIER_ROLE", "SETRYN_PACKAGE_QUALIFIER_ROLE"],
    ["PrivacyCommitmentRegistry", "POLICY_QUALIFIER_ROLE", "SETRYN_PRIVACY_POLICY_QUALIFIER_ROLE"],
    ["ExecutionPolicyRegistry", "POLICY_ADMIN_ROLE", "SETRYN_EXECUTION_POLICY_ADMIN_ROLE"],
  ].map(([contractName, role, label]) => ({contractName, role, label, member: principalValues.governanceOperator}));
  // Combined activate, pause, and deprecate roles belong to the registry status controller, which gives the guardian
  // only pause selectors and the governance timelock only activate and deprecate selectors.
  const statusRoles = [
    ["AssetRegistry", "STATUS_MANAGER_ROLE", "SETRYN_STATUS_MANAGER_ROLE"],
    ["AdapterRegistry", "ADAPTER_STATUS_MANAGER_ROLE", "SETRYN_ADAPTER_STATUS_MANAGER_ROLE"],
    ["CalendarRegistry", "CALENDAR_STATUS_MANAGER_ROLE", "SETRYN_CALENDAR_STATUS_MANAGER_ROLE"],
    ["SessionRegistry", "SESSION_STATUS_MANAGER_ROLE", "SETRYN_SESSION_STATUS_MANAGER_ROLE"],
    ["SettlementAssetRegistry", "STATUS_MANAGER_ROLE", "SETRYN_SETTLEMENT_STATUS_MANAGER_ROLE"],
    ["BenchmarkRegistry", "BENCHMARK_STATUS_MANAGER_ROLE", "SETRYN_BENCHMARK_STATUS_MANAGER_ROLE"],
    ["FeeScheduleRegistry", "FEE_SCHEDULE_STATUS_MANAGER_ROLE", "SETRYN_FEE_SCHEDULE_STATUS_MANAGER_ROLE"],
    ["RiskDomainRegistry", "RISK_DOMAIN_STATUS_MANAGER_ROLE", "SETRYN_RISK_DOMAIN_STATUS_MANAGER_ROLE"],
    ["InstrumentRegistry", "INSTRUMENT_STATUS_MANAGER_ROLE", "SETRYN_INSTRUMENT_STATUS_MANAGER_ROLE"],
    ["MarketRegistry", "MARKET_STATUS_MANAGER_ROLE", "SETRYN_MARKET_STATUS_MANAGER_ROLE"],
    ["SeriesRegistry", "SERIES_STATUS_MANAGER_ROLE", "SETRYN_SERIES_STATUS_MANAGER_ROLE"],
    ["PackageRegistry", "PACKAGE_STATUS_MANAGER_ROLE", "SETRYN_PACKAGE_STATUS_MANAGER_ROLE"],
    ["PrivacyCommitmentRegistry", "POLICY_ACTIVATOR_ROLE", "SETRYN_PRIVACY_POLICY_ACTIVATOR_ROLE"],
  ];
  const statusControllerRoles = statusRoles.map(([contractName, role, label]) => ({
    contractName,
    role,
    label,
    memberContract: "RegistryStatusController",
  }));
  const roleChecks = [
    ...operatorRoles,
    ...statusControllerRoles,
    {contractName: "CollateralVault", role: "COLLATERAL_LOCKER_ROLE", label: "SETRYN_COLLATERAL_LOCKER_ROLE", memberContract: "PositionEngine"},
    {contractName: "CollateralVault", role: "COLLATERAL_LOCKER_ROLE", label: "SETRYN_COLLATERAL_LOCKER_ROLE", memberContract: "AtomicClearingEngine"},
    {contractName: "CollateralVault", role: "COLLATERAL_SETTLER_ROLE", label: "SETRYN_COLLATERAL_SETTLER_ROLE", memberContract: "FundedFeeEngine"},
    {contractName: "CollateralVault", role: "COLLATERAL_SETTLER_ROLE", label: "SETRYN_COLLATERAL_SETTLER_ROLE", memberContract: "AtomicClearingEngine"},
    {contractName: "CollateralVault", role: "TERMINAL_RESERVATION_CREATOR_ROLE", label: "SETRYN_TERMINAL_RESERVATION_CREATOR_ROLE", memberContract: "PositionEngine"},
    {contractName: "CollateralVault", role: "TERMINAL_RESERVATION_RESOLVER_ROLE", label: "SETRYN_TERMINAL_RESERVATION_RESOLVER_ROLE", memberContract: "CashSettlementCoordinator"},
    {contractName: "CollateralVault", role: "TERMINAL_RESERVATION_RESOLVER_ROLE", label: "SETRYN_TERMINAL_RESERVATION_RESOLVER_ROLE", memberContract: "PositionLifecycleExecutor"},
    {contractName: "CollateralVault", role: "COLLATERAL_LOCKER_ROLE", label: "SETRYN_COLLATERAL_LOCKER_ROLE", memberContract: "DefaultProcessEngine"},
    {contractName: "CollateralVault", role: "COLLATERAL_SETTLER_ROLE", label: "SETRYN_COLLATERAL_SETTLER_ROLE", memberContract: "DefaultProcessEngine"},
    {contractName: "CollateralVault", role: "EXCESS_RECOVERY_ROLE", label: "SETRYN_EXCESS_RECOVERY_ROLE", member: principalValues.excessRecoveryOperator},
    {contractName: "PositionEngine", role: "FIXING_ENGINE_ROLE", label: "SETRYN_FIXING_ENGINE_ROLE", memberContract: "CashSettlementCoordinator"},
    {contractName: "PositionEngine", role: "LIFECYCLE_ENGINE_ROLE", label: "SETRYN_LIFECYCLE_ENGINE_ROLE", memberContract: "PositionLifecycleExecutor"},
    {contractName: "PositionEngine", role: "DEFAULT_ENGINE_ROLE", label: "SETRYN_DEFAULT_ENGINE_ROLE", memberContract: "PositionLifecycleExecutor"},
    {contractName: "PositionEngine", role: "CLEARING_ENGINE_ROLE", label: "SETRYN_CLEARING_ENGINE_ROLE", memberContract: "AtomicClearingEngine"},
    {contractName: "FundedFeeEngine", role: "FEE_ACTION_CONSUMER_ROLE", label: "SETRYN_FEE_ACTION_CONSUMER_ROLE", memberContract: "CashSettlementCoordinator"},
    {contractName: "FundedFeeEngine", role: "FEE_ACTION_CONSUMER_ROLE", label: "SETRYN_FEE_ACTION_CONSUMER_ROLE", memberContract: "AtomicClearingEngine"},
    {contractName: "PortfolioRiskEngine", role: "RISK_CONSUMER_ROLE", label: "SETRYN_RISK_CONSUMER_ROLE", memberContract: "AtomicClearingEngine"},
    {contractName: "PortfolioRiskEngine", role: "EXPOSURE_REDUCER_ROLE", label: "SETRYN_EXPOSURE_REDUCER_ROLE", memberContract: "PositionLifecycleExecutor"},
    {contractName: "PortfolioRiskEngine", role: "EXPOSURE_REDUCER_ROLE", label: "SETRYN_EXPOSURE_REDUCER_ROLE", memberContract: "CashSettlementCoordinator"},
    {contractName: "PortfolioRiskEngine", role: "EXPOSURE_REDUCER_ROLE", label: "SETRYN_EXPOSURE_REDUCER_ROLE", memberContract: "DefaultProcessEngine"},
    {contractName: "PositionLifecycleExecutor", role: "SIGNED_LIFECYCLE_ENGINE_ROLE", label: "SETRYN_SIGNED_LIFECYCLE_ENGINE_ROLE", memberContract: "SignedLifecycleEngine"},
    {contractName: "PositionLifecycleExecutor", role: "COMPRESSION_COORDINATOR_ROLE", label: "SETRYN_COMPRESSION_COORDINATOR_ROLE", memberContract: "CompressionCoordinator"},
    {contractName: "PositionLifecycleExecutor", role: "DEFAULT_PROCESS_ENGINE_ROLE", label: "SETRYN_DEFAULT_PROCESS_ENGINE_ROLE", memberContract: "DefaultProcessEngine"},
    {contractName: "PositionLifecycleExecutor", role: "WITNESS_STAGER_ROLE", label: "SETRYN_LIFECYCLE_WITNESS_STAGER_ROLE", member: principalValues.lifecycleWitnessStager},
    {contractName: "SignedLifecycleEngine", role: "LIFECYCLE_GUARDIAN_ROLE", label: "SETRYN_LIFECYCLE_GUARDIAN_ROLE", member: principalValues.guardian},
    {contractName: "CompressionCoordinator", role: "COMPRESSION_GUARDIAN_ROLE", label: "SETRYN_COMPRESSION_GUARDIAN_ROLE", member: principalValues.guardian},
    {contractName: "PrivacyCommitmentRegistry", role: "EPOCH_KEY_PUBLISHER_ROLE", label: "SETRYN_PRIVACY_EPOCH_KEY_PUBLISHER_ROLE", member: principalValues.privacyKeyPublisher},
    {contractName: "OrderState", role: "ORDER_CONSUMER_ROLE", label: "SETRYN_ORDER_CONSUMER_ROLE", memberContract: "AtomicClearingEngine"},
    {contractName: "AtomicClearingEngine", role: "MATCH_EXECUTOR_ROLE", label: "SETRYN_MATCH_EXECUTOR_ROLE", memberContract: "PublicOrderBook"},
    {contractName: "PositionEngine", role: "FUNDING_REQUESTER_ROLE", label: "SETRYN_POSITION_FUNDING_REQUESTER_ROLE", memberContract: "PrivateRfqBook"},
    {contractName: "PositionEngine", role: "FUNDING_REQUESTER_ROLE", label: "SETRYN_POSITION_FUNDING_REQUESTER_ROLE", memberContract: "SealedAuctionHouse"},
    {contractName: "PositionEngine", role: "FUNDING_REQUESTER_ROLE", label: "SETRYN_POSITION_FUNDING_REQUESTER_ROLE", memberContract: "VaultBackedStreamCapacityManager"},
    {contractName: "PositionEngine", role: "FUNDING_REQUESTER_ROLE", label: "SETRYN_POSITION_FUNDING_REQUESTER_ROLE", memberContract: "VaultBackedBatchCapacityManager"},
    {contractName: "CollateralVault", role: "COLLATERAL_LOCKER_ROLE", label: "SETRYN_COLLATERAL_LOCKER_ROLE", memberContract: "SealedAuctionHouse"},
    {contractName: "CollateralVault", role: "COLLATERAL_SETTLER_ROLE", label: "SETRYN_COLLATERAL_SETTLER_ROLE", memberContract: "SealedAuctionHouse"},
    {contractName: "CapacityReservationRegistry", role: "CAPACITY_CLAIMANT_ROLE", label: "SETRYN_CAPACITY_CLAIMANT_ROLE", memberContract: "VaultBackedStreamCapacityManager"},
    {contractName: "CapacityReservationRegistry", role: "CAPACITY_CLAIMANT_ROLE", label: "SETRYN_CAPACITY_CLAIMANT_ROLE", memberContract: "VaultBackedBatchCapacityManager"},
    {contractName: "CapacityReservationRegistry", role: "CAPACITY_CLAIMANT_ROLE", label: "SETRYN_CAPACITY_CLAIMANT_ROLE", memberContract: "ProtocolRouteLiquiditySource"},
    {contractName: "VaultBackedStreamCapacityManager", role: "STREAM_ENGINE_ROLE", label: "SETRYN_STREAM_ENGINE_ROLE", memberContract: "StreamingQuoteEngine"},
    {contractName: "VaultBackedBatchCapacityManager", role: "BATCH_ENGINE_ROLE", label: "SETRYN_BATCH_ENGINE_ROLE", memberContract: "BatchClearingEngine"},
    {contractName: "AtomicClearingEngine", role: "MATCH_EXECUTOR_ROLE", label: "SETRYN_MATCH_EXECUTOR_ROLE", memberContract: "StreamingQuoteEngine"},
    {contractName: "AtomicClearingEngine", role: "MATCH_EXECUTOR_ROLE", label: "SETRYN_MATCH_EXECUTOR_ROLE", memberContract: "BatchClearingEngine"},
    {contractName: "SealedAuctionHouse", role: "CLEARING_ENGINE_ROLE", label: "SETRYN_AUCTION_CLEARING_ENGINE_ROLE", memberContract: "AtomicClearingEngine"},
    {contractName: "SealedAuctionHouse", role: "CLEARING_ENGINE_ROLE", label: "SETRYN_AUCTION_CLEARING_ENGINE_ROLE", memberContract: "BatchClearingEngine"},
    {contractName: "SealedAuctionHouse", role: "AUCTION_SCHEDULER_ROLE", label: "SETRYN_AUCTION_SCHEDULER_ROLE", member: principalValues.governanceOperator},
    {contractName: "SealedAuctionHouse", role: "AUCTION_GUARDIAN_ROLE", label: "SETRYN_AUCTION_GUARDIAN_ROLE", member: principalValues.guardian},
    {contractName: "PublicOrderBook", role: "ROUTE_RESERVER_ROLE", label: "SETRYN_BOOK_ROUTE_RESERVER_ROLE", memberContract: "ProtocolRouteLiquiditySource"},
    {contractName: "PrivateRfqBook", role: "ROUTE_RESERVER_ROLE", label: "SETRYN_RFQ_ROUTE_RESERVER_ROLE", memberContract: "ProtocolRouteLiquiditySource"},
    {contractName: "StreamingQuoteEngine", role: "ROUTE_RESERVER_ROLE", label: "SETRYN_STREAM_ROUTE_RESERVER_ROLE", memberContract: "ProtocolRouteLiquiditySource"},
    {contractName: "SealedAuctionHouse", role: "ROUTE_RESERVER_ROLE", label: "SETRYN_AUCTION_ROUTE_RESERVER_ROLE", memberContract: "ProtocolRouteLiquiditySource"},
    {contractName: "ProtocolRouteLiquiditySource", role: "ROUTE_ENGINE_ROLE", label: "SETRYN_ROUTE_ENGINE_ROLE", memberContract: "CollateralAwareRouteEngine"},
    {contractName: "CollateralAwareRouteEngine", role: "ROUTE_CONSUMER_ROLE", label: "SETRYN_ROUTE_CONSUMER_ROLE", member: principalValues.governanceOperator},
    {contractName: "PortfolioRiskEngine", role: "RISK_CONSUMER_ROLE", label: "SETRYN_RISK_CONSUMER_ROLE", memberContract: "CollateralAwareRouteEngine"},
  ];
  const verifiedRoles = [];
  for (const check of roleChecks) verifiedRoles.push(await verifyRole(rpcUrl, addresses, blockTag, check, bootstrap));
  const statusController = addresses.get("RegistryStatusController");
  const statusGuardian = `0x${(await ethCall(rpcUrl, statusController, calldata("guardian()"), blockTag)).slice(26, 66)}`;
  const statusGovernance = `0x${(await ethCall(rpcUrl, statusController, calldata("governance()"), blockTag)).slice(26, 66)}`;
  if (statusGuardian.toLowerCase() !== principalValues.guardian.toLowerCase()) {
    throw new Error("RegistryStatusController guardian drifted");
  }
  // The governance timelock activates, resumes, and deprecates; only a local devnet may use the governance operator.
  const allowedStatusGovernance = [principalValues.governanceAdmin];
  if (options.environment === "local") allowedStatusGovernance.push(principalValues.governanceOperator);
  if (!allowedStatusGovernance.some((principal) => principal.toLowerCase() === statusGovernance.toLowerCase())) {
    throw new Error("RegistryStatusController governance must be the governance timelock");
  }
  for (const [contractName, role, label] of statusRoles) {
    const guardianHeld = await ethCall(
      rpcUrl, addresses.get(contractName), calldata("hasRole(bytes32,address)", [roleId(label), principalValues.guardian]), blockTag,
    );
    if (BigInt(guardianHeld) !== 0n) throw new Error(`${contractName}.${role} must never be held by the guardian`);
    if (options.environment !== "local") {
      const operatorHeld = await ethCall(
        rpcUrl, addresses.get(contractName), calldata("hasRole(bytes32,address)", [roleId(label), principalValues.governanceOperator]), blockTag,
      );
      if (BigInt(operatorHeld) !== 0n) throw new Error(`${contractName}.${role} must be held only by the status controller`);
    }
  }
  for (const [contractName, label] of [
    ["PublicOrderBook", "SETRYN_BOOK_ROUTE_RESERVER_ROLE"],
    ["PrivateRfqBook", "SETRYN_RFQ_ROUTE_RESERVER_ROLE"],
  ]) {
    const held = await ethCall(
      rpcUrl, addresses.get(contractName), calldata("hasRole(bytes32,address)", [roleId(label), principalValues.governanceOperator]), blockTag,
    );
    if (BigInt(held) !== 0n) throw new Error(`${contractName} route reservation must belong only to the liquidity source`);
  }
  for (const [contractName, member] of [
    ["StreamingQuoteEngine", principalValues.governanceAdmin],
  ]) {
    const adminHeld = await ethCall(rpcUrl, addresses.get(contractName), calldata("hasRole(bytes32,address)", [`0x${"0".repeat(64)}`, member]), blockTag);
    const bootstrapHeld = await ethCall(rpcUrl, addresses.get(contractName), calldata("hasRole(bytes32,address)", [`0x${"0".repeat(64)}`, bootstrap]), blockTag);
    if (BigInt(adminHeld) !== 1n || BigInt(bootstrapHeld) !== 0n) throw new Error(`${contractName} admin was not handed to governance`);
  }
  for (const check of [
    ["PositionEngine", "FUNDING_REQUESTER_ROLE", "SETRYN_POSITION_FUNDING_REQUESTER_ROLE"],
  ]) {
    const [contractName, role, label] = check;
    const target = addresses.get(contractName);
    const id = roleId(label);
    const state = await ethCall(rpcUrl, target, calldata("hasRole(bytes32,address)", [id, bootstrap]), blockTag);
    if (BigInt(state) !== 0n) throw new Error(`${contractName}.${role} remains held by bootstrap`);
    verifiedRoles.push({contractName, role, roleId: id, member: null});
  }
  for (const contract of manifest.contracts) {
    for (const role of contract.roles) {
      role.members = verifiedRoles
        .filter((entry) => entry.contractName === contract.name && entry.role === role.name && entry.member)
        .map((entry) => ({address: entry.member, source: principalSource(entry.member, principalValues, addresses)}));
    }
  }
  const adminContracts = [
    "AssetRegistry", "AdapterRegistry", "CalendarRegistry", "SessionRegistry", "SettlementAssetRegistry",
    "BenchmarkRegistry", "FeeScheduleRegistry", "RiskDomainRegistry", "InstrumentRegistry", "MarketRegistry",
    "SeriesRegistry", "CollateralVault", "PackageRegistry", "PositionEngine", "FundedFeeEngine",
    "PortfolioRiskEngine", "PositionLifecycleExecutor", "SignedLifecycleEngine", "CompressionCoordinator",
    "PrivacyCommitmentRegistry",
    "ExecutionPolicyRegistry", "OrderState", "AtomicClearingEngine", "PrivateRfqBook",
    "CapacityReservationRegistry", "VaultBackedStreamCapacityManager", "VaultBackedBatchCapacityManager",
    "SealedAuctionHouse", "ProtocolRouteLiquiditySource", "CollateralAwareRouteEngine",
  ];
  const pendingAdmins = [];
  for (const contractName of adminContracts) {
    const result = await ethCall(rpcUrl, addresses.get(contractName), calldata("pendingDefaultAdmin()"), blockTag);
    const pendingAdmin = `0x${result.slice(26, 66)}`.toLowerCase();
    if (pendingAdmin !== principalValues.governanceAdmin) throw new Error(`${contractName} pending admin drifted`);
    pendingAdmins.push({contractName, pendingAdmin, acceptSchedule: `0x${result.slice(66, 130)}`});
  }
  const aggregateConfiguration = sha256(manifest.phase2.deployments.map(({name, configurationHash}) => [name, configurationHash]));
  const aggregateCapabilities = sha256(manifest.phase2.deployments.map(({name, capabilityHash}) => [name, capabilityHash]));
  const postWiringEvidenceHash = sha256({verifiedRoles, pendingAdmins, bootstrap});
  manifest.phase2.qualificationEvidence = {
    ...manifest.phase2.qualificationEvidence,
    configurationHash: aggregateConfiguration,
    capabilityHash: aggregateCapabilities,
    activation: "qualified",
    postWiringEvidenceHash,
    bootstrapRolesRevoked: true,
    adminTransfersBegun: true,
  };

  for (const dependency of manifest.externalDependencies) {
    if (!dependency.address) {
      continue;
    }
    const runtimeCode = await rpc(rpcUrl, "eth_getCode", [dependency.address, blockTag]);
    if (runtimeCode !== "0x") {
      dependency.runtimeCodeHash = keccak(runtimeCode);
      dependency.qualificationStatus = "code-hash-recorded";
    }
  }

  manifest.environment = options.environment;
  manifest.chainId = chainId;
  manifest.status = "broadcast";
  manifest.generatedAt = new Date().toISOString();
  manifest.sourceCommit = sourceCommit();
  manifest.blockReference = {
    number: finalBlockNumber,
    hash: finalBlock.hash,
    mode: "broadcast",
  };
  manifest.compiler = compiler;
  manifest.linkedLibraries = libraryEvidence;
  manifest.broadcast = {
    enabled: true,
    signed: options.environment !== "local",
    transactionCount: creates.length + libraryCreates.length,
  };

  const outputPath = resolve(repositoryRoot, options.output ?? environment.output);
  const temporaryOutputPath = `${outputPath}.tmp-${process.pid}`;
  writeFileSync(temporaryOutputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/validate-deployment-manifests.mjs"), "--manifest", temporaryOutputPath],
      {cwd: repositoryRoot, stdio: "inherit"},
    );
    renameSync(temporaryOutputPath, outputPath);
  } finally {
    rmSync(temporaryOutputPath, {force: true});
  }
  process.stdout.write(`Wrote deployment evidence to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
