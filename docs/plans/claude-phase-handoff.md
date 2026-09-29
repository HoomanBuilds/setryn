# Setryn Implementation Handoff

Date: 2026-09-29

Status: Phase 4 in progress

Repository: `Shreyassp002/setryn-temp`

## Product

Setryn is a private dated-risk exchange and clearing protocol on Arbitrum. Users trade fixed-expiry exposures and complete multi-leg strategies through public books, private RFQs, auctions, and solver competition. The protocol owns collateral, clearing, portfolio risk, lifecycle operations, fixing, settlement, recovery, and verifiable receipts. It is a complete first-party trading platform, not a router, privacy wrapper, or API-first service.

The canonical product scope is defined in:

- `docs/plans/setryn-product-and-phase-overview.md`
- `docs/plans/setryn-mainnet-equivalent-build-plan.md`
- `docs/specs/setryn-interface-spec.md`
- `docs/research/setryn-full-product-feature-map-2026-09-19.md`

## Non-negotiable operating rules

- Never submit a mainnet transaction, deploy to mainnet, spend mainnet funds, or configure live mainnet execution without explicit user approval.
- Use local development, a pinned Arbitrum One fork, and Arbitrum Sepolia for implementation and qualification.
- Build the first-party user trading platform before public APIs, external SDKs, webhooks, widgets, or partner tooling.
- Keep the market universe, assets, collateral, instruments, benchmarks, adapters, and risk domains extensible through versioned registries.
- Treat `inspiration/` and `landing-page/` as temporary reference inputs, never runtime dependencies or sources of truth.
- Prefer fast phase progression and targeted verification at the phase gate. Do not run broad repetitive reviews after every small slice.

## Immediate landing-page migration

The root `landing-page/` directory is a temporary copy of the approved Setryn landing application. It is intentionally not registered in the pnpm workspace and is not integrated into runtime code.

Complete this migration as the first bounded frontend slice:

1. Move the approved landing experience into `apps/web` using the existing web application's routing, package manager, TypeScript, Tailwind, shared providers, and build conventions.
2. Preserve the existing trading application and authenticated product routes. The landing page must become the public root experience without replacing or weakening the terminal.
3. Preserve the landing page's appearance, motion, typography, responsive behavior, assets, and interactions. Adapt implementation details only where required by the destination application.
4. Consolidate dependencies into the root pnpm lockfile. Do not retain the nested npm project or its lockfile.
5. Keep landing assets local and verify that no temporary absolute path or source-repository reference remains.
6. Run only targeted lint, typecheck, and build checks for the changed web surface.
7. Delete `landing-page/` after the integrated route is verified and commit the migration as one logical change.

## Current phase position

Phases 1 through 3 established the protocol foundations, first-party product shell, market and portfolio surfaces, canonical schemas, indexing paths, and production-shaped contract graph. Phase 4 is qualifying that graph against pinned Arbitrum dependencies before an Arbitrum Sepolia release candidate.

Completed Phase 4 work includes:

- pinned Arbitrum production dependency addresses and code-hash checks;
- Chainlink sequencer health and historical fixing adapters;
- Pyth Core pull oracle support;
- atomic Uniswap V3 and Aave V3 adapters;
- bounded GMX V2 order execution support;
- local production deployment rehearsal with separated principals;
- a complete pinned-fork settlement journey;
- risk, collateral authority, and fee-recipient wiring fixes;
- initial unsigned deployment bundle tooling and qualification evidence.

## Phase 4 blockers to resolve

### Mainnet deployability

The production Solidity graph compiles locally only with a development code-size override. Ten deployed contracts exceed the EIP-170 runtime limit, and `AtomicClearingEngine` also exceeds the EIP-3860 initcode limit. Arbitrum Sepolia deployment is blocked until these contracts are modularized.

Use a static, auditable module or facet architecture that preserves each public protocol address and interface while splitting implementation bytecode. Keep selector topology immutable after deployment unless the existing governed and timelocked upgrade model explicitly requires otherwise. Preserve storage layout, roles, events, state transitions, and terminal-resolution guarantees.

Every deployed runtime must be at most 24,576 bytes and every initcode payload at most 49,152 bytes under the pinned production compiler profile.

Affected contracts:

- `CollateralVault`
- `SeriesRegistry`
- `PositionEngine`
- `PortfolioRiskEngine`
- `AtomicClearingEngine`
- `PrivateRfqBook`
- `PositionLifecycleExecutor`
- `DefaultProcessEngine`
- `CashSettlementCoordinator`
- `OperationalAdapterExecutor`

### Pinned-fork failures

The last focused fork run passed 23 of 26 cases. Resolve these three cases without weakening or skipping their assertions:

1. Update the Uniswap adapter for Arbitrum SwapRouter02. The configured router uses the `exactInputSingle` tuple without a deadline, not the legacy router tuple with a deadline.
2. Replace synthetic native-USDC balance mutation in the Aave value-moving case with a deterministic transfer from a real funded holder on the pinned fork.
3. Update the control rehearsal to expect the full encoded `AdapterUnavailable(adapterId, version)` error after version 1 is paused and version 2 is activated.

Use an archive-capable Arbitrum RPC for block `509990000`. Public RPCs that prune historical state are insufficient for the pinned qualification.

### Unsigned bundle tooling

`scripts/build-arbitrum-one-unsigned-intent.mjs` and `deployments/arbitrum-one/qualification/` are preserved work in progress. The current intent covers only a bounded prefix of the deployment graph and must not be described as a complete deployable bundle. It currently includes 19 of 49 contract creations and 25 configuration calls. Remove the duplicate operation identifier and complete regeneration only after all production contracts satisfy deployment size limits.

This tooling is read-only. It must never sign, broadcast, unlock accounts, fund accounts, or write to any chain.

## Phase sequence after the blockers

1. Finish Phase 4 contract modularization, pinned-fork qualification, gas evidence, and complete unsigned deployment intent.
2. Run the Phase 4 gate with production-profile compilation, size checks, the focused fork suite, and deployment rehearsal.
3. Continue Phase 5 first-party trading workflows: live coherent market data, order entry, public book, private RFQ, collateral, positions, lifecycle, and receipts.
4. Continue Phase 6 maker, solver, risk, and operations workspaces.
5. Continue Phase 7 Arbitrum Sepolia release-candidate deployment, monitoring, evidence, and complete user journeys.
6. Build Phase 8 public APIs, SDKs, webhooks, widgets, and partner tooling only after the first-party platform is complete.
7. Treat any mainnet activation as a separate user-authorized launch phase with funded-operation research, governance, audits, caps, and explicit approval.

## Implementation prompt

Work through Setryn phase by phase from the current Phase 4 position. First integrate the temporary `landing-page/` application into `apps/web` exactly as specified above, then delete the temporary folder. Next resolve the ten-contract deployability blocker without reducing protocol scope or weakening security, fix the three pinned-fork failures, and complete the read-only unsigned deployment evidence. Make logical one-line conventional commits after bounded slices. Keep verification targeted to changed surfaces and run the full phase gate only when Phase 4 deliverables are complete. Never perform a mainnet write. After Phase 4 passes, proceed through the remaining first-party platform phases in the documented order and stop public API or SDK work until the user product is complete.
