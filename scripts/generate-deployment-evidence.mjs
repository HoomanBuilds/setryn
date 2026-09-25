#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

function transactionHash(transaction) {
  return transaction.hash ?? transaction.transactionHash ?? null;
}

function receiptByHash(receipts) {
  return new Map(receipts.map((receipt) => [receipt.transactionHash?.toLowerCase(), receipt]));
}

function artifactFor(contractName) {
  return readJson(resolve(repositoryRoot, "contracts", "out", `${contractName}.sol`, `${contractName}.json`));
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
  const creates = broadcast.transactions.filter(
    (transaction) => transaction.transactionType === "CREATE" && transaction.contractName,
  );
  const receipts = receiptByHash(broadcast.receipts ?? []);
  if (creates.length === 0) {
    throw new Error("Broadcast artifact contains no contract creation transactions.");
  }

  const blockNumbers = creates.map((transaction) => {
    const receipt = receipts.get(transactionHash(transaction)?.toLowerCase());
    if (!receipt?.blockNumber) {
      throw new Error(`Missing receipt for ${transaction.contractName}.`);
    }
    return Number.parseInt(receipt.blockNumber, 16);
  });
  const finalBlockNumber = Math.max(...blockNumbers);
  const blockTag = `0x${finalBlockNumber.toString(16)}`;
  const finalBlock = await rpc(rpcUrl, "eth_getBlockByNumber", [blockTag, false]);

  const templatePath = resolve(repositoryRoot, environment.template);
  const manifest = structuredClone(readJson(templatePath));
  if (options.environment === "local") {
    manifest.externalDependencies = [];
  }
  const templateContracts = new Map(manifest.contracts.map((contract) => [contract.name, contract]));
  let compiler;

  for (const transaction of creates) {
    const contract = templateContracts.get(transaction.contractName);
    if (!contract) {
      throw new Error(`No manifest entry exists for ${transaction.contractName}.`);
    }
    const receipt = receipts.get(transactionHash(transaction).toLowerCase());
    const address = transaction.contractAddress ?? receipt.contractAddress;
    const runtimeCode = await rpc(rpcUrl, "eth_getCode", [address, blockTag]);
    if (runtimeCode === "0x") {
      throw new Error(`No bytecode found for ${transaction.contractName} at ${address}.`);
    }

    const artifact = artifactFor(transaction.contractName);
    compiler ??= compilerMetadata(artifact);
    contract.address = address;
    contract.bytecode.creationCodeHash = keccak(artifact.bytecode.object);
    contract.bytecode.runtimeCodeHash = keccak(runtimeCode);
    contract.deploymentTransaction = {
      hash: transactionHash(transaction),
      blockNumber: Number.parseInt(receipt.blockNumber, 16),
      broadcast: true,
    };

    if (Array.isArray(transaction.arguments)) {
      contract.constructorArguments.forEach((argument, index) => {
        argument.value = transaction.arguments[index] ?? argument.value;
      });
      const argumentValues = new Map(contract.constructorArguments.map((argument) => [argument.name, argument.value]));
      contract.caps.forEach((cap) => {
        if (argumentValues.has(cap.name)) {
          cap.value = argumentValues.get(cap.name);
        }
      });
      const initialAdmin = transaction.arguments[1];
      if (typeof initialAdmin === "string" && /^0x[0-9a-fA-F]{40}$/.test(initialAdmin)) {
        contract.owner.address = initialAdmin;
        contract.roles.forEach((role) => {
          role.members.forEach((member) => {
            if (member.source === "SETRYN_INITIAL_ADMIN") {
              member.address = initialAdmin;
            }
          });
        });
      }
    }
  }

  const missingContracts = manifest.contracts.filter((contract) => !contract.address);
  if (missingContracts.length > 0) {
    throw new Error(`Broadcast evidence is missing: ${missingContracts.map((contract) => contract.name).join(", ")}.`);
  }

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
  manifest.broadcast = {
    enabled: true,
    signed: options.environment !== "local",
    transactionCount: creates.length,
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
