#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractsRoot = join(repositoryRoot, "contracts");
const releaseInputs = ["contracts/src", "contracts/script", "contracts/foundry.toml", "contracts/lib"];

const changed = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=no", "--", ...releaseInputs],
  { cwd: repositoryRoot, encoding: "utf8" },
).trim();

if (changed) {
  process.stderr.write(`Contract release inputs must be committed before deployment:\n${changed}\n`);
  process.exit(1);
}

execFileSync("forge", ["clean", "--root", contractsRoot], { cwd: repositoryRoot, stdio: "inherit" });
execFileSync("forge", ["build", "--root", contractsRoot, "--force"], { cwd: repositoryRoot, stdio: "inherit" });
execFileSync(process.execPath, [join(repositoryRoot, "scripts", "generate-deploy-artifacts.mjs"), "--check"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

process.stdout.write(`Contract release artifacts rebuilt from committed source at ${execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim()}.\n`);
