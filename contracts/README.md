# Setryn contracts

This Foundry workspace implements Setryn's fixed-expiry exchange and clearing protocol on Arbitrum.

The current Arbitrum Sepolia release contains **88 deployed contracts**:

- 12 foundational registries and the collateral vault;
- 73 exchange, execution, lifecycle, payoff, capacity, routing, and evidence contracts;
- 3 Sepolia market-bootstrap contracts for test collateral, fixing, and fully collateralized risk.

The complete address table below is intentionally kept here rather than in the root README. Presence in the deployment proves that a module is part of the deployed protocol graph. It does not, by itself, mean a market or liquidity program has activated that module.

## Contents

- [Architecture](#architecture)
- [Complete Arbitrum Sepolia deployment](#complete-arbitrum-sepolia-deployment)
- [Contract source layout](#contract-source-layout)
- [Build and test](#build-and-test)
- [Deployment and evidence](#deployment-and-evidence)
- [Network policy](#network-policy)

## Architecture

```text
Versioned registries
  -> market, instrument, series, benchmark, calendar, session, fees, risk domain

Signed order or quote
  -> validation gates
  -> portfolio risk and funded collateral reservation
  -> public book, RFQ, stream, auction, batch, or route
  -> atomic clearing and funded fees
  -> canonical positions
  -> lifecycle, fixing, settlement, default, or recovery
  -> verifiable evidence
```

The protocol is split so a new asset, payoff, execution adapter, calendar, benchmark, or market can be registered and qualified without redeploying unrelated state. Each active series pins exact versions of every economic dependency. Historical positions continue under those pinned versions after new versions are added.

## Complete Arbitrum Sepolia deployment

| Item | Value |
| --- | --- |
| Network | Arbitrum Sepolia |
| Chain ID | `421614` |
| Explorer | [sepolia.arbiscan.io](https://sepolia.arbiscan.io) |
| Core deployment | 85 contract creations |
| Market bootstrap | 3 contract creations and 15 qualified series |
| Core source commit | `c97ef9c43ef9a708d202da24ccbfd1b78e73255b` |
| Runtime schema | `11` |

The canonical machine-readable records are [`manifest.json`](../deployments/arbitrum-sepolia/manifest.json) and [`runtime.json`](../deployments/arbitrum-sepolia/runtime.json). The manifest separates the first 12 contracts under `contracts` and the next 73 under `phase2.deployments`. The final 3 addresses come from the market bootstrap and are recorded in the runtime and broadcast evidence.

### Foundational registries and collateral

| Contract | Address | Responsibility |
| --- | --- | --- |
| AssetRegistry | `0x3dfaac6087017430badf369dc3a5fc305e387740` | Versioned asset identity, decimals, and qualification |
| AdapterRegistry | `0xe1c141586149b73290db13abdd203d7a4e384b41` | Qualified external and internal adapter definitions |
| CalendarRegistry | `0x36d8aed2b88fc5621f053e316e72e24801adf75b` | Versioned business-day and holiday calendars |
| SessionRegistry | `0xa9670a116406556411b0c67db7e32c7c00a97d15` | Versioned trading and observation session windows |
| SettlementAssetRegistry | `0x0e6f51a99c501dec7c0b14f9480d140e870788cb` | Settlement-token qualification and operating bounds |
| BenchmarkRegistry | `0x375769c3e70a3958c85a17f64e4c70e0ada4945a` | Benchmark identity, fixing policy, and evidence dependencies |
| FeeScheduleRegistry | `0x02de354ee8d5d7cc9a29ad32abd6365b22eb4365` | Versioned maker, taker, and authorized fee schedules |
| RiskDomainRegistry | `0xca5253257ad4d8b5873a11d4fae2ab8a12009445` | Isolated risk domains, limits, and dependency boundaries |
| InstrumentRegistry | `0xd24282203b467d42d94620c267b8c4128fd2d3a1` | Versioned payoff and instrument definitions |
| MarketRegistry | `0xb868c249eb66c279d087f2fcae79f57a2ef1379d` | Market definitions, qualification, and activation |
| SeriesRegistry | `0xdc9563eae3aa03e8dd93dbcf46f3e4e636b865fa` | Expiry-specific terms and pinned dependencies |
| CollateralVault | `0x16344d20a4197927efe4545bb3962006629ff5f6` | Accounts, custody, locks, reservations, funded fees, and settlement balances |

### Exchange core, policy, and lifecycle

| Contract | Address | Responsibility |
| --- | --- | --- |
| DevnetSequencerUptimeFeed | `0x4caba63b7225075bc5f0b42720605c18dbeda112` | Static testnet sequencer-health substitute, refused outside the allowed testnet path |
| PackageRegistry | `0x73d6c995d2150687d3d57056544ea49d8241adf5` | Canonical multi-leg package manifests and versions |
| CanonicalStrategyCompiler | `0x74f43c2d2024c9dd11f3a002a8e497e89703b335` | Deterministic compilation of typed strategies into protocol packages |
| PositionEngine | `0x4e80cc89555efde78436feaf24f8d6c33c11e5b5` | Canonical open positions and terminal liability state |
| FixingEngine | `0xccbe3a19fbeba1396dbf39a5ed13e614a70e8500` | Observation evidence, corrections, and final benchmark fixing |
| FundedFeeEngine | `0x1d3c3cd7f71de4d51461a252bad0f97c6d516ebe` | Signed fee caps and collateral-funded fee transfer during clearing |
| PortfolioRiskEngine | `0xc106c9ceb3a7a6d96279e9433bb59a45c807e1cd` | Pre-trade risk admission and maximum-loss reservation |
| ExecutionPolicyRegistry | `0x4125c0f26515e147468aa55c3abaa454f98b88b7` | Versioned time-in-force and execution behavior |
| TradingSessionPolicy | `0xf823da94052254c8b4a362e7838dd4790147c9a7` | Session-open checks and sequencer recovery grace |
| PackageWitnessRegistry | `0xf9818f1f91cbd320d2d0e8a901df7bc7745bf503` | Bounded canonical package witnesses used by admission gates |
| RiskAdmissionBindingRegistry | `0x96420a6ce5e12add08e2aac736d76787f159ccd2` | Binds signed consent to a specific funded risk admission |
| OrderValidationGate | `0x4786113fcc4df0efaeac6ed33cafbdfe3e975465` | Validates canonical orders against pinned market dependencies |
| OrderState | `0xa4504186cc265e3b3c19417edcac5dbe266f4c30` | Order registration, nonces, cancellation, fill, and terminal state |
| ClearingAdmissionGate | `0x8dec13b2fc7de2de331f3aea07ec7d3046e1a53f` | Revalidates both sides before value-moving clearing |
| AtomicClearingEngine | `0x12681127db37ff96fef81f2685d1c0a3406e16d9` | Atomic match, funded fees, collateral state, and position creation |
| PrivateRfqValidationGate | `0x2909136909ce69e7319a4d2fc1680f2495dffa7c` | RFQ-specific market, policy, and eligibility validation |
| PrivateRfqBook | `0x0a06bf70692ad5683d3f202d1657e47ff0454d7f` | Private requests, firm quotes, selection, handoff, and settlement state |
| PublicBookEligibilityGate | `0x8143d04551e22dfbb967a2e37befa56202d21843` | Eligibility checks before an order can rest publicly |
| PublicOrderBook | `0x2dda32044026e562849228653fd56ba7a05ea8f1` | Resting orders, deterministic priority, cancellation, and matching |
| PositionLifecycleExecutor | `0x31b6e7f329d9baae490fd3c5557173e2c3017f21` | Authorized position transformations and terminal state changes |
| AccountPolicyAuthority | `0xd164c61c502756cf8f18435179d5923d5b6b7fda` | Account-scoped lifecycle and organization policy authority |
| LifecyclePolicyValidator | `0x4b618da20ddb0fb7b0d6f2c6d935d90aad305365` | Validates lifecycle actions against position and package rules |
| SignedLifecycleEngine | `0x02db309b2a52ae618bb24702d8be719b9e6fbf3d` | EIP-712 lifecycle authorization and replay protection |
| CompressionCoordinator | `0xf64ea07cc6eb99298a156005f185147a6dc7cf62` | Netting and compression of compatible funded positions |
| OffsetUnwindCoordinator | `0x0676f5ea5da072344e065a0807d8fa91a990ed55` | Exact-mirror atomic unwind after a clearing fill |
| DefaultBidderGate | `0xc8ad36b4af0a3fd0a3ce634ced1b44fc24b7b1d6` | Eligibility and funding checks for default-resolution bidders |
| DefaultProcessEngine | `0xee89a72d9d541c89138b6e811989f3a84f44524a` | Default opening, auction resolution, loss allocation, and terminal state |
| CashSettlementCoordinator | `0x821f6464714495e05752b26a024f476a836d27bd` | Cash settlement from final fixing and pinned payoff rules |
| PrivacyCommitmentRegistry | `0xc69977a314acc13950c8c42d3cad26968952d108` | Versioned commitments and selective-disclosure policy anchors |
| OperationalAdapterExecutor | `0x779afe6fd93932fdb10b164bfaaaf13dabfb851a` | Bounded execution of qualified external operational adapters |

### Payoff modules

| Contract | Address | Responsibility |
| --- | --- | --- |
| CappedForwardPayoffModule | `0x233c0cbf948746dad72f90691136c8ab10da8e57` | Bounded forward payoff between an explicit floor and cap |
| NdfPayoffModule | `0x21231836733cde00604a614f584f38579a45d03f` | Cash-settled non-deliverable forward payoff |
| EuropeanCallPayoffModule | `0xf07544f44ac65cabc68f5b0734f74960eb7eba61` | European call payoff at the series fixing |
| EuropeanPutPayoffModule | `0x5a0b62d2ad194866ede2caa03d13d7cafd9280c1` | European put payoff at the series fixing |
| CollarPayoffModule | `0x77347c7934d2cc87b86b03ba37535485bc76707e` | Bounded call and put collar payoff |
| RateForwardPayoffModule | `0x5968d26d244bfca69f6595b4b142fefae896215a` | Fixed-expiry rate-forward payoff |
| RateCapPayoffModule | `0x0c99d3f277846475121700e6ec469d2f7997f7c2` | Bounded protection above a rate strike |
| RateFloorPayoffModule | `0xf60fc3f8eb5dc98d3f6c39ae0ebeda180dd16751` | Bounded protection below a rate strike |
| RateCollarPayoffModule | `0x593e8b1f616b39e4575a0ee147b6a068f1fab354` | Combined rate cap and floor payoff |
| BasisSpreadPayoffModule | `0xac28a92278383a3e53076d06669af171e3b16bd2` | Difference between two qualified benchmark legs |
| CalendarSpreadPayoffModule | `0xe742d8d7780f831f0662792cd47512668c1a8a83` | Spread between two qualified maturities |
| WindowAverageScalarPayoffModule | `0x2a791031b2d040985407acec4019435bf5006f79` | Scalar payoff from an average over a fixing window |
| CorrelationDispersionScalarPayoffModule | `0x50d304e0dfa5d7e6a2f01d522f6be2b298c4a5cf` | Bounded correlation or dispersion scalar payoff |

### Capacity, auctions, streaming, and routing

| Contract | Address | Responsibility |
| --- | --- | --- |
| CapacityReservationRegistry | `0x95fa1bd9ad5a9e4cf2d1f3a2caee9e3541adc375` | Firm-capacity reservations, expiry, consumption, and release |
| VaultBackedStreamCapacityManager | `0x58d4c32c7dd84923513a67e335f71a72eeb0a7e0` | Collateral-backed capacity for continuously refreshed quotes |
| VaultBackedBatchCapacityManager | `0x2fe5db2c5753ba6174fb32657573d70fe1ddbc16` | Collateral-backed capacity for auction and batch execution |
| AuctionValidationGate | `0x2511a21ef65ea0f2963b0d546add65ba5a843cdf` | Series, session, package, and eligibility checks for auctions |
| SealedAuctionHouse | `0xc94d19b9a6ff17795c45239497182fe55b80dee7` | Sealed bid lifecycle, ranking, capacity, and deterministic settlement |
| StreamingQuoteEngine | `0x1903e9eed3f2ae3617349ffb3b8799c9d0efb536` | Capacity-aware firm streaming quote state |
| QuoteSettlementRouter | `0xf2c404d67d6cd04e1dfa7f836ea3ab9401957286` | Caller-independent atomic settlement of maker and taker signatures |
| BatchClearingEngine | `0xc98f4e37e4913f169fa06cf63b0682a1afeca9ca` | Deterministic batch allocation and handoff to atomic clearing |
| ProtocolRouteLiquiditySource | `0x5cb5fa1db7c1587bec1fcac7ade274fe936e1d64` | Normalized liquidity source over native protocol channels |
| CollateralAwareRouteEngine | `0x0f66384a8bc3cf86a2ace148ba56dbf66457135c` | Route comparison with liquidity, collateral, risk, and reservation bounds |

### Evidence authorities and ledger

Each receipt authority is bound to one canonical source contract. It converts that source's state into a domain-specific subject that `VerifiableReceiptLedger` can record without trusting an arbitrary offchain narrator.

| Contract | Address | Responsibility |
| --- | --- | --- |
| OrderReceiptAuthority | `0x5a24a79e2b48f966ec55ca56d342792e5d4a8538` | Order registration, cancellation, and terminal-state evidence |
| RfqReceiptAuthority | `0x5da97fe42745a252ff0a850f3a9e9eab73a16c61` | Private RFQ lifecycle evidence |
| BookOrderReceiptAuthority | `0x358a5e37f0e0f4ee6dcb5db620fa72a6ef0cc711` | Public resting-order evidence |
| AuctionReceiptAuthority | `0xd371f3acb769b4aee8bfd19b35271f6d2a03fc28` | Auction lifecycle and clearing evidence |
| SolverReceiptAuthority | `0x472a3b57f8d559ca4358f9b2ac34c96c7e047867` | Solver or auction execution evidence |
| FillReceiptAuthority | `0x2550f128096bea48e73e359685c3e2e2dfdf2f08` | Atomic fill and matched-price evidence |
| FixingReceiptAuthority | `0x779c47abb39525091bd87d3f99591062c32b122f` | Observation and final-fixing evidence |
| SettlementReceiptAuthority | `0x7e110557cc204165ca0e51f016ef509e53cac133` | Cash-settlement outcome evidence |
| DefaultReceiptAuthority | `0x023a7227674d8cea41143029cf7525714497b964` | Default opening and resolution evidence |
| RecoveryReceiptAuthority | `0xf08cabc8ca19d68b8719ff5092fa1bde74ac33a1` | Operational recovery and bounded-failure evidence |
| LifecycleReceiptAuthority | `0x6a181ac02af1e181f36a93c91c16eb335fc27022` | Signed lifecycle action evidence |
| StreamReceiptAuthority | `0x12fa19b9994e18231b5127d48e044674ef1e29c1` | Firm stream quote and capacity evidence |
| RouteReceiptAuthority | `0xfd3d464dbf461a5c19bed0eff306c7062c8d049b` | Route choice, source, and exclusion evidence |
| PositionReceiptAuthority | `0x94b97a0c6bc5da153b7e20740518a9fba7991ac2` | Position creation and terminal-state evidence |
| FeeReceiptAuthority | `0x003ef230967fc87755dcbe1a1ad18090061efc7a` | Charged-fee and fee-schedule evidence |
| RiskReceiptAuthority | `0x2002609f7dd0c8425f5aa6d3e93101037476be53` | Risk admission and reservation evidence |
| PrivacyReceiptAuthority | `0xbe1dc7fca5389763008ccd40131db5dee95b5c47` | Commitment and selective-disclosure evidence |
| AsyncReceiptAuthority | `0xcb6f3f79d11aa23faaf8b90a5d58d83006c51a2e` | Asynchronous execution and recovery evidence |
| VerifiableReceiptLedger | `0xb548f0ab66470ddc442a3664e4dcc25170e06d69` | Canonical receipt registration and subject authority checks |
| RegistryStatusController | `0x0ac69f0a8521b4fd1742fa82061f5053c7d16878` | Delayed governance control over registry qualification state |

### Sepolia market bootstrap contracts

| Contract | Address | Responsibility |
| --- | --- | --- |
| SetrynTestUSDC | `0x9768816048290e2bee48729698ef3b60af4f4d4f` | Six-decimal permissionless test collateral with a per-wallet cap and an Arbitrum One deployment guard |
| SignedObservationFixingAdapter | `0x702c9844fe7a00031b217e3db6b3991d3d62e320` | Threshold-signed fixing observations for the Sepolia release candidate |
| FullyCollateralizedRiskAdapter | `0xe22f92e6a1ea64e2142a689e39c8023a6d8b9d0b` | Maximum-loss admission for the 15 fully collateralized dated-forward series |

## Contract source layout

| Directory | Contents |
| --- | --- |
| `src/registry/` | Versioned protocol registries |
| `src/collateral/` | Vault accounting and reservation logic |
| `src/orders/`, `src/book/`, `src/rfq/`, `src/auction/`, `src/stream/` | Execution-channel state machines |
| `src/execution/`, `src/batch/`, `src/quote/` | Atomic, batch, and firm-quote clearing |
| `src/risk/`, `src/capacity/`, `src/policy/` | Admission, capacity, sessions, validation, and governance controls |
| `src/position/`, `src/lifecycle/`, `src/default/` | Positions, unwind, compression, default, and recovery |
| `src/fixing/`, `src/settlement/`, `src/payoff/` | Fixing, deterministic payoff, and cash settlement |
| `src/compiler/`, `src/routing/`, `src/adapters/` | Strategy compilation, route selection, and qualified integrations |
| `src/privacy/`, `src/evidence/` | Commitments, receipt authorities, and evidence ledger |
| `src/types/`, `src/libraries/`, `src/interfaces/` | Canonical types, math, hashing, and external interfaces |
| `src/testnet/`, `src/devnet/` | Network-guarded collateral and local or testnet fixtures |
| `script/` | Core deployment, market bootstrap, and runtime serialization |
| `test/` | Unit, fuzz, invariant, integration, and pinned-fork tests |

There are 287 Solidity source units including contracts, interfaces, types, and libraries. The number of source units is not the deployed contract count.

## Build and test

Requirements:

- Foundry stable
- Solidity 0.8.37, installed automatically by Foundry

From the repository root:

```bash
pnpm contracts:build
pnpm contracts:test
pnpm contracts:test:invariant
pnpm contracts:fmt:check
```

Or from this directory:

```bash
forge fmt --check
forge build
forge test --no-match-path '**/test/invariant/**'
FOUNDRY_PROFILE=ci forge test
```

The production source must compile with the pinned deployment profile before a contract phase is considered complete.

## Deployment and evidence

The deployment is two-stage:

1. `DeploySetryn.s.sol` creates the 85-contract protocol graph, connects dependencies, assigns scoped roles, and starts delayed governance handoffs.
2. `BootstrapSetrynMarkets.s.sol` creates or binds the settlement token and adapters, registers calendars, sessions, benchmarks, fees, assets, instruments, markets, and 15 series, then writes the runtime and session-day artifacts.

Useful repository commands:

```bash
pnpm contracts:release:prepare
pnpm contracts:deploy:sepolia
pnpm contracts:deployment:evidence
pnpm contracts:deployment:validate
pnpm phase2:drift:check
```

Read [`docs/runbooks/network-deployment.md`](../docs/runbooks/network-deployment.md) before any public-network operation. Broadcast evidence under `contracts/broadcast/` is local operational evidence and is intentionally not part of this address registry.

## Network policy

- Local Anvil and Arbitrum Sepolia are the active development and release-candidate environments.
- Arbitrum One configuration and fork qualification are read-only until the user explicitly authorizes a mainnet deployment.
- Deployment scripts default to simulation and require an explicit broadcast path for writes.
- Never commit private keys, seed phrases, RPC credentials, wallet passwords, or explorer keys.
- Setryn Test USDC is test-only and refuses deployment on Arbitrum One.
- Revoking an authority may stop new risk, but it must not deadlock a funded historical position or its objective terminal settlement.
