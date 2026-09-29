#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = readJson("deployments/phase2-contract-inventory.json");
const manifests = [
  readJson("deployments/arbitrum-sepolia/manifest.json"),
  readJson("deployments/arbitrum-one/manifest.json"),
];
const generator = readText("packages/internal-contracts/scripts/generate-bindings.mjs");
const deploymentScript = readText("contracts/script/DeploySetryn.s.sol");

if (inventory.schemaVersion !== "2.0.0" || !Array.isArray(inventory.contracts)) {
  throw new Error("Phase 2 inventory schema is unsupported");
}
if (
  JSON.stringify(inventory.qualificationSlots) !==
  JSON.stringify(["runtimeCodeHash", "configurationHash", "capabilityHash", "evidenceHash"])
) {
  throw new Error("Phase 2 qualification hash slots drifted");
}
const requiredPrincipals = [
  "SETRYN_GOVERNANCE_ADMIN",
  "SETRYN_GOVERNANCE_OPERATOR",
  "SETRYN_GUARDIAN",
  "SETRYN_EXCESS_RECOVERY_OPERATOR",
  "SETRYN_PRIVACY_KEY_PUBLISHER",
  "SETRYN_LIFECYCLE_WITNESS_STAGER",
];
if (JSON.stringify(inventory.deploymentPrincipals) !== JSON.stringify(requiredPrincipals)) {
  throw new Error("Phase 2 deployment principal inventory drifted");
}
if (!Array.isArray(inventory.productionBlockers)) throw new Error("Phase 2 blockers must be structured");
const blockedContracts = new Set(inventory.productionBlockers.flatMap(({ contracts }) => contracts));
const inventoryNames = inventory.contracts.map(({ name }) => name);
assertUnique(inventoryNames, "inventory contract");
for (const contract of inventory.contracts) {
  for (const field of ["dependencies", "roleAuthority", "supported", "disabled"]) {
    if (!Array.isArray(contract[field])) throw new Error(`${contract.name} has invalid ${field}`);
  }
  if (!['planned', 'blocked'].includes(contract.activation)) {
    throw new Error(`${contract.name} has invalid activation state`);
  }
  if (contract.activation === "blocked" && !blockedContracts.has(contract.name)) {
    throw new Error(`${contract.name} has no structured production blocker`);
  }
  if (contract.runtimeCodeHash !== null || contract.evidenceHash !== null) {
    throw new Error(`${contract.name} must not claim deployment evidence before the Phase 2 gate`);
  }
}

for (const manifest of manifests) {
  if (JSON.stringify(manifest.phase2?.contracts) !== JSON.stringify(inventoryNames)) {
    throw new Error(`${manifest.environment} Phase 2 inventory drifted`);
  }
  if (manifest.phase2.mainnetBroadcastAllowed !== false) {
    throw new Error(`${manifest.environment} unexpectedly allows mainnet broadcast`);
  }
  if (!Array.isArray(manifest.phase2.deployments)) {
    throw new Error(`${manifest.environment} Phase 2 deployment evidence must be an array`);
  }
  const principals = manifest.phase2.finalPrincipals;
  for (const [key, source] of [
    ["governanceAdmin", "SETRYN_GOVERNANCE_ADMIN"],
    ["governanceOperator", "SETRYN_GOVERNANCE_OPERATOR"],
    ["guardian", "SETRYN_GUARDIAN"],
    ["excessRecoveryOperator", "SETRYN_EXCESS_RECOVERY_OPERATOR"],
    ["privacyKeyPublisher", "SETRYN_PRIVACY_KEY_PUBLISHER"],
    ["lifecycleWitnessStager", "SETRYN_LIFECYCLE_WITNESS_STAGER"],
  ]) {
    if (principals?.[key]?.source !== source) throw new Error(`${manifest.environment} principal ${key} drifted`);
  }
  if (!manifest.phase2.qualificationEvidence) {
    throw new Error(`${manifest.environment} qualification evidence policy is missing`);
  }
  if (manifest.environment === "arbitrum-one") {
    if (manifest.status !== "disabled" || manifest.broadcast.enabled || manifest.broadcast.signed) {
      throw new Error("Arbitrum One must remain structurally disabled");
    }
  }
}

for (const name of inventoryNames) {
  if (!generator.includes(`["${name}",`)) {
    throw new Error(`Internal binding generator is missing ${name}`);
  }
}
for (const contract of inventory.contracts) {
  if (contract.activation === "planned" && !deploymentScript.includes(contract.name)) {
    throw new Error(`Deployment script is missing planned contract ${contract.name}`);
  }
  if (contract.activation === "blocked" && deploymentScript.includes(`new ${contract.name}(`)) {
    throw new Error(`Deployment script invents blocked dependency wiring for ${contract.name}`);
  }
}
// Linked-library topology must match the compiled production artifacts exactly.
const declaredLibraries = inventory.linkedLibraries;
if (!Array.isArray(declaredLibraries)) throw new Error("Phase 2 linked-library inventory is missing");
assertUnique(declaredLibraries.map(({ name }) => name), "linked library");
const observedLinks = new Map();
for (const directory of readdirSync(resolve(repositoryRoot, "contracts/out"))) {
  const directoryPath = resolve(repositoryRoot, "contracts/out", directory);
  if (!statSync(directoryPath).isDirectory()) continue;
  for (const file of readdirSync(directoryPath)) {
    if (!file.endsWith(".json")) continue;
    const artifact = JSON.parse(readFileSync(resolve(directoryPath, file), "utf8"));
    const target = Object.keys(artifact.metadata?.settings?.compilationTarget ?? {})[0] ?? "";
    if (!target.startsWith("src/")) continue;
    for (const [source, libraries] of Object.entries(artifact.bytecode?.linkReferences ?? {})) {
      for (const library of Object.keys(libraries)) {
        const entry = observedLinks.get(library) ?? { source: `contracts/${source}`, linkedBy: new Set() };
        entry.linkedBy.add(file.replace(/\.json$/, ""));
        observedLinks.set(library, entry);
      }
    }
  }
}
if (observedLinks.size !== declaredLibraries.length) {
  throw new Error(`Linked-library inventory declares ${declaredLibraries.length} libraries; artifacts link ${observedLinks.size}`);
}
for (const library of declaredLibraries) {
  const observed = observedLinks.get(library.name);
  if (!observed || observed.source !== library.source) {
    throw new Error(`Linked library ${library.name} drifted from the compiled artifacts`);
  }
  if (JSON.stringify([...observed.linkedBy].sort()) !== JSON.stringify(library.linkedBy)) {
    throw new Error(`Linked library ${library.name} linkers drifted from the compiled artifacts`);
  }
}

if (!deploymentScript.includes("ArbitrumOneDeploymentDisabled")) {
  throw new Error("Deployment script lost the Arbitrum One hard stop");
}
for (const marker of ["EXPOSURE_REDUCER_ROLE", "beginDefaultAdminTransfer", "POST_WIRING_EVIDENCE_HASH"]) {
  if (!deploymentScript.includes(marker)) throw new Error(`Deployment script lost ${marker}`);
}

process.stdout.write("Phase 2 deployment, binding, and projection inventory is internally consistent.\n");

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} names must be unique`);
}
