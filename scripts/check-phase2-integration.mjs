#!/usr/bin/env node

import { readFileSync } from "node:fs";
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
const inventoryNames = inventory.contracts.map(({ name }) => name);
assertUnique(inventoryNames, "inventory contract");
for (const contract of inventory.contracts) {
  for (const field of ["dependencies", "roleAuthority", "supported", "disabled"]) {
    if (!Array.isArray(contract[field])) throw new Error(`${contract.name} has invalid ${field}`);
  }
  if (!['planned', 'blocked'].includes(contract.activation)) {
    throw new Error(`${contract.name} has invalid activation state`);
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
if (!deploymentScript.includes("ArbitrumOneDeploymentDisabled")) {
  throw new Error("Deployment script lost the Arbitrum One hard stop");
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
