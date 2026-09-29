# Arbitrum One Unsigned Deployment Gas Report - Bounded Prefix (Planning Only)

This is a production planning artifact. It is not a claim that deployment was executed.
No transactions were sent, signed, broadcast, funded, or unlocked. All Arbitrum One
interaction used read-only eth_call/code/read/estimate/fee methods only.

## Scope

- Bounded prefix of the DeploySetryn production graph: 19 CREATE operations plus
  25 exact ordered configuration CALL operations, total 44 operations.
- CREATE set: AssetRegistry, AdapterRegistry, CalendarRegistry,
  CanonicalStrategyCompiler, ExecutionPolicyRegistry, PrivacyCommitmentRegistry,
  plus 13 production payoff modules.
- CALL set: exact grantRole, revokeRole, and beginDefaultAdminTransfer wiring for
  the included registries, in DeploySetryn order.
- Source for constructor arguments and role wiring: contracts/script/DeploySetryn.s.sol.
  Source for bytecode: compiled Foundry artifacts in contracts/out.
- All initCode uses exact creation bytecode plus exact cast abi-encode arguments.
  No placeholder initCode. All CALL data uses exact cast calldata selectors.
  No fake selectors. All addresses are nonce-based CREATE derivations for the
  planning sender. No guessed addresses. No fixture operations.
- Dependent layers (SessionRegistry onward, engines, books, coordinators, and
  follow-on wiring) need sequential fork state and are documented as follow-on
  work. Many core contracts also exceed the 24576 runtime size limit and need
  a separate size strategy before any launch attempt.

## Planning identities (planning-only, not approved)

- Planning sender and bootstrapAdmin: 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef
  Nonzero unsigned-planning sender for eth_estimateGas only. Observed nonce 0x0
  at both planning proxy pinned block and latest. Not an approved deployer.
  Do not fund for launch without explicit approval.
- governanceAdmin: 0xa4b1000000000000000000000000000000000001 (planning-only)
- governanceOperator: 0xa4b1000000000000000000000000000000000002 (planning-only)
- guardian: 0xa4b1000000000000000000000000000000000003 (planning-only)
- excessRecovery: 0xa4b1000000000000000000000000000000000004 (planning-only)
- privacyKeyPublisher: 0xa4b1000000000000000000000000000000000005 (planning-only)
- lifecycleWitnessStager: 0xa4b1000000000000000000000000000000000006 (planning-only)
- All principals are distinct as required by DeploySetryn separation checks.
  A4B1 marker denotes Arbitrum One planning placeholders.

## Planning parameters

- defaultAdminDelay: 172800 (2 days)
- maxLockDuration: 2592000 (30 days)
- evaluationGasHardCap: 2000000 (explicit planning value, no production default)
- maximumRiskAdapterGas: 500000
- maximumRiskObservationAge: 300 (5 minutes)
- operationalReadGas: 500000
- operationalExecutionGas: 800000
- maximumOrderLifetime: 2592000 (30 days)
- maximumRfqCapacityTail: 86400 (1 day)
- sequencerRecoveryGrace: 3600 (1 hour)
- deploymentId: 0x51ec9357b6ddd3ea23347af64da865cb6d0dab2b02712825bc3073357ec9a1d6
  (keccak of SetrynArbitrumOneUnsignedPlanningV1, planning-only)
- Bounded prefix needs no external sequencer feed. Full graph uses the Chainlink
  Arbitrum sequencer uptime feed as an external dependency.

## Deterministic addresses (base nonce 0)

- 0 AssetRegistry: 0x02c03d1f9a079f3970c10ce3ded1164070fa2c60
- 1 AdapterRegistry: 0xd6333b6d2720d5a7d970b2dd4c3d183385472502
- 2 CalendarRegistry: 0x2e35e9ecf6b87814bca96ccd0927b0bee1da4a26
- 3 CanonicalStrategyCompiler: 0x21e547f49f2241b543eb9b551c5a9a1cf5226594
- 4 ExecutionPolicyRegistry: 0x60f425788712a8bfeb4c04fa098f30ed6f7104a2
- 5 PrivacyCommitmentRegistry: 0x862cbe247ad88cf2d07d1fbac3c3db79f0040a5c
- 6 CappedForwardPayoffModule: 0x14ccc30fea7aa479f8bef805e113823acae2ceb1
- 7 NdfPayoffModule: 0x56f00bdb3b6138ce265f435d672cdca8174d2628
- 8 EuropeanCallPayoffModule: 0x351e4dbfd5bc8cbe9ba764bb4cc908f6a3c30e24
- 9 EuropeanPutPayoffModule: 0xfbde9294d5714c9cdf4f83a13af21e658b07dc7f
- 10 CollarPayoffModule: 0x2f0e39e656ace3f9e5db379b1d5e37525181c3bd
- 11 RateForwardPayoffModule: 0xa5f3e200835d58ba3357e6a42ed571a210c9c2c4
- 12 RateCapPayoffModule: 0x66c97a5355e7950942b0c52b814718b028794640
- 13 RateFloorPayoffModule: 0xf2cee6914a24ea5e7f269805154e243d323c1c36
- 14 RateCollarPayoffModule: 0x8a2d22afc3eac9ba983ef56073c997c9af803002
- 15 BasisSpreadPayoffModule: 0xd11d12ecba6ec8561474635688407fd46415f323
- 16 CalendarSpreadPayoffModule: 0x74c402784602ca9876fa604eda65a7f4c3cc3ae3
- 17 WindowAverageScalarPayoffModule: 0x17ea27a32057ed205f429916b81f3c5c17a2e35d
- 18 CorrelationDispersionScalarPayoffModule: 0xe5528d493c566ac57a29f388361ca6680694c5f8
- Derivation: cast compute-address from the planning sender, nonces 0 through 18.
  Verified correct CREATE derivation. Every constructor argument and CALL target
  uses these values. Internally consistent.

## Bundle files

- Intent: deployments/arbitrum-one/qualification/arbitrum-one-unsigned-deployment-intent.json
- Bundle: deployments/arbitrum-one/qualification/arbitrum-one-unsigned-bundle.json
- This report: deployments/arbitrum-one/qualification/arbitrum-one-gas-report.md
- Builder: scripts/build-arbitrum-one-unsigned-intent.mjs
- Intent labels: unsigned true, planningOnly true, broadcast false, signed false,
  readOnly true, transactionsSent 0. No private keys, signatures, raw signed
  transactions, or transaction hashes.

## Live estimation basis

- RPC: https://arb1.arbitrum.io/rpc
- Chain ID observed: 42161 (0xa4b1), matches expected.
- Required pinned reference: block 509990000, hash
  0xd5edd6e1c8caac1a8bba0aadc5f3d52aecc6cf360dbeded39e898ce101433e72.
  Header is available and matches deployments/arbitrum-one/manifest.json.
- Planning proxy pinned block used for state: 509995000, hash
  0x1f4bd4558ecfdaa574cb7a961827a0c4ea3601e661738c4a16362691c1e51978.
- Latest block at generation: 509998003, hash
  0x1b18da71d41b28ee9a06e216a3da42a51ca2f1b5ca5427bd36baef270af53e5c.
- Each of the 44 operations used eth_estimateGas against its exact from, to,
  value, and data (CALL) or exact creation initCode (CREATE), at both planning
  proxy pinned block and latest. Chosen gas is the maximum of the two.
- Fee basis (live): eth_feeHistory plus eth_maxPriorityFeePerGas.
  baseFeePerGas 0x13134d0 (20002000 wei, 0.020002 gwei).
  maxPriorityFeePerGas 0x0 (0 wei).
  maxFeePerGas 0x26269a0 (40004000 wei, 0.040004 gwei).
  Formula: maxFee = 2 * baseFee + priorityFee.
- RPC methods used: eth_chainId, eth_getBlockByNumber, eth_getTransactionCount,
  eth_getCode, eth_estimateGas, eth_feeHistory, eth_maxPriorityFeePerGas.
  No signing or broadcast methods were called.

## Totals

- Total estimated gas (sum of chosen per-operation gas): 30980487 (0x1d8b987).
- Aggregate max fee (gas * maxFee, value 0): 1239343401948000 wei.
- Aggregate value transferred: 0 wei (all operations value 0x0, valueDeclared false).
- Aggregate requirement (fee plus value): 1239343401948000 wei (0.001239343401948 ETH).
- Reserve multiplier: 2.
- Reserve requirement: 2478686803896000 wei (0.002478686803896 ETH).
  Hex: 0x8ce5a3e74a6c0.
- Per-operation maxima are recorded in the bundle as maxCostWei (gas * maxFee + value).
- Largest CREATE items are PrivacyCommitmentRegistry (0x316a80, 3238528 gas) and
  CalendarRegistry (0x1f716f, 2060655 gas). Payoff modules are each about
  1477700 to 1477937 gas. Root registries range 1150678 to 2060655 gas.
  Compiler is 1236451 gas. CALL wiring items are 26576 to 28222 gas each.

## RPC observations

- eth_chainId returned 0xa4b1 as required.
- eth_getBlockByNumber for 509990000 returned the expected hash above. Header check passes.
- eth_getTransactionCount, eth_getCode, and eth_estimateGas at 509990000 currently
  fail on the public RPC with missing trie or historical state errors. Example:
  missing trie node 7547f3fe6f066820285a1ae4050513a9ce5ebb3043ad6e57007839228bc129d3
  is not available. Historical state is not available.
  The same calls succeed at 509995000 and latest, so planning estimates use the
  proxy block above. Pinned 509990000 header is still recorded for traceability.
- Planning sender nonce is 0x0 at both proxy pinned and latest. No drift.
- CALL targets are not-yet-deployed derived addresses with no code at both blocks.
  They are explicitly declared as expectedCreateTargets with lower-order CREATE
  operations, so the bundle accepts them. Each CALL estimates as a no-op
  (about 26k to 28k gas), which bounds wiring cost but does not execute wiring.
- No dependency code checks were needed because the bounded intent has empty
  dependencies. Full graph external dependencies still need fork qualification.
- Priority fee observed as 0 on Arbitrum One at generation time. If priority fees
  rise before launch, the 2x reserve may need recomputation. Recompute from live
  fees before funding.

## Network fees versus protocol capital

- The 2x reserve above covers network fees only: deployer ETH needed for gas at
  live fees plus safety margin. Value transferred in deployment operations is 0.
- It does not cover protocol capital: collateral inventory, USDC settlement funding,
  keeper and relay budgets, oracle subscription costs, insurance, audit, Safe
  setup, market caps, or ongoing service costs. Those need separate approval and
  funding. Do not treat the gas reserve as launch capital.
- No activation is performed. All admin transfers in this prefix are unsigned
  beginDefaultAdminTransfer planning calls only. No roles were granted on chain.

## Verification

- Focused unsigned-bundle tests: 28 pass, 0 fail
  (node --test scripts/test/generate-arbitrum-one-unsigned-bundle.test.mjs).
- Live generator command used read-only methods only and wrote the bundle above.
- Bundle fields confirm: broadcast false, signed false, readOnly true,
  signaturesRequested 0, transactionsSent 0, launchApproval false, chainId 42161.
- No secret material in intent, bundle, or this report. No v, r, s, signature,
  rawTransaction, privateKey, mnemonic, or broadcast payload.
- Zero transactions sent. This report does not claim deployment was executed.
