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

## Network safety

Development begins locally and on Arbitrum Sepolia. Arbitrum One remains read-only until the launch gate is approved. No script may broadcast a mainnet transaction by default.
