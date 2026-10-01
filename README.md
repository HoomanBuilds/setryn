# Setryn

Setryn is a package-native exchange protocol on Arbitrum. It is designed to own the complete market lifecycle for structured onchain positions: definition, liquidity, execution, collateral, risk, settlement, lifecycle operations, and verifiable evidence.

## Repository

- `contracts/`: standalone Foundry workspace and protocol contracts
- `apps/web/`: Next.js exchange and professional workstations
- `packages/`: canonical schemas, financial math, SDK, client core, and shared UI
- `services/`: the operator runtime (maker, solver, keeper, oracle relay) and the webhook worker
- `deployments/`: local runtime, Sepolia and Arbitrum One manifests, and the unsigned Arbitrum One deployment intent
- `scripts/`: local deployment, deployment evidence, verification inputs, fee updates, and manifest validation
- `docs/`: specifications, plans, research, and incident runbooks

Directories are added only when their first real consumer is implemented.

## Requirements

- Node.js 22 or newer
- pnpm 11.24.0
- Foundry stable

## Setup

```bash
git submodule update --init --recursive
pnpm install
pnpm check
```

Start the web application with:

```bash
pnpm dev
```

## Local chain

```bash
bash scripts/local-deploy-reset.sh          # anvil on 127.0.0.1:8545 (chain 31337), full deployment and 16 markets
pnpm dev                                    # web app on http://localhost:3000
node scripts/update-devnet-fees.mjs --maker-bps 5 --taker-bps 10   # publish a new fee version locally
```

The reset writes `deployments/local/runtime.json`, which the web app, public API and operator runtime read. The local
chain starts on the market calendar's clock (2026-09-22 09:00 UTC) so the trading session is open.

## Testing

`pnpm check` is the routine gate. Its contract step skips the invariant suite so the loop stays fast.

```bash
pnpm check           # routine: lint, typecheck, build, unit and fuzz tests
pnpm check:full      # milestone: routine check plus the invariant suite
```

Invariant runs can also be taken on their own with `pnpm contracts:test:invariant`, and the entire
Forge suite with `pnpm contracts:test:full`.

## Network safety

Development runs on the local chain. The owner deploys to Arbitrum Sepolia and Arbitrum One; see "Before you deploy" in
[docs/plans/claude-phase-handoff.md](docs/plans/claude-phase-handoff.md). Arbitrum One remains read-only until the
launch gate is approved, and no script broadcasts a mainnet transaction: public-chain fee changes print unsigned
calldata for governance instead.
