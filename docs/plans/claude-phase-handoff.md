# Setryn Implementation Handoff

Date: 2026-09-29

Status: Phase 4 gate passed; Phase 5 first-party trading workflows in progress

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

## Landing-page migration - complete

The approved landing experience now lives in `apps/web` as the public root `/` under a dedicated `(landing)` root layout, with the trading platform under a separate `(platform)` root layout. Its dependencies are in the root pnpm lockfile, its fonts, artwork, and audio are local, and the header, menu, product cards, closing call, and footer enter the platform through `/trade`, `/hedges`, `/maker`, and `/activity`. The temporary `landing-page/` folder and its nested npm project were removed after targeted lint, typecheck, build, and browser checks.

The landing's borrowed third-party fonts, artwork, and sounds were marked by its author as local-practice material. Replace or license them before any public Sepolia or mainnet hosting.

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
- modularization of every oversized contract within EIP-170 and EIP-3860 limits;
- the passing pinned fork suite, the complete unsigned deployment intent, and the L1-aware gas budget.

## Phase 4 gate - passed 2026-09-29

The Phase 4 targeted gate passed on 2026-09-29 against pinned Arbitrum One block `509990000` (`0xd5edd6e1c8caac1a8bba0aadc5f3d52aecc6cf360dbeded39e898ce101433e72`). No transaction was signed, broadcast, funded, or unlocked on Arbitrum One. Mainnet access was read-only, and every write went to a loopback Anvil process or an in-process Foundry fork.

### Deployability

Thirteen contracts were modularized: the ten listed in the original blocker, plus `SealedAuctionHouse`, `ProtocolRouteLiquiditySource`, and `GmxV2OrderAdapter`. The approach uses external libraries executed with `DELEGATECALL`, so each public protocol address, storage layout, role, event, and error ABI stays the same. Each contract:

- keeps its storage, immutables, roles, reentrancy guards, and access checks;
- moves entry bodies into linked libraries that receive storage references and an immutable dependency struct.

Errors raised from libraries are re-exported through inherited `I<Contract>LinkedErrors` interfaces, so every contract ABI is byte-identical to the pre-split ABI.

The full production build passes `forge build --sizes` under the pinned profile (solc 0.8.37, via-IR, 1 optimizer run, Cancun, no metadata hash) with no code-size override. The largest runtimes are:

| Contract | Runtime bytes |
| --- | --- |
| `PublicOrderBook` | 24,259 |
| `SignedLifecycleEngine` | 23,940 |
| `FixingEngine` | 23,502 |

Every initcode is below 49,152 bytes. `AtomicClearingEngine` dropped from over the EIP-3860 limit to 15,316 runtime and 17,571 initcode bytes.

The 24 deployed linked libraries are:

- declared in `deployments/phase2-contract-inventory.json`;
- checked against compiled artifacts by `scripts/check-phase2-integration.mjs`;
- deployed through the deterministic CREATE2 deployer;
- recorded with creation and runtime code hashes in deployment evidence.

The `EIP170_RUNTIME_SIZE_LIMIT` production blocker was removed, along with all three `--disable-code-size-limit` flags in `scripts/local-deploy-reset.sh`.

Behavior preservation was checked in four ways:

- The full contract suite without a size override has the same failing-test set as the pre-split baseline: 688 passed, 35 failed, 10 skipped.
- ABI diffs are identical for all modularized contracts.
- An audit of memory arguments mutated across library boundaries found none observable.
- An audit of string literals confirmed all 92 are identical.

The 35 failures predate this work and belong to the deferred Phase 2 gate:

| Suite | Failures |
| --- | --- |
| `PositionEngine` | 8 |
| `PrivateRfqBook` | 7 |
| `SealedAuctionHouse` | 4 |
| `PackageRegistry` | 3 |
| `CashSettlementCoordinator` | 2 |
| `DefaultProcessEngine` | 2 |
| `OperationalAdapterExecutor` | 2 |
| `OrderState` fuzz | 1 |
| `CanonicalPayoffModule` | 1 |
| `CompressionLib` | 1 |
| `FixingEngine` | 1 |
| `OrderHashLib` | 1 |
| `OrderState` | 1 |
| `VerifiableReceiptLedger` | 1 |

### Pinned fork suite

`pnpm phase4:fork:suite` (`scripts/run-arbitrum-one-fork-suite.sh` with `deployments/arbitrum-one/qualification/fork-suite.env`) passed 26 of 26 cases with 0 skipped. The runner checks the chain ID and the pinned block hash, then runs serially with bounded retries so public archive RPCs such as `https://arbitrum-one.public.blastapi.io` can serve the pinned state.

Fixes to the original fork failures:

- The Uniswap adapter uses the SwapRouter02 `exactInputSingle` tuple and still enforces the staged deadline itself.
- The Aave case funds from a real externally owned native-USDC holder with exact balance deltas. It bounds Aave liquidity-index rounding to one unit and withdraws the observed aToken balance.
- The control rehearsal expects fully encoded `AdapterUnavailable`, `RecoveryNotAvailable`, `RecoveryDeadlineElapsed`, `TerminalAction`, `AdapterCallFailed`, and `UnknownExternalAction` errors. It reads the warped timestamp with `vm.getBlockTimestamp()`, because via-IR can reuse a stale `block.timestamp` after `vm.warp`.
- The fork profiles resolve their RPC through the `arbitrum` endpoint alias instead of an uninterpolated literal.

The suite also covers the complete user and settlement journey, the deployment graph rehearsal with linked libraries, and adapter version migration, pause, bounded async recovery, and atomic rollback rehearsals.

### Deployment rehearsal and qualification evidence

- `scripts/local-deploy-reset.sh` deploys the complete graph on plain Anvil without a size override and generates evidence. That is 78 deployment transactions: 24 CREATE2 libraries and 54 contract creations. Evidence generation verifies:
  - each library's CREATE2 address and linked creation code;
  - the input prefix of each contract creation against its linked creation code.
- `pnpm phase4:fork:qualify` validates the production manifest at the pinned and latest blocks with complete dependency code hashes and no drift.
- `contracts/script/PlanArbitrumOneDeployment.s.sol` simulates `DeploySetryn._deployAndWire` on a fork of the pinned block. It refuses broadcast and resume, uses a keyless planning sender, and uses A4B1 placeholder principals.
- `scripts/build-arbitrum-one-unsigned-intent.mjs` converts that simulation into the complete unsigned intent: 219 operations, made up of 53 contract creations, 24 linked-library CREATE2 deployments, and 142 configuration calls.
- `scripts/generate-arbitrum-one-unsigned-bundle.mjs --sequential-fork true` estimates every dependent operation in canonical order on loopback Anvil forks of the pinned and latest blocks. It adds each operation's Arbitrum L1 data-posting gas from a read-only NodeInterface `eth_call`.
- The bundle totals 274,113,018 gas. At 2 x base fee plus priority (0.0401 gwei), the maximum network cost is 0.01100508 ETH, and the deployer requirement with the 2x reserve is 0.02201017 ETH. See `deployments/arbitrum-one/qualification/arbitrum-one-gas-report.md`. Protocol capital is outside this estimate.
- Before any approved signing, re-check that each library CREATE2 address is still empty or already holds the identical runtime code.

The remaining Phase 2 production blockers are unchanged:

- `CAPACITY_GRAPH_NOT_WIRED`
- `RECEIPT_AUTHORITIES_NOT_WIRED`

## Phase sequence

1. Phase 4 contract modularization, pinned-fork qualification, gas evidence, and the complete unsigned deployment intent - done.
2. Phase 4 gate with production-profile compilation, size checks, the focused fork suite, and deployment rehearsal - passed.
3. Continue Phase 5 first-party trading workflows: live coherent market data, order entry, public book, private RFQ, collateral, positions, lifecycle, and receipts.
4. Continue Phase 6 maker, solver, risk, and operations workspaces.
5. Continue Phase 7 Arbitrum Sepolia release-candidate deployment, monitoring, evidence, and complete user journeys.
6. Build Phase 8 public APIs, SDKs, webhooks, widgets, and partner tooling only after the first-party platform is complete.
7. Treat any mainnet activation as a separate user-authorized launch phase with funded-operation research, governance, audits, caps, and explicit approval.

## Implementation prompt

Work through Setryn phase by phase from the current Phase 5 position. The landing migration and the Phase 4 gate are complete. Continue with the first-party trading workflows, then the maker, solver, risk, and operations workspaces, then the Arbitrum Sepolia release candidate. Keep the remaining Phase 2 capacity and receipt-authority wiring blockers and the deferred Phase 2 and Phase 3 gates visible until they pass. Do not reduce protocol scope or weaken security. Make logical one-line conventional commits after bounded slices. Keep verification targeted to changed surfaces, and run the full phase gate only when a phase's deliverables are complete. Never perform a mainnet write. Do not start public API or SDK work until the user product is complete.
