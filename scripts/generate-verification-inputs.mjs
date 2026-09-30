#!/usr/bin/env node
// Explorer verification inputs for a broadcast deployment. Reads the deployment evidence manifest and, for every
// deployed contract and linked library, resolves the fully qualified source name, the ABI-encoded constructor
// arguments, and the library links, then writes `verification.json` and a `verify.sh` of `forge verify-contract`
// commands that recompile with the pinned profile. It sends no transactions and makes no network calls.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  process.stdout.write(`Usage:
  node scripts/generate-verification-inputs.mjs --manifest deployments/<environment>/manifest.json [--output <directory>]

Writes verification.json and verify.sh next to the manifest unless --output is given.
Run verify.sh with ETHERSCAN_API_KEY set; it only submits source for verification.
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
    if (argument !== "--manifest" && argument !== "--output") throw new Error(`Unknown argument ${argument}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.manifest) {
    usage();
    process.exit(1);
  }
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function artifactFor(path) {
  const absolute = resolve(repositoryRoot, path);
  if (!existsSync(absolute)) throw new Error(`Missing artifact ${path}. Build the contracts first: forge build`);
  return JSON.parse(readFileSync(absolute, "utf8"));
}

/** `src/path/File.sol:Name` as compiled, taken from the artifact's own compilation target. */
function qualifiedName(artifact, name) {
  const targets = artifact.metadata?.settings?.compilationTarget ?? {};
  const source = Object.entries(targets).find(([, target]) => target === name)?.[0];
  if (!source) throw new Error(`Artifact for ${name} has no compilation target`);
  return `${source}:${name}`;
}

/** Evidence names sibling contracts as `$contracts.<Name>.address`; resolve them to deployed addresses. */
let addressOf = new Map();

function resolveValue(value) {
  if (typeof value === "string" && value.startsWith("$contracts.")) {
    const name = value.split(".")[1];
    const address = addressOf.get(name);
    if (!address) throw new Error(`Constructor argument references undeployed contract ${name}`);
    return address;
  }
  return value;
}

function encodeNamedArguments(contractName, rawArguments) {
  if (rawArguments.length === 0) return "";
  const argumentsList = rawArguments.map((argument) => ({ ...argument, value: resolveValue(argument.value) }));
  if (argumentsList.some(({ value }) => value === null || value === undefined)) {
    throw new Error(`${contractName} has unresolved constructor arguments; the manifest is not broadcast evidence`);
  }
  const signature = `constructor(${argumentsList.map(({ type }) => type).join(",")})`;
  const values = argumentsList.map(({ value }) => (typeof value === "string" ? value : JSON.stringify(value)));
  return execFileSync("cast", ["abi-encode", signature, ...values], { encoding: "utf8" }).trim().replace(/^0x/, "");
}

/** Constructor arguments as recorded by the evidence generator: named values, raw ABI data, or unavailable. */
/** Canonical ABI type: tuples expand to their component types, keeping any array suffix. */
function canonicalType(input) {
  if (!input.type.startsWith("tuple")) return input.type;
  return `(${input.components.map(canonicalType).join(",")})${input.type.slice("tuple".length)}`;
}

function constructorArguments(contractName, recorded, artifact) {
  if (!Array.isArray(recorded) || recorded.length === 0) return { hex: "", available: true };
  // Foundry-named creations record bare values; their types come from the artifact's constructor.
  if (recorded.every((value) => typeof value !== "object" || value === null)) {
    const inputs = artifact.abi.find((item) => item.type === "constructor")?.inputs ?? [];
    if (inputs.length !== recorded.length) throw new Error(`${contractName} constructor arity differs from its artifact`);
    return {
      hex: encodeNamedArguments(contractName, inputs.map((input, index) => ({ type: canonicalType(input), value: recorded[index] }))),
      available: true,
    };
  }
  if (recorded[0]?.encoding === "abi") return { hex: recorded[0].data.replace(/^0x/, ""), available: true };
  // Named template arguments may carry the complete ABI encoding in one value when read back from the broadcast.
  const encoded = recorded.find(({ value }) => value && typeof value === "object" && value.encoding === "abi");
  if (encoded) return { hex: encoded.value.data.replace(/^0x/, ""), available: true };
  if (recorded[0]?.encoding === "unavailable") return { hex: null, available: false };
  return { hex: encodeNamedArguments(contractName, recorded), available: true };
}

function libraryLinks(artifact, libraryAddresses) {
  const links = [];
  for (const [source, libraries] of Object.entries(artifact.bytecode?.linkReferences ?? {})) {
    for (const name of Object.keys(libraries)) {
      const address = libraryAddresses.get(name);
      if (!address) throw new Error(`Linked library ${name} has no recorded deployment`);
      links.push(`${source}:${name}:${address}`);
    }
  }
  return links.sort();
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = readJson(options.manifest);
  if (manifest.status !== "broadcast") {
    throw new Error(`${options.manifest} is ${manifest.status}; verification inputs need broadcast evidence`);
  }
  const { compiler, chainId } = manifest;
  const libraryAddresses = new Map((manifest.linkedLibraries ?? []).map(({ name, address }) => [name, address]));
  addressOf = new Map(
    [...manifest.contracts, ...(manifest.phase2?.deployments ?? [])]
      .filter((contract) => contract.address)
      .map((contract) => [contract.name, contract.address]),
  );
  const deployed = [
    ...(manifest.linkedLibraries ?? []).map((library) => ({ ...library, constructorArguments: [] })),
    ...manifest.contracts.filter((contract) => contract.address),
    ...(manifest.phase2?.deployments ?? []),
  ];

  const entries = deployed.map((contract) => {
    const artifact = artifactFor(contract.artifact);
    const contractId = qualifiedName(artifact, contract.name);
    const args = constructorArguments(contract.name, contract.constructorArguments, artifact);
    const libraries = libraryLinks(artifact, libraryAddresses);
    const command = [
      "forge",
      "verify-contract",
      contract.address,
      contractId,
      "--root",
      "contracts",
      "--chain",
      String(chainId),
      "--compiler-version",
      `v${compiler.version}`,
      "--evm-version",
      compiler.evmVersion,
      ...(compiler.optimizer.enabled ? ["--num-of-optimizations", String(compiler.optimizer.runs)] : []),
      ...(compiler.viaIR ? ["--via-ir"] : []),
      ...(args.hex ? ["--constructor-args", `0x${args.hex}`] : []),
      ...libraries.flatMap((link) => ["--libraries", link]),
      "--watch",
    ];
    return {
      name: contract.name,
      address: contract.address,
      contract: contractId,
      constructorArguments: args.available ? `0x${args.hex}` : null,
      libraries,
      command: args.available ? command.map(shellQuote).join(" ") : null,
      note: args.available ? null : "Constructor arguments were not recoverable from the broadcast; verify manually.",
    };
  });

  const outputDirectory = resolve(repositoryRoot, options.output ?? dirname(options.manifest));
  mkdirSync(outputDirectory, { recursive: true });
  const record = {
    environment: manifest.environment,
    chainId,
    sourceCommit: manifest.sourceCommit,
    compiler,
    contracts: entries,
  };
  writeFileSync(resolve(outputDirectory, "verification.json"), `${JSON.stringify(record, null, 2)}\n`);
  const script = [
    "#!/usr/bin/env bash",
    "# Generated by scripts/generate-verification-inputs.mjs. Submits source for explorer verification only.",
    "set -Eeuo pipefail",
    'cd "$(dirname "${BASH_SOURCE[0]}")/' + relative(outputDirectory, repositoryRoot).replaceAll("\\", "/") + '"',
    ': "${ETHERSCAN_API_KEY:?Set ETHERSCAN_API_KEY to the Arbiscan API key}"',
    "",
    ...entries.map((entry) => (entry.command ? entry.command : `# ${entry.name} ${entry.address}: ${entry.note}`)),
    "",
  ].join("\n");
  writeFileSync(resolve(outputDirectory, "verify.sh"), script, { mode: 0o755 });
  const manual = entries.filter((entry) => !entry.command).length;
  process.stdout.write(
    `Wrote verification inputs for ${entries.length} deployments (${manual} need manual constructor arguments) to ${relative(repositoryRoot, outputDirectory)}.\n`,
  );
}

main();
