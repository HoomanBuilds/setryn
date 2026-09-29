#!/usr/bin/env node
// Render the Arbitrum One gas report from the unsigned bundle and intent. Pure file transformation:
// no network access, no signing, no broadcast.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const qualification = resolve(repositoryRoot, "deployments/arbitrum-one/qualification");
const intent = JSON.parse(readFileSync(resolve(qualification, "arbitrum-one-unsigned-deployment-intent.json"), "utf8"));
const bundle = JSON.parse(readFileSync(resolve(qualification, "arbitrum-one-unsigned-bundle.json"), "utf8"));

const WEI_PER_ETH = 10n ** 18n;
const eth = (wei) => {
  const value = BigInt(wei);
  const whole = value / WEI_PER_ETH;
  const fraction = (value % WEI_PER_ETH).toString().padStart(18, "0").slice(0, 8);
  return `${whole}.${fraction}`;
};
const gwei = (hex) => (Number(BigInt(hex)) / 1e9).toFixed(4);

const operations = new Map(intent.operations.map((op) => [op.id, op]));
const rows = bundle.transactions.map((tx) => {
  const op = operations.get(tx.id);
  const kind = op.linkedLibrary ? "LIBRARY" : tx.kind;
  const target = op.linkedLibrary ? op.create2.expectedAddress : tx.kind === "CREATE" ? op.expectedAddress : tx.to;
  const l1 = `${BigInt(tx.estimatedL1GasPinned ?? 0)} / ${BigInt(tx.estimatedL1GasLatest ?? 0)}`;
  return `| ${tx.order} | ${tx.id} | ${kind} | \`${target}\` | ${BigInt(tx.estimatedGasPinned)} | ${BigInt(tx.estimatedGasLatest)} | ${l1} | ${BigInt(tx.gas)} |`;
});
const totalGas = bundle.transactions.reduce((sum, tx) => sum + BigInt(tx.gas), 0n);
const totalL1Pinned = bundle.transactions.reduce((sum, tx) => sum + BigInt(tx.estimatedL1GasPinned ?? 0), 0n);
const totalL1Latest = bundle.transactions.reduce((sum, tx) => sum + BigInt(tx.estimatedL1GasLatest ?? 0), 0n);

const report = `# Arbitrum One Unsigned Deployment Gas Report (Planning Only)

This is a production planning artifact, not a claim that deployment was executed. No transaction was sent,
signed, broadcast, funded, or unlocked on Arbitrum One. Mainnet access was read-only. Dependent operations were
estimated with \`eth_estimateGas\` in canonical order on loopback Anvil forks of the pinned and latest blocks,
which are the only processes that received writes. Local forks meter only L2 execution, so each operation's Arbitrum
L1 data-posting gas was read with a read-only \`eth_call\` to NodeInterface \`gasEstimateL1Component\` at both
blocks and added to that block's estimate.

## Scope

- Complete DeploySetryn production graph from \`${intent.source.planningScript}\`.
- ${intent.counts.contractCreations} contract creations, ${intent.counts.libraryCreations} linked-library creations, and ${intent.counts.configurationCalls} configuration calls (${intent.counts.operations} operations).
- Pinned block ${intent.pinnedBlockReference} (\`${intent.pinnedBlockHash}\`); latest block ${bundle.latestBlock.number} (\`${bundle.latestBlock.hash}\`).
- Estimation mode: \`${bundle.estimationMode}\`. Each operation uses the larger of its pinned and latest estimates.
- Planning sender \`${intent.deployer}\` is keyless and not an approved deployer. Principals are A4B1 planning placeholders.

## Budget

| Item | Value |
| --- | --- |
| Total gas limit | ${totalGas} |
| L1 data-posting gas at the pinned block | ${totalL1Pinned} |
| L1 data-posting gas at the latest block | ${totalL1Latest} |
| Base fee | ${gwei(bundle.feeEvidence.baseFeePerGas)} gwei |
| Max priority fee | ${gwei(bundle.feeEvidence.maxPriorityFeePerGas)} gwei |
| Max fee per gas (2 x base + priority) | ${gwei(bundle.feeEvidence.maxFeePerGas)} gwei |
| Aggregate maximum network cost | ${eth(bundle.gasBudget.aggregateMaxFeeWei)} ETH |
| Deployer requirement with ${bundle.gasBudget.reserveMultiplier}x reserve | ${eth(bundle.gasBudget.reserveRequirementWei)} ETH |

Protocol capital (collateral, keeper, oracle, sponsorship, and insurance budgets) is outside this estimate and needs
separate launch approval.

## External dependencies (code-hash stable between pinned and latest)

${bundle.dependencies.map((dep) => `- ${dep.name}: \`${dep.address}\` \`${dep.pinnedCodeHash}\``).join("\n")}

## Operations

Linked libraries (\`LIBRARY\`) are CALLs to the deterministic CREATE2 deployer; the address is the derived library
address. Pinned and latest gas include the L1 component shown in the L1 column.

| Order | Operation | Kind | Address | Pinned gas | Latest gas | L1 gas (pinned / latest) | Gas limit |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

Bundle hash: \`${bundle.bundleHash}\`. Source intent hash: \`${bundle.sourceIntentHash}\`.
`;
writeFileSync(resolve(qualification, "arbitrum-one-gas-report.md"), report);
process.stdout.write("Wrote deployments/arbitrum-one/qualification/arbitrum-one-gas-report.md\n");
