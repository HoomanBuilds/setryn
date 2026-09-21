# Setryn

Setryn is a package-native exchange protocol on Arbitrum. It is designed to own the complete market lifecycle for structured onchain positions: definition, liquidity, execution, collateral, risk, settlement, lifecycle operations, and verifiable evidence.

## Repository

- `contracts/`: standalone Foundry workspace and protocol contracts
- `apps/web/`: Next.js exchange and professional workstations
- `packages/`: canonical schemas, financial math, SDK, client core, and shared UI
- `services/`: indexing, execution, risk, lifecycle, maker, privacy, and receipt processes
- `deployments/`: tracked Sepolia and Arbitrum One deployment evidence
- `infra/`: local and production infrastructure definitions

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

## Testing

`pnpm check` is the routine gate. Its contract step skips the invariant suite so the loop stays fast.

```bash
pnpm check           # routine: lint, typecheck, build, unit and fuzz tests
pnpm check:full      # milestone: routine check plus the invariant suite
```

Invariant runs can also be taken on their own with `pnpm contracts:test:invariant`, and the entire
Forge suite with `pnpm contracts:test:full`.

## Network safety

Development begins locally and on Arbitrum Sepolia. Arbitrum One remains read-only until the launch gate is approved. No script may broadcast a mainnet transaction by default.
