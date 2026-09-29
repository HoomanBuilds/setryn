# Setryn Mainnet Readiness, Cost, and Dependency Register

Date: 2026-09-21
Research mode: Read-only RPC, official documentation, and local simulation only
Mainnet funds spent: Zero

## 1. Decision

Do not spend mainnet funds during implementation. Build and validate against Arbitrum Sepolia plus a pinned Arbitrum One fork. Before launch, generate an unsigned mainnet transaction bundle and an exact budget from compiled bytecode, actual initializer calldata, live gas estimation, oracle terms, operator budgets, and approved market caps.

There is no responsible fixed mainnet budget before the contracts and activation set exist. Deployment gas can be estimated exactly only after compilation, and economic capital depends on open-interest limits. This register defines every cost category and the formula used to approve it.

## 2. Read-only network snapshot

The following checks were executed without a private key and without sending transactions.

| Check | Arbitrum One | Arbitrum Sepolia |
| --- | --- | --- |
| Chain ID | `42161` | `421614` |
| RPC checked | `https://arb1.arbitrum.io/rpc` | `https://sepolia-rollup.arbitrum.io/rpc` |
| Gas price snapshot | `0.02 gwei` | `0.093256 gwei` |
| Circle USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| USDC symbol and decimals | `USDC`, 6 | `USDC`, 6 |
| Pyth Core candidate receiver | Code present at legacy address | Code present at legacy address |
| Pyth Core reported update fee | `0` | `0` |
| Pyth Pro optional verifier | Code present | Code present |

The gas values and oracle fees are point-in-time observations, not budgets or guarantees. Mainnet ETH/USD from the Chainlink feed was `2723.7498` during the snapshot. At the observed 0.02 gwei execution price, one million raw gas units corresponds to `0.00002 ETH`, about `$0.0545`, before accounting for how Arbitrum represents parent-chain data cost in transaction estimation. Production budgeting must use the actual transaction returned by `eth_estimateGas`, not this illustration.

The Arbitrum gas information precompile at `0x000000000000000000000000000000000000006C` returned live pricing data. It will be recorded during every deployment rehearsal. Arbitrum charges for child-chain execution and parent-chain data, so transaction calldata and deployment bytecode size matter in addition to opcode execution.

## 3. Verified dependency register

### Required production dependencies

| Dependency | Arbitrum One | Arbitrum Sepolia | Intended use | Qualification status |
| --- | --- | --- | --- | --- |
| Native USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | Circle test USDC at `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | Collateral, fees, payout | Address and token behavior read-checked |
| Pyth Core candidate receiver | Legacy contract at `0xff1a0f4744e8582DF1aE09D5611b887B6a12925C` | Legacy contract at `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF` | Pull updates if currently supported | Bytecode, 60-second valid period, and zero update fee read-checked; absent from current official Core chain list, so blocked pending fresh-payload test and provider confirmation |
| Pyth Pro optional verifier | `0xACeA761c27A909d4D3895128EBe6370FDE2dF481` | Same address | Optional broad signed multi-asset fallback | Bytecode and one-wei verification fee read-checked; not required for development |
| Chainlink sequencer feed | `0xFdB631F5EE196F0ed6FAa767959853A9F217697D` | Resolve from official registry before deployment | Reject unsafe oracle-dependent actions during sequencer outage and grace period | Mainnet bytecode read-checked |
| Chainlink ETH/USD | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` | Resolve per test fixture | Independent pricing and gas-budget reference | Mainnet decimals and current round read-checked |
| Managed RPC | Provider selection pending | Provider selection pending | Application, indexer, keeper, relay | Require primary and independent fallback |
| Safe | Resolve from Safe deployment registry | Resolve from Safe deployment registry | Production ownership and approvals | Verify supported network services and singleton code hashes before use |

Pyth Core supports pull and push consumption models. Pull is the correct shape for this exchange because the fill or settlement transaction can carry a fresh signed update. The current Pyth Core onchain update fee is zero, but transaction gas remains. Push depends on someone continuously submitting updates. Pyth's current sponsored EVM push list does not include Arbitrum, so any cached update service on One or Sepolia would be operated and gas-funded by us.

The two legacy Arbitrum Core receiver contracts still answer read calls, but their stored ETH/USD observations were seven to nine days old during this review. That is expected when no pusher is active and demonstrates why settlement must submit a fresh pull payload rather than blindly read cached state. More importantly, the official current Pyth Core address page lists Arbitrum Blueberry but not Arbitrum One or Arbitrum Sepolia. Existing bytecode is not enough to claim current support. A fresh signed update must verify on Sepolia and Pyth must confirm production support before this adapter is qualified.

Hermes access has required an API key since the August 2026 Pyth Core upgrade. Pyth documents a free trial for testing, followed by paid ongoing plans. Therefore testnet development can be free apart from Sepolia gas, but a full production FX, metals, equity, rates, and commodity board must not assume free Pyth data. Pyth Pro is optional, not a protocol dependency.

### Current Pyth catalog coverage

Pyth's unauthenticated reference-data endpoint returned 3,730 current catalog entries on 2026-09-21. Catalog presence is not the same as stable status, access entitlement, sufficient publisher diversity, or production qualification. The stable entries directly covering the planned genesis board included:

| Family | Real supported references found |
| --- | --- |
| FX | EUR/USD, GBP/USD, USD/JPY, USD/INR |
| Crypto | BTC/USD, ETH/USD, ARB/USD, ETH/BTC, USDC/USD |
| Metals | XAU/USD, XAG/USD |
| Rates | SOFR, US 2-year, US 10-year, plus additional US curve points |
| Equity proxies | SPY/USD and QQQ/USD |
| Commodities | Brent index, WTI one-month index, natural gas, copper, and dated futures |
| Tokenized and redemption references | NAV and crypto redemption-rate feeds for selected assets |

Current exact catalog IDs and publisher counts are recorded in the build plan as a dated research snapshot. This does not prove Pyth Core delivery or plan entitlement. Runtime configuration must be created by the market-qualification workflow after refreshing the reference-data API and testing the selected delivery method. It must not import this document as permanent configuration.

Pyth Core must not be assumed to cover Arbitrum or the required market board merely because it exists on other EVM networks. The adapter decision is market-specific:

- Pyth Core pull where Arbitrum support, fresh-payload verification, coverage, and entitlement are confirmed;
- Pyth Pro only as an optional provider where its additional coverage is commercially justified;
- Chainlink as an independent qualified source where an official feed exists;
- a deterministic disruption outcome when a benchmark cannot be established safely;
- a conspicuously labeled, chain-guarded scenario oracle only on local and test networks.

### Optional hedge and liquidity dependencies

These venues are integrations, not trusted sources of truth for protocol solvency.

| Venue | Arbitrum One | Arbitrum Sepolia | Read-only result |
| --- | --- | --- | --- |
| GMX ExchangeRouter | `0x7dE39FF2e232A2203196788d37e234cF8F1b83f1` | `0x6B489dD5bB1AAE8df246359d59aA7316760a75d2` | Bytecode present on both checked deployments |
| GMX DataStore | `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8` | `0xCF4c2C4c53157BcC01A596e3788fFF69cBBCD201` | Bytecode present on mainnet; official testnet address recorded |
| GMX Reader | `0xfA26cBb46e2614609406de08CA1Dc7f70a684184` | `0x92659fEf40582ceCC3CBa4D096d28291C238D358` | Bytecode present on mainnet; official testnet address recorded |
| Camelot Router | `0x4ee15342d6Deb297c3A2aA7CFFd451f788675F53` | `0x171B925C51565F5D2a7d8C494ba3188D304EFD93` | Bytecode present on both checked deployments |
| Camelot Algebra Factory | Resolve and verify at release | `0xaA37Bea711D585478E1c04b04707cCb0f10D762a` | Official Sepolia address recorded |
| Camelot Quoter | Resolve and verify at release | `0xe49ef2F48539EA7498605CC1B3a242042cb5FC83` | Official Sepolia address recorded |
| Uniswap v4 PoolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | Resolve if used | Mainnet bytecode present |
| Aave Pool | `0x794a61358d6845594f94dc1db02a252b5b4814ad` | Resolve if used | Mainnet bytecode present |

GMX warns that testnet deployments can change more frequently. Each release must refresh official addresses, run `eth_getCode`, compute code hashes, and pin them in the manifest. No address in this research document is a permanent runtime source of truth.

### External dependency acceptance checks

Every adapter must pass:

1. official address provenance;
2. expected chain ID;
3. non-empty bytecode and expected code hash;
4. ABI and version match;
5. token decimal and transfer behavior checks;
6. stale, unavailable, malformed, and reverted response tests;
7. pause, upgrade, governance, and emergency behavior review;
8. forked integration test at a pinned block and a current block;
9. cap and kill-switch configuration;
10. an explicit failure outcome that preserves protocol solvency.

## 4. Mainnet operations that require funding

| Operation | Asset required | Cost type | Who funds it | When needed |
| --- | --- | --- | --- | --- |
| Deploy implementations, libraries, registries, vaults, and engines | ETH | Consumed gas | Protocol deployer | Launch |
| Run initializers and register dependencies | ETH | Consumed gas | Protocol deployer | Launch |
| Create or activate production Safe if needed | ETH | Consumed gas | Governance setup wallet | Before ownership transfer |
| Transfer ownership and assign roles | ETH | Consumed gas | Deployer and governance operators | Launch |
| Configure assets, benchmarks, sessions, risk domains, and genesis markets | ETH | Consumed gas | Governance Safe | Launch and later governance |
| Submit Pyth Core pull payloads | ETH | Gas; Core currently reports zero onchain update fee | Transaction caller, keeper, or sponsor | Each oracle-bearing action |
| Obtain production oracle data | Fiat or agreed commercial payment | Recurring data service if the chosen provider requires it | Protocol company | Before qualified production feeds |
| Operate keepers and relayers | ETH plus infrastructure | Recurring gas and service | Protocol keeper budget, with user-funded rewards where designed | Continuous |
| Sponsor user transactions | ETH | Recurring gas | Paymaster or sponsor treasury | Optional launch UX |
| Seed insurance or default resources | USDC | Locked risk capital, not a fee | Protocol treasury or backers | Before markets requiring it activate |
| Fund canary user and maker positions | USDC | Locked trading capital and possible PnL | Controlled launch accounts | Production smoke test |
| Maker collateral | USDC | Locked trading capital, not protocol spend | Each maker | Before quoting |
| Solver or maker hedge execution | USDC, ETH, or venue assets | Capital, venue fees, slippage, and gas | Maker or solver | Per hedge |
| Venue token approvals | ETH | Consumed gas | Adapter account, maker, or solver | Before first venue use |
| Bridge ETH or USDC to Arbitrum One | ETH and bridged asset | L1 and L2 gas plus opportunity cost | Relevant treasury | Only if funds are not already on One |
| Publish configuration changes | ETH | Consumed gas | Governance Safe | Ongoing |
| Emergency pause, recovery, and resume | ETH | Consumed gas | Guardian or governance operator | Incident only |
| Contract verification | Usually no protocol gas | Service operation | Deployment pipeline | After deployment |
| Audit, legal review, RPC, indexer, monitoring, hosting | Fiat or service credits | Offchain service | Protocol company | Before launch and recurring |

### Funds that are spent versus funds that are locked

- Deployment, configuration, keeper, oracle verification, venue interaction, and sponsored-user gas are consumed.
- Insurance, maker collateral, canary collateral, and operational USDC are capital at risk or locked, not automatically consumed.
- Maker collateral should be provided by makers. It should not be hidden inside a protocol deployment budget.
- Hedging venue liquidity should be maker or solver capital unless the protocol deliberately adopts a treasury market-making mandate.
- Contract verification does not require an onchain transaction when supported by the explorer.

## 5. Budget formulas

### Deployment ETH

For every transaction in the unsigned production bundle:

```text
estimated transaction ETH = eth_estimateGas(transaction) * eth_gasPrice
deployment ETH approval = sum(estimated transaction ETH) * 2
```

The RPC estimate on Arbitrum accounts for the transaction under current execution and parent-data conditions. The two-times reserve covers price movement, retries, role operations, and verification smoke calls. Any unused ETH remains in the controlled operations wallet and is transferred to the Safe after launch.

### Recurring operator ETH

```text
monthly keeper ETH = expected calls per month * measured p95 ETH per call * 1.5
monthly sponsor ETH = sponsored calls per month * measured p95 ETH per call * 1.5
monthly oracle ETH = verified payload calls per month * measured p95 total ETH per call * 1.5
```

Use Sepolia measurements for call counts and relative gas, then re-estimate the exact calldata on an Arbitrum One fork and through live read-only RPC immediately before funding.

### Risk capital

```text
maker collateral = sum of maker maximum-loss reservations
canary collateral = maximum loss of controlled launch positions
insurance seed = approved loss absorption target for activated risk domains
total USDC launch capital = protocol insurance seed + controlled canary collateral + protocol-owned operational balances
```

Customer and maker collateral is not counted as protocol revenue or treasury funding. Mainnet caps cannot exceed actually funded maximum-loss coverage.

## 6. Testnet funding and fixture policy

### Gas

Use faucet Arbitrum Sepolia ETH for deployer, maker, keeper, oracle relay, guardian, and user test accounts. Maintain separate accounts and balances so operator failures can be demonstrated honestly. If a faucet is unreliable, bridge only valueless Sepolia ETH through the official Arbitrum testnet path.

### USDC

Use Circle test USDC as the default public collateral. Circle's public faucet explicitly supports Arbitrum Sepolia and currently distributes 20 test USDC per address and network every two hours. For larger maker and load-test balances, request test support or use a separate clearly labeled local-only collateral fixture. Do not deploy a competing public mock USDC while Circle test USDC is available.

### Oracle access

Use Pyth's free trial to test authenticated Hermes delivery for the Pyth Core pull adapter. The oracle relay requests signed payloads and attempts verification against the existing Arbitrum Sepolia Core receiver. Do not call that receiver officially supported until a current payload succeeds and Pyth confirms the deployment. Trial access is for implementation and demonstration. Mainnet provider selection and entitlement are separate launch decisions.

### Reference assets

Do not create fake EUR, gold, oil, equity, or rate tokens merely because the contract references those underlyings. Cash-settled contracts need a qualified benchmark and USDC collateral, not a transferable token for the reference asset.

Create test tokens only when a delivery, collateral, venue, depeg, or malicious-token test genuinely requires one. Those tokens use explicit `Test` names and symbols, publish source code, expose faucet provenance, and are barred from the Arbitrum One manifest.

### Test markets

Each public test market has:

- a versioned market specification;
- an asset family and benchmark policy;
- expiry, observation, session, holiday, and disruption rules;
- payoff and exact maximum loss;
- permitted order and privacy modes;
- maker, user, market, and risk-domain caps;
- a real or controlled oracle label;
- settlement and fallback procedure;
- a reproducible seed and scenario script.

Accelerated five-minute and hourly expiries are permitted for judge demonstrations, but standard weekly, monthly, and quarterly series must also be configured and visible.

## 7. No-spend controls

The development toolchain will enforce:

- no Arbitrum One private RPC write endpoint in default configuration;
- no production private key environment variable in local or CI templates;
- `--fork-url` for mainnet simulations and a separate explicit broadcast profile;
- chain-ID assertions in deployment scripts;
- a required production confirmation flag that CI never sets;
- preflight rejection if a mock contract, faucet role, test owner, test feed, or unverified dependency appears in the One manifest;
- unsigned transaction generation as the default production output;
- Safe review for all post-deployment production operations;
- balance and allowance diffs before and after every rehearsed bundle.

## 8. Items that must be resolved before mainnet funding

1. Compiled bytecode size and exact deployment topology.
2. Final upgrade, immutability, timelock, Safe, and guardian model.
3. Production oracle providers, current Arbitrum support, feed entitlements, licensing, history, redundancy, and price.
4. Chainlink coverage and fallback policy for every activated benchmark.
5. Initial market families, series, payoff caps, and open-interest caps.
6. Maker identities, collateral commitments, quote obligations, and hedge venues.
7. Keeper call rates, rewards, independent operators, and failure budget.
8. Paymaster design and monthly sponsorship ceiling.
9. Insurance target and source of USDC capital.
10. Audit scope, timeline, and remediation reserve.
11. Legal access policy for FX, commodity, rate, index, crypto, and tokenized-asset derivatives.
12. Production RPC, indexer, alerting, incident, and data-retention services.

None of these blocks local or Sepolia implementation. They block only the related mainnet activation.

## 9. Current readiness verdict

Arbitrum supports the product technically:

- native USDC exists on One and a Circle test USDC exists on Sepolia;
- Pyth Core pull can be tested without an onchain update fee, subject to confirming current Arbitrum receiver support;
- the oracle adapter keeps Pyth Pro optional rather than making it a protocol dependency;
- Chainlink provides Arbitrum feeds and a sequencer uptime feed;
- GMX and Camelot expose public Sepolia deployments for realistic integration work;
- real Arbitrum One dependency behavior can be exercised on a fork without spending funds;
- costs can be estimated from exact calldata before any transaction is approved.

The remaining mainnet risks are oracle commercial qualification, maker liquidity, audit and legal readiness, final caps, and operational funding. The correct action is to build the complete production-shaped release on local, fork, and Sepolia environments now, while keeping Arbitrum One strictly read-only until the launch gate is satisfied.

## Sources

- [Arbitrum RPC endpoints and chain information](https://docs.arbitrum.io/arbitrum-essentials/reference/node-providers)
- [Arbitrum transaction cost estimator](https://gas.arbitrum.io/)
- [Arbitrum gas overview](https://blog.arbitrum.io/understanding-gas-fees-on-the-blockchain/)
- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Pyth Core pull and push overview](https://docs.pyth.network/price-feeds/core)
- [Pyth Core EVM contract addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/evm)
- [Pyth Core current fees](https://docs.pyth.network/price-feeds/core/current-fees)
- [Pyth Core EVM sponsored push feeds](https://docs.pyth.network/price-feeds/core/push-feeds/evm)
- [Pyth Core upgrade and API-key requirement](https://docs.pyth.network/price-feeds/core/upgrade/preparing)
- [Pyth Core pricing announcement](https://www.pyth.network/blog/the-pyth-core-upgrade)
- [Pyth reference-data and symbol API](https://docs.pyth.network/price-feeds/pro/api/history)
- [Circle testnet faucet](https://faucet.circle.com/)
- [Chainlink Arbitrum XAU/USD feed](https://data.chain.link/feeds/arbitrum/mainnet/xau-usd)
- [Chainlink Arbitrum ARB/USD feed](https://data.chain.link/feeds/arbitrum/mainnet/arb-usd)
- [Chainlink L2 sequencer uptime feeds](https://docs.chain.link/data-feeds/l2-sequencer-feeds)
- [Camelot Arbitrum Sepolia contracts](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/)
- [GMX contract addresses](https://docs.gmx.io/docs/api/contracts/addresses/)
- [GMX frontend integration](https://docs.gmx.io/docs/api/frontend-integration/)
- [Safe supported networks](https://docs.safe.global/advanced/smart-account-supported-networks)
