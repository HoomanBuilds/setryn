#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trackedManifestPaths = [
  "deployments/arbitrum-sepolia/manifest.json",
  "deployments/arbitrum-one/manifest.json",
];
const manifestArgumentIndex = process.argv.indexOf("--manifest");
if (manifestArgumentIndex !== -1 && !process.argv[manifestArgumentIndex + 1]) {
  throw new Error("--manifest requires a path");
}
const manifestPaths =
  manifestArgumentIndex === -1 ? trackedManifestPaths : [process.argv[manifestArgumentIndex + 1]];
const phase2Inventory = readJson("deployments/phase2-contract-inventory.json");
const phase2ContractNames = phase2Inventory.contracts.map(({ name }) => name);
const requiredContracts = [
  "AssetRegistry",
  "AdapterRegistry",
  "CalendarRegistry",
  "SessionRegistry",
  "SettlementAssetRegistry",
  "BenchmarkRegistry",
  "FeeScheduleRegistry",
  "RiskDomainRegistry",
  "InstrumentRegistry",
  "MarketRegistry",
  "SeriesRegistry",
  "CollateralVault",
];
const allowedAdapterContracts = [
  "ChainlinkHistoricalRoundFixingAdapter",
  "ChainlinkSequencerHealthAdapter",
  "UniswapV3ExactInputSingleAdapter",
  "AaveV3SupplyWithdrawAdapter",
  "GmxV2OrderAdapter",
];
const arbitrumOnePinnedBlockNumber = 509990000;
const arbitrumOnePinnedBlockHash = "0xd5edd6e1c8caac1a8bba0aadc5f3d52aecc6cf360dbeded39e898ce101433e72";
const arbitrumOneExpectedCodeHashes = new Map([
  ["0xaf88d065e77c8cc2239327c5edb3a432268e5831", "0xad30d819dbc47814b7e6cb837fd7cc57fcb591479a38596ee93de4fc52e8c435"],
  ["0x639fe6ab55c921f74e7fac1ee960c0b6293ba612", "0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2"],
  ["0xfdb631f5ee196f0ed6faa767959853a9f217697d", "0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2"],
  ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", "0x209f9820ed7257d51c2f96ee837e8ec057b44774899f4be16fc45bd30cbb16f6"],
  ["0xa97684ead0e402dc232d5a977953df7ecbab3cdb", "0x1a95f317ee56e0b9aedc4f4b7abd9e546dc45c26d1d77e95bcf62b789d9a5486"],
  ["0x794a61358d6845594f94dc1db02a252b5b4814ad", "0xf168c2e9e4d04292c7d5d526a9a917175a44369ab63a2f9997537acf0ffaaf2e"],
  ["0x7de39ff2e232a2203196788d37e234cf8f1b83f1", "0x8d85c91f9f96ee11a2395f2a218554fa0c675ad0ecd7d0fdcbfe61f62991fe04"],
  ["0x7452c558d45f8afc8c83dae62c3f8a5be19c71f6", "0xc25e44eb982bdc5ffbd44db5438231ea7bc038b2fcc675520974453bf2a00d5f"],
  ["0x31ef83a530fde1b38ee9a18093a333d8bbbc40d5", "0x34d8332a92711cb1ce9a31be362ca68f9b4d34963e5c7c10d6134c86d832edb3"],
  ["0xa5d2d45228ee2e3a18ab122b2ce84997d008f4eb", "0xc35bbb9387b097e5b397a4901fa60cdbf4255d5c2bf71f942f938d9ddd989452"],
  ["0xfd70de6b91282d8017aa4e741e9ae325cab992d8", "0x3e7aea6e62b75671681b0d3006b146c7f02681a65fd5cc663909104de9d5088e"],
  ["0xfa26cbb46e2614609406de08ca1dc7f70a684184", "0x49ed1cb374dfbcea8c73fb50821b5e0bb3fbbe83f4324d954ef07c38758ac04a"],
  ["0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "0x2d240bb4510ed1acfeaba905eb4bcc4524d63c8ae66e48fcccac55ea714db7a7"],
]);
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
const vaultRoles = [
  ["COLLATERAL_LOCKER_ROLE", "SETRYN_COLLATERAL_LOCKER_ROLE"],
  ["COLLATERAL_SETTLER_ROLE", "SETRYN_COLLATERAL_SETTLER_ROLE"],
  ["TERMINAL_RESERVATION_CREATOR_ROLE", "SETRYN_TERMINAL_RESERVATION_CREATOR_ROLE"],
  ["TERMINAL_RESERVATION_RESOLVER_ROLE", "SETRYN_TERMINAL_RESERVATION_RESOLVER_ROLE"],
  ["EXCESS_RECOVERY_ROLE", "SETRYN_EXCESS_RECOVERY_ROLE"],
];

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function roleId(label) {
  return execFileSync("cast", ["keccak", label], { encoding: "utf8" }).trim().toLowerCase();
}

function artifactConstructor(contract) {
  const path = resolve(repositoryRoot, contract.artifact);
  if (!existsSync(path)) {
    return null;
  }
  const artifact = readJson(contract.artifact);
  return artifact.abi.find((item) => item.type === "constructor")?.inputs ?? [];
}

function validateConstructor(contract, manifestPath) {
  const inputs = artifactConstructor(contract);
  if (inputs === null) {
    return;
  }
  const declared = contract.constructorArguments.map(({ name, type }) => ({ name: name.replace(/_+$/, ""), type }));
  const actual = inputs.map(({ name, type }) => ({ name: name.replace(/_+$/, ""), type }));
  if (JSON.stringify(declared) !== JSON.stringify(actual)) {
    throw new Error(`${manifestPath}: ${contract.name} constructor arguments drifted from its artifact`);
  }
}

function validateManifest(manifestPath) {
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== "1.0.0") {
    throw new Error(`${manifestPath}: unsupported schema version`);
  }
  const allowedChainIds = {
    local: [1337, 31337],
    "arbitrum-sepolia": [421614],
    "arbitrum-one": [42161],
  };
  if (!allowedChainIds[manifest.environment]?.includes(manifest.chainId)) {
    throw new Error(`${manifestPath}: environment and chain ID do not match`);
  }
  if (
    manifest.phase2?.inventoryFile !== "../phase2-contract-inventory.json" ||
    JSON.stringify(manifest.phase2.contracts) !== JSON.stringify(phase2ContractNames) ||
    manifest.phase2.mainnetBroadcastAllowed !== false ||
    manifest.phase2.bootstrapAuthority?.postWiringRevocationRequired !== true
  ) {
    throw new Error(`${manifestPath}: Phase 2 inventory or authority policy drifted`);
  }
  if (!manifest.phase2.finalPrincipals || !manifest.phase2.qualificationEvidence) {
    throw new Error(`${manifestPath}: Phase 2 final authority or qualification evidence is missing`);
  }
  const phase2Deployments = manifest.phase2.deployments;
  const deployedPhase2Names = phase2Deployments.map(({ name }) => name);
  if (new Set(deployedPhase2Names).size !== deployedPhase2Names.length) {
    throw new Error(`${manifestPath}: duplicate Phase 2 deployment evidence`);
  }
  for (const name of deployedPhase2Names) {
    if (!phase2ContractNames.includes(name)) {
      throw new Error(`${manifestPath}: unknown Phase 2 deployed contract ${name}`);
    }
  }
  if ((manifest.status === "planned" || manifest.status === "disabled") && phase2Deployments.length !== 0) {
    throw new Error(`${manifestPath}: non-broadcast manifest contains Phase 2 deployment evidence`);
  }
  const contracts = new Map(manifest.contracts.map((contract) => [contract.name, contract]));
  if (contracts.size !== manifest.contracts.length) {
    throw new Error(`${manifestPath}: contract names must be unique`);
  }
  const names = [...contracts.keys()];
  if (JSON.stringify(names.slice(0, requiredContracts.length)) !== JSON.stringify(requiredContracts)) {
    throw new Error(`${manifestPath}: contract order or membership drifted from the Phase 1 deployment graph`);
  }
  const adapterNames = names.slice(requiredContracts.length);
  if (new Set(adapterNames).size !== adapterNames.length) {
    throw new Error(`${manifestPath}: adapter contract names must be unique`);
  }
  for (const name of adapterNames) {
    if (!allowedAdapterContracts.includes(name)) {
      throw new Error(`${manifestPath}: unexpected adapter contract ${name}`);
    }
  }
  if (JSON.stringify(adapterNames) !== JSON.stringify(allowedAdapterContracts.filter((name) => adapterNames.includes(name)))) {
    throw new Error(`${manifestPath}: adapter contract order drifted`);
  }
  if (
    manifest.environment === "arbitrum-sepolia" &&
    manifest.status === "planned" &&
    (manifest.broadcast.enabled || manifest.broadcast.signed || manifest.broadcast.transactionCount !== 0)
  ) {
    throw new Error(`${manifestPath}: planned Sepolia deployment must keep broadcast disabled and unsigned`);
  }
  if (
    manifest.environment === "arbitrum-one" &&
    (manifest.status !== "disabled" ||
      manifest.broadcast.enabled !== false ||
      manifest.broadcast.signed !== false ||
      manifest.broadcast.transactionCount !== 0)
  ) {
    throw new Error(`${manifestPath}: Arbitrum One broadcast must remain disabled`);
  }
  if (manifest.environment === "arbitrum-one") {
    if (
      manifest.blockReference?.number !== arbitrumOnePinnedBlockNumber ||
      typeof manifest.blockReference?.hash !== "string" ||
      manifest.blockReference.hash.toLowerCase() !== arbitrumOnePinnedBlockHash ||
      manifest.blockReference?.mode !== "pinned"
    ) {
      throw new Error(
        `${manifestPath}: Arbitrum One block reference must pin ${arbitrumOnePinnedBlockNumber} with the observed hash`,
      );
    }
    const externalDependencies = manifest.externalDependencies ?? [];
    if (externalDependencies.length !== arbitrumOneExpectedCodeHashes.size) {
      throw new Error(`${manifestPath}: Arbitrum One must declare every Phase 4 external dependency`);
    }
    const seenExternalAddresses = new Set();
    for (const dependency of externalDependencies) {
      if (typeof dependency.address !== "string") {
        throw new Error(`${manifestPath}: Arbitrum One external dependency is missing its address`);
      }
      const normalizedAddress = dependency.address.toLowerCase();
      if (seenExternalAddresses.has(normalizedAddress)) {
        throw new Error(`${manifestPath}: Arbitrum One declares a duplicate external dependency address`);
      }
      seenExternalAddresses.add(normalizedAddress);
      const expectedHash = arbitrumOneExpectedCodeHashes.get(normalizedAddress);
      if (!expectedHash) {
        throw new Error(`${manifestPath}: Arbitrum One declares an unexpected external dependency ${dependency.address}`);
      }
      if (typeof dependency.runtimeCodeHash !== "string" || !bytes32Pattern.test(dependency.runtimeCodeHash)) {
        throw new Error(`${manifestPath}: Arbitrum One external dependency ${dependency.name} is missing its code hash`);
      }
      if (dependency.runtimeCodeHash.toLowerCase() === zeroHash) {
        throw new Error(`${manifestPath}: Arbitrum One external dependency ${dependency.name} has a zero code hash`);
      }
      if (dependency.runtimeCodeHash.toLowerCase() !== expectedHash) {
        throw new Error(`${manifestPath}: Arbitrum One external dependency ${dependency.name} code hash mismatch`);
      }
      if (dependency.qualificationStatus !== "code-hash-recorded") {
        throw new Error(
          `${manifestPath}: Arbitrum One external dependency ${dependency.name} must use code-hash-recorded status`,
        );
      }
      if (dependency.qualificationStatus === "qualified") {
        throw new Error(`${manifestPath}: Arbitrum One external dependency ${dependency.name} must never be qualified`);
      }
      if (!dependency.provenance?.reference || dependency.provenance.verifiedAt !== "2026-09-29T00:00:00Z") {
        throw new Error(`${manifestPath}: Arbitrum One external dependency ${dependency.name} provenance is incomplete`);
      }
      if (!Array.isArray(dependency.consumers) || dependency.consumers.length === 0) {
        throw new Error(`${manifestPath}: Arbitrum One external dependency ${dependency.name} must list consumers`);
      }
      for (const consumer of dependency.consumers) {
        if (!contracts.has(consumer)) {
          throw new Error(`${manifestPath}: Arbitrum One external dependency ${dependency.name} lists unknown consumer ${consumer}`);
        }
      }
    }
    for (const contract of manifest.contracts) {
      if (contract.address !== null || contract.implementation !== null) {
        throw new Error(`${manifestPath}: Arbitrum One contract ${contract.name} must remain non-deployed`);
      }
      if (contract.deploymentTransaction?.broadcast !== false) {
        throw new Error(`${manifestPath}: Arbitrum One contract ${contract.name} must never record a broadcast`);
      }
    }
  }
  if (manifest.status === "broadcast" && (!manifest.broadcast.enabled || manifest.broadcast.transactionCount === 0)) {
    throw new Error(`${manifestPath}: broadcast evidence must record broadcast transactions`);
  }

  const vault = contracts.get("CollateralVault");
  if (!vault.owner?.source) {
    throw new Error(`${manifestPath}: CollateralVault owner authority is missing`);
  }
  if (JSON.stringify(vault.dependencies) !== JSON.stringify(["SettlementAssetRegistry", "RiskDomainRegistry"])) {
    throw new Error(`${manifestPath}: CollateralVault dependencies drifted`);
  }
  const actualRoles = new Map(vault.roles.map((role) => [role.name, role]));
  if (actualRoles.size !== vaultRoles.length) {
    throw new Error(`${manifestPath}: CollateralVault role set is incomplete`);
  }
  for (const [name, label] of vaultRoles) {
    const role = actualRoles.get(name);
    if (!role || role.id?.toLowerCase() !== roleId(label)) {
      throw new Error(`${manifestPath}: CollateralVault role ${name} drifted`);
    }
    if (
      manifest.environment === "arbitrum-sepolia" && manifest.status === "planned" &&
      (role.members.length !== 1 || role.members[0]?.source !== "SETRYN_INITIAL_ADMIN")
    ) {
      throw new Error(`${manifestPath}: CollateralVault role ${name} bootstrap authority drifted`);
    }
  }

  if (manifest.status === "broadcast") {
    const evidence = manifest.phase2.qualificationEvidence;
    if (
      !evidence.configurationHash || !evidence.capabilityHash || !evidence.postWiringEvidenceHash ||
      evidence.activation !== "qualified" || !evidence.bootstrapRolesRevoked || !evidence.adminTransfersBegun
    ) {
      throw new Error(`${manifestPath}: broadcast qualification evidence is incomplete`);
    }
    for (const deployment of phase2Deployments) {
      for (const field of ["configurationHash", "capabilityHash", "evidenceHash"]) {
        if (!deployment[field]) throw new Error(`${manifestPath}: ${deployment.name} is missing ${field}`);
      }
      for (const field of ["dependencies", "roleAuthority", "supported", "disabled"]) {
        if (!Array.isArray(deployment[field])) throw new Error(`${manifestPath}: ${deployment.name} has invalid ${field}`);
      }
    }
  }

  for (const contract of manifest.contracts) {
    const expectedArtifact = `contracts/out/${contract.name}.sol/${contract.name}.json`;
    if (contract.artifact !== expectedArtifact) {
      throw new Error(`${manifestPath}: ${contract.name} artifact path drifted`);
    }
    validateConstructor(contract, manifestPath);
    const declaredDependencies = contract.constructorArguments
      .map((argument) =>
        typeof argument.value === "string"
          ? /^\$contracts\.([A-Za-z][A-Za-z0-9]*)\.address$/.exec(argument.value)?.[1]
          : undefined,
      )
      .filter(Boolean);
    if (JSON.stringify(contract.dependencies) !== JSON.stringify(declaredDependencies)) {
      throw new Error(`${manifestPath}: ${contract.name} dependency declarations drifted from constructor wiring`);
    }
    if (new Set(contract.dependencies).size !== contract.dependencies.length) {
      throw new Error(`${manifestPath}: ${contract.name} declares duplicate dependencies`);
    }
    for (const dependency of contract.dependencies) {
      if (!contracts.has(dependency)) {
        throw new Error(`${manifestPath}: ${contract.name} has unknown dependency ${dependency}`);
      }
    }
  }
}

for (const manifestPath of manifestPaths) {
  validateManifest(manifestPath);
}

process.stdout.write("Deployment manifests match the Phase 1 graph and Phase 2 inventory.\n");
