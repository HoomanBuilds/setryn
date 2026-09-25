import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const outputPath = resolve(packageRoot, "src/generated/contracts.generated.ts");
const checkOnly = process.argv.includes("--check");
const allowPartial = process.argv.includes("--allow-partial");

const contracts = [
  ["AssetRegistry", "contracts/out/AssetRegistry.sol/AssetRegistry.json"],
  ["SettlementAssetRegistry", "contracts/out/SettlementAssetRegistry.sol/SettlementAssetRegistry.json"],
  ["AdapterRegistry", "contracts/out/AdapterRegistry.sol/AdapterRegistry.json"],
  ["CalendarRegistry", "contracts/out/CalendarRegistry.sol/CalendarRegistry.json"],
  ["SessionRegistry", "contracts/out/SessionRegistry.sol/SessionRegistry.json"],
  ["BenchmarkRegistry", "contracts/out/BenchmarkRegistry.sol/BenchmarkRegistry.json"],
  ["FeeScheduleRegistry", "contracts/out/FeeScheduleRegistry.sol/FeeScheduleRegistry.json"],
  ["RiskDomainRegistry", "contracts/out/RiskDomainRegistry.sol/RiskDomainRegistry.json"],
  ["InstrumentRegistry", "contracts/out/InstrumentRegistry.sol/InstrumentRegistry.json"],
  ["MarketRegistry", "contracts/out/MarketRegistry.sol/MarketRegistry.json"],
  ["SeriesRegistry", "contracts/out/SeriesRegistry.sol/SeriesRegistry.json"],
  ["CollateralVault", "contracts/out/CollateralVault.sol/CollateralVault.json"],
];

const bindings = {};
for (const [contractName, artifactPath] of contracts) {
  const absolutePath = resolve(repositoryRoot, artifactPath);
  let artifact;
  try {
    artifact = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      if (allowPartial) {
        continue;
      }
      throw new Error(`Missing Foundry artifact ${artifactPath}. Run the contract build before binding generation.`);
    }
    throw error;
  }
  const metadata = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
  if (!Array.isArray(artifact.abi) || typeof metadata?.settings?.compilationTarget !== "object") {
    throw new Error(`Malformed Foundry artifact ${artifactPath}`);
  }
  const [sourceName] = Object.keys(metadata.settings.compilationTarget);
  bindings[contractName] = {
    artifact: artifactPath,
    sourceName,
    contractName,
    abi: artifact.abi,
  };
}

if (Object.keys(bindings).length === 0) {
  throw new Error("No Foundry artifacts were available for internal binding generation.");
}

const serialized = JSON.stringify(bindings, null, 2);
const hash = createHash("sha256").update(serialized).digest("hex");
const generated = [
  'import type { InternalContractBinding } from "../types.ts";',
  "",
  `export const generatedBindingsHash = \"sha256:${hash}\";`,
  "",
  `export const contractBindings = ${serialized} as const satisfies Record<string, InternalContractBinding>;`,
  "",
].join("\n");

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write("Internal contract bindings are stale. Run pnpm internal:bindings:generate after forge build.\n");
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated);
}
