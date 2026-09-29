# Arbitrum One Unsigned Deployment Gas Report (Planning Only)

This is a production planning artifact, not a claim that deployment was executed. No transaction was sent,
signed, broadcast, funded, or unlocked on Arbitrum One. Mainnet access was read-only. Dependent operations were
estimated with `eth_estimateGas` in canonical order on loopback Anvil forks of the pinned and latest blocks,
which are the only processes that received writes. Local forks meter only L2 execution, so each operation's Arbitrum
L1 data-posting gas was read with a read-only `eth_call` to NodeInterface `gasEstimateL1Component` at both
blocks and added to that block's estimate.

## Scope

- Complete DeploySetryn production graph from `contracts/script/PlanArbitrumOneDeployment.s.sol`.
- 62 contract creations, 29 linked-library creations, and 180 configuration calls (271 operations).
- Pinned block 509990000 (`0xd5edd6e1c8caac1a8bba0aadc5f3d52aecc6cf360dbeded39e898ce101433e72`); latest block 510084049 (`0xe2c3f241b1defdbf9d17b6902b4f9567d82cdfbcf2c57f71ccb10ba32a7da612`).
- Estimation mode: `sequential-local-fork-plus-l1-component`. Each operation uses the larger of its pinned and latest estimates.
- Planning sender `0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef` is keyless and not an approved deployer. Principals are A4B1 planning placeholders.

## Budget

| Item | Value |
| --- | --- |
| Total gas limit | 334292150 |
| L1 data-posting gas at the pinned block | 8768341 |
| L1 data-posting gas at the latest block | 77941223 |
| Base fee | 0.0200 gwei |
| Max priority fee | 0.0000 gwei |
| Max fee per gas (2 x base + priority) | 0.0400 gwei |
| Aggregate maximum network cost | 0.01337168 ETH |
| Deployer requirement with 2x reserve | 0.02674337 ETH |

Protocol capital (collateral, keeper, oracle, sponsorship, and insurance budgets) is outside this estimate and needs
separate launch approval.

## External dependencies (code-hash stable between pinned and latest)

- Aave V3 Pool: `0x794a61358d6845594f94dc1db02a252b5b4814ad` `0xf168c2e9e4d04292c7d5d526a9a917175a44369ab63a2f9997537acf0ffaaf2e`
- Aave V3 PoolAddressesProvider: `0xa97684ead0e402dc232d5a977953df7ecbab3cdb` `0x1a95f317ee56e0b9aedc4f4b7abd9e546dc45c26d1d77e95bcf62b789d9a5486`
- Chainlink Arbitrum sequencer uptime feed: `0xfdb631f5ee196f0ed6faa767959853a9f217697d` `0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2`
- Chainlink ETH/USD feed: `0x639fe6ab55c921f74e7fac1ee960c0b6293ba612` `0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2`
- Circle native USDC: `0xaf88d065e77c8cc2239327c5edb3a432268e5831` `0xad30d819dbc47814b7e6cb837fd7cc57fcb591479a38596ee93de4fc52e8c435`
- Create2Deployer: `0x4e59b44847b379578588920ca78fbf26c0b4956c` `0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989`
- GMX V2 DataStore: `0xfd70de6b91282d8017aa4e741e9ae325cab992d8` `0x3e7aea6e62b75671681b0d3006b146c7f02681a65fd5cc663909104de9d5088e`
- GMX V2 ExchangeRouter: `0x7de39ff2e232a2203196788d37e234cf8f1b83f1` `0x8d85c91f9f96ee11a2395f2a218554fa0c675ad0ecd7d0fdcbfe61f62991fe04`
- GMX V2 OrderHandler: `0xa5d2d45228ee2e3a18ab122b2ce84997d008f4eb` `0xc35bbb9387b097e5b397a4901fa60cdbf4255d5c2bf71f942f938d9ddd989452`
- GMX V2 OrderVault: `0x31ef83a530fde1b38ee9a18093a333d8bbbc40d5` `0x34d8332a92711cb1ce9a31be362ca68f9b4d34963e5c7c10d6134c86d832edb3`
- GMX V2 Reader: `0xfa26cbb46e2614609406de08ca1dc7f70a684184` `0x49ed1cb374dfbcea8c73fb50821b5e0bb3fbbe83f4324d954ef07c38758ac04a`
- GMX V2 Router: `0x7452c558d45f8afc8c83dae62c3f8a5be19c71f6` `0xc25e44eb982bdc5ffbd44db5438231ea7bc038b2fcc675520974453bf2a00d5f`
- GMX V2 WNT: `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` `0x2d240bb4510ed1acfeaba905eb4bcc4524d63c8ae66e48fcccac55ea714db7a7`
- Uniswap V3 SwapRouter02: `0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45` `0x209f9820ed7257d51c2f96ee837e8ec057b44774899f4be16fc45bd30cbb16f6`

## Operations

Linked libraries (`LIBRARY`) are CALLs to the deterministic CREATE2 deployer; the address is the derived library
address. Pinned and latest gas include the L1 component shown in the L1 column.

| Order | Operation | Kind | Address | Pinned gas | Latest gas | L1 gas (pinned / latest) | Gas limit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | AtomicClearingFundingLib | LIBRARY | `0x35980c104ea3153cf16e91868640e206bf5716d1` | 4036493 | 5015264 | 123821 / 1102592 | 5015264 |
| 1 | SeriesValidationLib | LIBRARY | `0xa18ce6fd8311cb4f5b53a31050e213c097bfe26d` | 3220832 | 3974580 | 95354 / 849102 | 3974580 |
| 2 | SeriesLifecycleLib | LIBRARY | `0x04c25cffed6dfe1417d67a010716ff565add7c70` | 3756819 | 4740125 | 124409 / 1107715 | 4740125 |
| 3 | AtomicClearingMatchLib | LIBRARY | `0x2dcbe5e16bd257079ce9593961c0fd89dc8b8159` | 4425822 | 5476746 | 132979 / 1183903 | 5476746 |
| 4 | SealedAuctionClearingLib | LIBRARY | `0x27da25dfa47988b1847c9a5bb78928ec84116e1c` | 3375174 | 4260389 | 112011 / 997226 | 4260389 |
| 5 | SealedAuctionBidLib | LIBRARY | `0xa307d74bf8a347acfb8b59d82fd8dbb07e86cdb9` | 3976225 | 4982654 | 127492 / 1133921 | 4982654 |
| 6 | SealedAuctionSettlementLib | LIBRARY | `0x5506ab55371c0c369c9b964f8fc015ac63ca98bd` | 2777978 | 3521092 | 94009 / 837123 | 3521092 |
| 7 | RouteSourceValidationLib | LIBRARY | `0x5223772d4544171a1568ada4ab2d1fa77aeb2e90` | 4666399 | 5653535 | 124879 / 1112015 | 5653535 |
| 8 | RouteSourceReservationLib | LIBRARY | `0x90e36a21eab1112ab1d3948fb1b36beaef45c176` | 1736846 | 2153726 | 52857 / 469737 | 2153726 |
| 9 | PrivateRfqLifecycleLib | LIBRARY | `0x15f70c086c109721b1caa2fab20dcbd7255c9e77` | 2358619 | 2984382 | 79377 / 705140 | 2984382 |
| 10 | PrivateRfqHandoffLib | LIBRARY | `0xbb43179a5cb0f2449498f297eb0477d3cf9da695` | 3990731 | 4998792 | 127871 / 1135932 | 4998792 |
| 11 | PositionViewLib | LIBRARY | `0xf0bfcc5a244573968ba58a49768ac1be6825725c` | 1391000 | 1768056 | 47840 / 424896 | 1768056 |
| 12 | PositionTerminalLib | LIBRARY | `0x4e789a19dbe129b8b24b419cf65072074e1793c5` | 1839148 | 2340822 | 63465 / 565139 | 2340822 |
| 13 | PositionCreationLib | LIBRARY | `0xa3dbd2e52a3630a9ad594d0b690085e534fcf987` | 2764858 | 3451795 | 86902 / 773839 | 3451795 |
| 14 | PortfolioRiskExposureLib | LIBRARY | `0x1c0d21b5cb478c6252879a0b2a42b2aebcdd5ceb` | 4397591 | 5494977 | 138936 / 1236322 | 5494977 |
| 15 | PortfolioRiskAdmissionLib | LIBRARY | `0x5fc7212f9cd0333f22433b85a2e8ab2dcade734e` | 4538187 | 5535664 | 126329 / 1123806 | 5535664 |
| 16 | OperationalExternalActionLib | LIBRARY | `0x085484dc66fc7d4fb329cd67fee52b558019f844` | 2846240 | 3497022 | 82421 / 733203 | 3497022 |
| 17 | LifecycleSuccessorLib | LIBRARY | `0x93682d8747cdeea75b88b266e8bfac73535e82a7` | 2454983 | 3039732 | 74216 / 658965 | 3039732 |
| 18 | LifecycleBackingLib | LIBRARY | `0x112705440c443ef44404cf6de13d68e7a1ad1669` | 2340172 | 2927662 | 74321 / 661811 | 2927662 |
| 19 | LifecycleActionLib | LIBRARY | `0xbebb62986ccca27375b3b401d41f40867c1412d6` | 4194218 | 5181661 | 124918 / 1112361 | 5181661 |
| 20 | DefaultResolutionLib | LIBRARY | `0x148fbb00534b4fb64f154748239cda3558e604e1` | 3528335 | 4446696 | 116270 / 1034631 | 4446696 |
| 21 | DefaultOpeningLib | LIBRARY | `0xf2b839e75d4639288695f09edf3d79443d9977b4` | 2190219 | 2753712 | 71382 / 634875 | 2753712 |
| 22 | DefaultAuctionLib | LIBRARY | `0x1a4a6f7af527e2b8e978abffede9f984e7df1f91` | 1679173 | 2150054 | 59650 / 530531 | 2150054 |
| 23 | CollateralReservationLib | LIBRARY | `0x8983fb7701de78b5ba36feb694e17f64ad46368f` | 2828636 | 3580803 | 96034 / 848201 | 3580803 |
| 24 | CashSettlementRecordLib | LIBRARY | `0xf6442343e32e02ed043b1e4c0a6b042365c35f29` | 3122077 | 3887494 | 96830 / 862247 | 3887494 |
| 25 | CashSettlementContextLib | LIBRARY | `0xd86cc8d797d2c21ce03a827ae037dce4e52216f2` | 4219220 | 5198816 | 123925 / 1103521 | 5198816 |
| 26 | AtomicClearingSeriesLib | LIBRARY | `0xb37288bb284e37f8b230051738a015bbb460655a` | 3176038 | 3929845 | 95576 / 849383 | 3929845 |
| 27 | AtomicClearingPackageLib | LIBRARY | `0x3332c459a5e413efd247f3ed3ef2302ddc946ca5` | 3937658 | 4874403 | 119079 / 1055824 | 4874403 |
| 28 | PrivateRfqQuoteLib | LIBRARY | `0xd19e34333cc88293d0527f6679e2fae0252b60b2` | 4207604 | 5321831 | 141640 / 1255867 | 5321831 |
| 29 | AssetRegistry | CREATE | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 1428918 | 1811167 | 48755 / 431004 | 1811167 |
| 30 | AdapterRegistry | CREATE | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 1801049 | 2291662 | 62576 / 553189 | 2291662 |
| 31 | CalendarRegistry | CREATE | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 1966106 | 2495246 | 66939 / 596079 | 2495246 |
| 32 | SessionRegistry | CREATE | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 2517153 | 3181058 | 84641 / 748546 | 3181058 |
| 33 | SettlementAssetRegistry | CREATE | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 1979969 | 2513551 | 68194 / 601776 | 2513551 |
| 34 | BenchmarkRegistry | CREATE | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 3190384 | 4007415 | 104420 / 921451 | 4007415 |
| 35 | FeeScheduleRegistry | CREATE | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 2066448 | 2609544 | 69526 / 612622 | 2609544 |
| 36 | RiskDomainRegistry | CREATE | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 2595696 | 3266420 | 84851 / 755575 | 3266420 |
| 37 | InstrumentRegistry | CREATE | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 2345914 | 2981217 | 80370 / 715673 | 2981217 |
| 38 | CollateralVault | CREATE | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 4672872 | 5874028 | 152040 / 1353196 | 5874028 |
| 39 | MarketRegistry | CREATE | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 4214545 | 5222356 | 127897 / 1135708 | 5222356 |
| 40 | SeriesRegistry | CREATE | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 3512780 | 4463661 | 120672 / 1071553 | 4463661 |
| 41 | PackageRegistry | CREATE | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 5170240 | 6409595 | 157370 / 1396725 | 6409595 |
| 42 | CanonicalStrategyCompiler | CREATE | `0x0d8497d289933452eb9c746ccde5b8e88a474b1d` | 1178979 | 1498382 | 40406 / 359809 | 1498382 |
| 43 | PositionEngine | CREATE | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 4123539 | 5153120 | 130249 / 1159830 | 5153120 |
| 44 | FixingEngine | CREATE | `0x1e8e8316a5a4e2b54ccddf73fc751175f492bf59` | 4894135 | 6205014 | 165966 / 1476845 | 6205014 |
| 45 | FundedFeeEngine | CREATE | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 5407681 | 6822967 | 179265 / 1594551 | 6822967 |
| 46 | PortfolioRiskEngine | CREATE | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 2871110 | 3634035 | 96634 / 859559 | 3634035 |
| 47 | ExecutionPolicyRegistry | CREATE | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 1096726 | 1395300 | 37937 / 336511 | 1395300 |
| 48 | TradingSessionPolicy | CREATE | `0xda830e11cdd0af588451b4169f327c60853e6037` | 731790 | 970131 | 30151 / 268492 | 970131 |
| 49 | PackageWitnessRegistry | CREATE | `0xa59979a74abfe5d403f1eb026e5259771f8dfc09` | 484423 | 641076 | 19817 / 176470 | 641076 |
| 50 | RiskAdmissionBindingRegistry | CREATE | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 1177124 | 1516606 | 42980 / 382462 | 1516606 |
| 51 | OrderValidationGate | CREATE | `0x273a3818833024c7baec38914d3b534e4a1a0242` | 1986391 | 2498556 | 64901 / 577066 | 2498556 |
| 52 | OrderState | CREATE | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 3101785 | 3937487 | 106067 / 941769 | 3937487 |
| 53 | RiskAdmissionBindingRegistry.bindOrderVerifyingContract | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 49989 | 68367 | 2325 / 20703 | 68367 |
| 54 | ClearingAdmissionGate | CREATE | `0x2395d2f71287f2e2d183d970d1cf62da4db62d44` | 2699072 | 3369816 | 84968 / 755712 | 3369816 |
| 55 | AtomicClearingEngine | CREATE | `0x89215bce82daa3028a18140160cdda91a2037da5` | 3670494 | 4637597 | 122593 / 1089696 | 4637597 |
| 56 | PrivateRfqValidationGate | CREATE | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 2719157 | 3388932 | 84903 / 754678 | 3388932 |
| 57 | PrivateRfqBook | CREATE | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 5072343 | 6299671 | 155632 / 1382960 | 6299671 |
| 58 | AtomicClearingEngine.activateClearingChannel | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 79123 | 104212 | 3173 / 28262 | 104212 |
| 59 | PublicBookEligibilityGate | CREATE | `0x41341a667339f0733e7728a57555adc9d2f68c78` | 1943359 | 2457322 | 65019 / 578982 | 2457322 |
| 60 | PublicOrderBook | CREATE | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 5591547 | 7020813 | 181015 / 1610281 | 7020813 |
| 61 | PositionLifecycleExecutor | CREATE | `0x3ef7412d131ad28f89e202166b354b803892678d` | 2524740 | 3138283 | 77757 / 691300 | 3138283 |
| 62 | AccountPolicyAuthority | CREATE | `0xe757f9c22ceb8c21e3aeb70080282ac56b7b0877` | 698342 | 906771 | 26415 / 234844 | 906771 |
| 63 | LifecyclePolicyValidator | CREATE | `0xac2fc7a45967aadf2f2537debc0cee6e7c4656bf` | 2096386 | 2601398 | 64052 / 569064 | 2601398 |
| 64 | SignedLifecycleEngine | CREATE | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 5558476 | 7039234 | 187326 / 1668084 | 7039234 |
| 65 | CompressionCoordinator | CREATE | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 3897136 | 4931049 | 130797 / 1164710 | 4931049 |
| 66 | DefaultBidderGate | CREATE | `0x0c225ab391cc170881fed35076d86be61a439820` | 648428 | 847448 | 25200 / 224220 | 847448 |
| 67 | DefaultProcessEngine | CREATE | `0x5ef3c1d61abc99e6f7f4eb06ad955d05e8aa1465` | 2711346 | 3417561 | 89502 / 795717 | 3417561 |
| 68 | CashSettlementCoordinator | CREATE | `0x0380d5d27dbb67d41ed9fd5d648d72755cf2d002` | 3623013 | 4493331 | 110299 / 980617 | 4493331 |
| 69 | PrivacyCommitmentRegistry | CREATE | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 3090520 | 3920501 | 105270 / 935251 | 3920501 |
| 70 | OperationalAdapterExecutor | CREATE | `0x93dbc0846c10f0a3aa1b66a74acfbe96bb9f09bc` | 3575270 | 4306716 | 92532 / 823978 | 4306716 |
| 71 | CappedForwardPayoffModule | CREATE | `0x53803b5aff10137dc3109de12ef033238aaeb965` | 1410004 | 1787239 | 47722 / 424957 | 1787239 |
| 72 | NdfPayoffModule | CREATE | `0x503080ea2f8347c65cab0d9b100352cf34a0854f` | 1410016 | 1786784 | 47722 / 424490 | 1786784 |
| 73 | EuropeanCallPayoffModule | CREATE | `0x1fe69dd0db31e9bae6547f88fc507b1fec962ee1` | 1410003 | 1785739 | 47709 / 423445 | 1785739 |
| 74 | EuropeanPutPayoffModule | CREATE | `0x30badd25ad761c0a2ed0caf24c63ecad0b7a479d` | 1409964 | 1785387 | 47670 / 423093 | 1785387 |
| 75 | CollarPayoffModule | CREATE | `0xa38d850ab5735d0abb4fa1da97c26d0507e004db` | 1410055 | 1784557 | 47761 / 422263 | 1784557 |
| 76 | RateForwardPayoffModule | CREATE | `0x9b4f77d6e01d09a07c3c9d25e88a6157f397670b` | 1409990 | 1783985 | 47696 / 421691 | 1783985 |
| 77 | RateCapPayoffModule | CREATE | `0x9ed9addd96ed146493b2d00f23b727f922495b0b` | 1410016 | 1784214 | 47722 / 421920 | 1784214 |
| 78 | RateFloorPayoffModule | CREATE | `0xc5d5b0fdb7a514f50991c8edff0cdd39dbea8176` | 1410042 | 1787482 | 47748 / 425188 | 1787482 |
| 79 | RateCollarPayoffModule | CREATE | `0x15ffb6a26455f7068ae1e57fe85bcbccaaee66dd` | 1410016 | 1787251 | 47722 / 424957 | 1787251 |
| 80 | BasisSpreadPayoffModule | CREATE | `0x20876314cd378768f5eec6b9cbc452b9261bd994` | 1409978 | 1786906 | 47684 / 424612 | 1786906 |
| 81 | CalendarSpreadPayoffModule | CREATE | `0x7a250ad0f48c99104946824f8401d88ceb90cbdc` | 1410069 | 1787464 | 47775 / 425170 | 1787464 |
| 82 | WindowAverageScalarPayoffModule | CREATE | `0x281ece96739630819f865239cbdcafa39520770f` | 1409966 | 1786742 | 47696 / 424472 | 1786742 |
| 83 | CorrelationDispersionScalarPayoffModule | CREATE | `0x6ce3e0b83f1b15b15a7894516ed2926594d25620` | 1410029 | 1787367 | 47735 / 425073 | 1787367 |
| 84 | CapacityReservationRegistry | CREATE | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 979632 | 1259806 | 35455 / 315629 | 1259806 |
| 85 | VaultBackedStreamCapacityManager | CREATE | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 2916948 | 3700172 | 99116 / 882340 | 3700172 |
| 86 | VaultBackedBatchCapacityManager | CREATE | `0x64629bf15987542239b334ec6aecf36eda278c50` | 2472196 | 3153407 | 86274 / 767485 | 3153407 |
| 87 | AuctionValidationGate | CREATE | `0x6ecd78ca2c7c931f9508fe06551c17fcb725275c` | 2632805 | 3279901 | 81963 / 729059 | 3279901 |
| 88 | SealedAuctionHouse | CREATE | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 4771705 | 5943687 | 148447 / 1320429 | 5943687 |
| 89 | AtomicClearingEngine.activateClearingChannel#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 79168 | 104257 | 3173 / 28262 | 104257 |
| 90 | StreamingQuoteEngine | CREATE | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 4743065 | 5984369 | 157121 / 1398425 | 5984369 |
| 91 | BatchClearingEngine | CREATE | `0x4301ca53072c5ed9c3ba473c544cda894d5feb11` | 3958207 | 4942003 | 124527 / 1108323 | 4942003 |
| 92 | ProtocolRouteLiquiditySource | CREATE | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 2271518 | 2872030 | 76045 / 676557 | 2872030 |
| 93 | CollateralAwareRouteEngine | CREATE | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 5225287 | 6604004 | 174928 / 1553645 | 6604004 |
| 94 | AssetRegistry.grantRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53856 | 75577 | 2755 / 24476 | 75577 |
| 95 | AssetRegistry.grantRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53856 | 75641 | 2755 / 24540 | 75641 |
| 96 | AdapterRegistry.grantRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53878 | 75582 | 2755 / 24459 | 75582 |
| 97 | AdapterRegistry.grantRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53878 | 75582 | 2755 / 24459 | 75582 |
| 98 | CalendarRegistry.grantRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53834 | 75456 | 2755 / 24377 | 75456 |
| 99 | CalendarRegistry.grantRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53834 | 75456 | 2755 / 24377 | 75456 |
| 100 | SessionRegistry.grantRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53856 | 75463 | 2755 / 24362 | 75463 |
| 101 | SessionRegistry.grantRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53856 | 75641 | 2755 / 24540 | 75641 |
| 102 | SettlementAssetRegistry.grantRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 53922 | 75707 | 2755 / 24540 | 75707 |
| 103 | SettlementAssetRegistry.grantRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 53922 | 75702 | 2755 / 24535 | 75702 |
| 104 | BenchmarkRegistry.grantRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53878 | 75629 | 2755 / 24506 | 75629 |
| 105 | BenchmarkRegistry.grantRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53878 | 75629 | 2755 / 24506 | 75629 |
| 106 | FeeScheduleRegistry.grantRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53856 | 75607 | 2755 / 24506 | 75607 |
| 107 | FeeScheduleRegistry.grantRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53856 | 75641 | 2755 / 24540 | 75641 |
| 108 | RiskDomainRegistry.grantRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53866 | 75649 | 2755 / 24538 | 75649 |
| 109 | RiskDomainRegistry.grantRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53878 | 75661 | 2755 / 24538 | 75661 |
| 110 | InstrumentRegistry.grantRole | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 53900 | 75673 | 2755 / 24528 | 75673 |
| 111 | InstrumentRegistry.grantRole#2 | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 53900 | 75653 | 2755 / 24508 | 75653 |
| 112 | MarketRegistry.grantRole | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 53856 | 75609 | 2755 / 24508 | 75609 |
| 113 | MarketRegistry.grantRole#2 | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 53856 | 75641 | 2755 / 24540 | 75641 |
| 114 | SeriesRegistry.grantRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 53918 | 75701 | 2755 / 24538 | 75701 |
| 115 | SeriesRegistry.grantRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 53918 | 75701 | 2755 / 24538 | 75701 |
| 116 | PackageRegistry.grantRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 53856 | 75624 | 2755 / 24523 | 75624 |
| 117 | PackageRegistry.grantRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 53856 | 75500 | 2755 / 24399 | 75500 |
| 118 | AssetRegistry.revokeRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37383 | 59027 | 2755 / 24399 | 59027 |
| 119 | AssetRegistry.revokeRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37383 | 59168 | 2755 / 24540 | 59168 |
| 120 | AdapterRegistry.revokeRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37471 | 59232 | 2755 / 24516 | 59232 |
| 121 | AdapterRegistry.revokeRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37471 | 59232 | 2755 / 24516 | 59232 |
| 122 | CalendarRegistry.revokeRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37493 | 59197 | 2755 / 24459 | 59197 |
| 123 | CalendarRegistry.revokeRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37493 | 59105 | 2755 / 24367 | 59105 |
| 124 | SessionRegistry.revokeRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37603 | 59215 | 2755 / 24367 | 59215 |
| 125 | SessionRegistry.revokeRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37603 | 59388 | 2755 / 24540 | 59388 |
| 126 | SettlementAssetRegistry.revokeRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 37493 | 59263 | 2755 / 24525 | 59263 |
| 127 | SettlementAssetRegistry.revokeRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 37493 | 59263 | 2755 / 24525 | 59263 |
| 128 | BenchmarkRegistry.revokeRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37603 | 59364 | 2755 / 24516 | 59364 |
| 129 | BenchmarkRegistry.revokeRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37603 | 59322 | 2755 / 24474 | 59322 |
| 130 | FeeScheduleRegistry.revokeRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37493 | 59212 | 2755 / 24474 | 59212 |
| 131 | FeeScheduleRegistry.revokeRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37493 | 59278 | 2755 / 24540 | 59278 |
| 132 | RiskDomainRegistry.revokeRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37437 | 59215 | 2755 / 24533 | 59215 |
| 133 | RiskDomainRegistry.revokeRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37449 | 59227 | 2755 / 24533 | 59227 |
| 134 | InstrumentRegistry.revokeRole | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 37493 | 59263 | 2755 / 24525 | 59263 |
| 135 | InstrumentRegistry.revokeRole#2 | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 37493 | 59244 | 2755 / 24506 | 59244 |
| 136 | MarketRegistry.revokeRole | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 37581 | 59332 | 2755 / 24506 | 59332 |
| 137 | MarketRegistry.revokeRole#2 | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 37581 | 59366 | 2755 / 24540 | 59366 |
| 138 | SeriesRegistry.revokeRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37577 | 59362 | 2755 / 24540 | 59362 |
| 139 | SeriesRegistry.revokeRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37577 | 59362 | 2755 / 24540 | 59362 |
| 140 | PackageRegistry.revokeRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37515 | 59285 | 2755 / 24525 | 59285 |
| 141 | PackageRegistry.revokeRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37515 | 59261 | 2755 / 24501 | 59261 |
| 142 | PositionEngine.grantRole | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 75965 | 2755 / 24501 | 75965 |
| 143 | PositionEngine.grantRole#2 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 75965 | 2755 / 24501 | 75965 |
| 144 | PositionEngine.grantRole#3 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 76004 | 2755 / 24540 | 76004 |
| 145 | PositionEngine.grantRole#4 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 75999 | 2755 / 24535 | 75999 |
| 146 | CollateralVault.grantRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76078 | 2755 / 24535 | 76078 |
| 147 | CollateralVault.grantRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76078 | 2755 / 24535 | 76078 |
| 148 | CapacityReservationRegistry.grantRole | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 75811 | 2755 / 24528 | 75811 |
| 149 | CapacityReservationRegistry.grantRole#2 | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 75823 | 2755 / 24540 | 75823 |
| 150 | CapacityReservationRegistry.grantRole#3 | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 75823 | 2755 / 24540 | 75823 |
| 151 | VaultBackedStreamCapacityManager.grantRole | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 54065 | 75835 | 2755 / 24525 | 75835 |
| 152 | VaultBackedStreamCapacityManager.revokeRole | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 37445 | 59193 | 2755 / 24503 | 59193 |
| 153 | VaultBackedBatchCapacityManager.grantRole | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 54122 | 75870 | 2755 / 24503 | 75870 |
| 154 | VaultBackedBatchCapacityManager.revokeRole | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 37379 | 59108 | 2755 / 24484 | 59108 |
| 155 | AtomicClearingEngine.grantRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 75938 | 2755 / 24540 | 75938 |
| 156 | AtomicClearingEngine.grantRole#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 75938 | 2755 / 24540 | 75938 |
| 157 | SealedAuctionHouse.grantRole | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 54166 | 75902 | 2755 / 24491 | 75902 |
| 158 | SealedAuctionHouse.grantRole#2 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 53962 | 75691 | 2755 / 24484 | 75691 |
| 159 | SealedAuctionHouse.grantRole#3 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 53962 | 75691 | 2755 / 24484 | 75691 |
| 160 | SealedAuctionHouse.revokeRole | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 59536 | 2755 / 24472 | 59536 |
| 161 | SealedAuctionHouse.revokeRole#2 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 59604 | 2755 / 24540 | 59604 |
| 162 | PublicOrderBook.grantRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 54076 | 75861 | 2755 / 24540 | 75861 |
| 163 | PrivateRfqBook.grantRole | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 54176 | 75949 | 2755 / 24528 | 75949 |
| 164 | StreamingQuoteEngine.grantRole | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 53971 | 75744 | 2755 / 24528 | 75744 |
| 165 | SealedAuctionHouse.grantRole#4 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 54166 | 75934 | 2755 / 24523 | 75934 |
| 166 | StreamingQuoteEngine.revokeRole | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 37183 | 58951 | 2755 / 24523 | 58951 |
| 167 | SealedAuctionHouse.revokeRole#3 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 59604 | 2755 / 24540 | 59604 |
| 168 | ProtocolRouteLiquiditySource.grantRole | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 54122 | 75907 | 2755 / 24540 | 75907 |
| 169 | ProtocolRouteLiquiditySource.revokeRole | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 37555 | 59323 | 2755 / 24523 | 59323 |
| 170 | CollateralAwareRouteEngine.grantRole | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 53896 | 75071 | 2755 / 23930 | 75071 |
| 171 | CollateralAwareRouteEngine.revokeRole | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 37357 | 58518 | 2755 / 23916 | 58518 |
| 172 | PortfolioRiskEngine.grantRole | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 75236 | 2755 / 23916 | 75236 |
| 173 | StreamingQuoteEngine.grantRole#2 | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 53383 | 75168 | 2755 / 24540 | 75168 |
| 174 | StreamingQuoteEngine.revokeRole#2 | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 34799 | 56399 | 2755 / 24355 | 56399 |
| 175 | ExecutionPolicyRegistry.grantRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 53834 | 75434 | 2755 / 24355 | 75434 |
| 176 | OrderState.grantRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 54078 | 75678 | 2755 / 24355 | 75678 |
| 177 | AtomicClearingEngine.grantRole#3 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 75736 | 2755 / 24338 | 75736 |
| 178 | AtomicClearingEngine.grantRole#4 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 53949 | 75431 | 2755 / 24237 | 75431 |
| 179 | PositionEngine.grantRole#5 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54207 | 75689 | 2755 / 24237 | 75689 |
| 180 | CollateralVault.grantRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76083 | 2755 / 24540 | 76083 |
| 181 | CollateralVault.grantRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76063 | 2755 / 24520 | 76063 |
| 182 | FundedFeeEngine.grantRole | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 54126 | 75891 | 2755 / 24520 | 75891 |
| 183 | PortfolioRiskEngine.grantRole#2 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 75840 | 2755 / 24520 | 75840 |
| 184 | PortfolioRiskEngine.grantRole#3 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 53871 | 75607 | 2755 / 24491 | 75607 |
| 185 | PortfolioRiskEngine.grantRole#4 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 75860 | 2755 / 24540 | 75860 |
| 186 | PublicOrderBook.grantRole#2 | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 53488 | 75273 | 2755 / 24540 | 75273 |
| 187 | PublicOrderBook.revokeRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 37369 | 59125 | 2755 / 24511 | 59125 |
| 188 | PublicOrderBook.revokeRole#2 | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 34985 | 56646 | 2755 / 24416 | 56646 |
| 189 | PrivateRfqBook.revokeRole | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 37895 | 59556 | 2755 / 24416 | 59556 |
| 190 | CollateralVault.grantRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 75954 | 2755 / 24411 | 75954 |
| 191 | CollateralVault.grantRole#6 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76083 | 2755 / 24540 | 76083 |
| 192 | CollateralVault.grantRole#7 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54286 | 76071 | 2755 / 24540 | 76071 |
| 193 | CollateralVault.grantRole#8 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76056 | 2755 / 24513 | 76056 |
| 194 | CollateralVault.grantRole#9 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76019 | 2755 / 24476 | 76019 |
| 195 | CollateralVault.grantRole#10 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76019 | 2755 / 24476 | 76019 |
| 196 | CollateralVault.grantRole#11 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76005 | 2755 / 24462 | 76005 |
| 197 | PositionEngine.grantRole#6 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 76004 | 2755 / 24540 | 76004 |
| 198 | PositionEngine.grantRole#7 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 76004 | 2755 / 24540 | 76004 |
| 199 | PositionEngine.grantRole#8 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 75980 | 2755 / 24516 | 75980 |
| 200 | PositionLifecycleExecutor.grantRole | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 75909 | 2755 / 24516 | 75909 |
| 201 | PositionLifecycleExecutor.grantRole#2 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 75857 | 2755 / 24464 | 75857 |
| 202 | PositionLifecycleExecutor.grantRole#3 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 75857 | 2755 / 24464 | 75857 |
| 203 | CollateralVault.grantRole#12 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76083 | 2755 / 24540 | 76083 |
| 204 | CollateralVault.grantRole#13 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 76083 | 2755 / 24540 | 76083 |
| 205 | CollateralVault.grantRole#14 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54094 | 75855 | 2755 / 24516 | 75855 |
| 206 | FundedFeeEngine.grantRole#2 | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 54126 | 75879 | 2755 / 24508 | 75879 |
| 207 | PortfolioRiskEngine.grantRole#5 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 75840 | 2755 / 24508 | 75840 |
| 208 | PortfolioRiskEngine.grantRole#6 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 75828 | 2755 / 24496 | 75828 |
| 209 | PortfolioRiskEngine.grantRole#7 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 75872 | 2755 / 24540 | 75872 |
| 210 | PositionLifecycleExecutor.grantRole#4 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 53944 | 75729 | 2755 / 24540 | 75729 |
| 211 | SignedLifecycleEngine.grantRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 53883 | 75656 | 2755 / 24528 | 75656 |
| 212 | CompressionCoordinator.grantRole | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 53856 | 75413 | 2755 / 24312 | 75413 |
| 213 | PrivacyCommitmentRegistry.grantRole | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 75545 | 2755 / 24312 | 75545 |
| 214 | PrivacyCommitmentRegistry.grantRole#2 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 75441 | 2755 / 24208 | 75441 |
| 215 | PrivacyCommitmentRegistry.grantRole#3 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 75441 | 2755 / 24208 | 75441 |
| 216 | CollateralVault.revokeRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 60022 | 2755 / 24540 | 60022 |
| 217 | CollateralVault.revokeRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 59866 | 2755 / 24384 | 59866 |
| 218 | CollateralVault.revokeRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 59866 | 2755 / 24384 | 59866 |
| 219 | CollateralVault.revokeRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 59796 | 2755 / 24314 | 59796 |
| 220 | CollateralVault.revokeRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 59667 | 2755 / 24185 | 59667 |
| 221 | PositionEngine.revokeRole | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37895 | 59325 | 2755 / 24185 | 59325 |
| 222 | PositionEngine.revokeRole#2 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 59692 | 2755 / 24540 | 59692 |
| 223 | PositionEngine.revokeRole#3 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 59692 | 2755 / 24540 | 59692 |
| 224 | PositionEngine.revokeRole#4 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 59685 | 2755 / 24533 | 59685 |
| 225 | PositionEngine.revokeRole#5 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 59568 | 2755 / 24416 | 59568 |
| 226 | FundedFeeEngine.revokeRole | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 37493 | 59154 | 2755 / 24416 | 59154 |
| 227 | PortfolioRiskEngine.revokeRole | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 37543 | 59085 | 2755 / 24297 | 59085 |
| 228 | PortfolioRiskEngine.revokeRole#2 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 37555 | 59340 | 2755 / 24540 | 59340 |
| 229 | PositionLifecycleExecutor.revokeRole | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 59256 | 2755 / 24540 | 59256 |
| 230 | PositionLifecycleExecutor.revokeRole#2 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 59236 | 2755 / 24520 | 59236 |
| 231 | PositionLifecycleExecutor.revokeRole#3 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 59151 | 2755 / 24435 | 59151 |
| 232 | PositionLifecycleExecutor.revokeRole#4 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 59151 | 2755 / 24435 | 59151 |
| 233 | SignedLifecycleEngine.revokeRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 37533 | 59061 | 2755 / 24283 | 59061 |
| 234 | CompressionCoordinator.revokeRole | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 37383 | 59168 | 2755 / 24540 | 59168 |
| 235 | PrivacyCommitmentRegistry.revokeRole | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 59344 | 2755 / 24540 | 59344 |
| 236 | PrivacyCommitmentRegistry.revokeRole#2 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 59305 | 2755 / 24501 | 59305 |
| 237 | PrivacyCommitmentRegistry.revokeRole#3 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 59288 | 2755 / 24484 | 59288 |
| 238 | ExecutionPolicyRegistry.revokeRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 37383 | 59112 | 2755 / 24484 | 59112 |
| 239 | OrderState.revokeRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 37455 | 59172 | 2755 / 24472 | 59172 |
| 240 | AtomicClearingEngine.revokeRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 37643 | 59428 | 2755 / 24540 | 59428 |
| 241 | AssetRegistry.beginDefaultAdminTransfer | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 35301 | 53679 | 2325 / 20703 | 53679 |
| 242 | AdapterRegistry.beginDefaultAdminTransfer | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 35323 | 53697 | 2325 / 20699 | 53697 |
| 243 | CalendarRegistry.beginDefaultAdminTransfer | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 35213 | 53554 | 2325 / 20666 | 53554 |
| 244 | SessionRegistry.beginDefaultAdminTransfer | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 35301 | 53642 | 2325 / 20666 | 53642 |
| 245 | SettlementAssetRegistry.beginDefaultAdminTransfer | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 35349 | 53645 | 2325 / 20621 | 53645 |
| 246 | BenchmarkRegistry.beginDefaultAdminTransfer | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 35323 | 53619 | 2325 / 20621 | 53619 |
| 247 | FeeScheduleRegistry.beginDefaultAdminTransfer | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 35345 | 53723 | 2325 / 20703 | 53723 |
| 248 | RiskDomainRegistry.beginDefaultAdminTransfer | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 35323 | 53533 | 2325 / 20535 | 53533 |
| 249 | InstrumentRegistry.beginDefaultAdminTransfer | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 35367 | 53577 | 2325 / 20535 | 53577 |
| 250 | MarketRegistry.beginDefaultAdminTransfer | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 35257 | 53463 | 2325 / 20531 | 53463 |
| 251 | SeriesRegistry.beginDefaultAdminTransfer | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 35311 | 53333 | 2325 / 20347 | 53333 |
| 252 | CollateralVault.beginDefaultAdminTransfer | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 35645 | 53667 | 2325 / 20347 | 53667 |
| 253 | PackageRegistry.beginDefaultAdminTransfer | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 35301 | 53679 | 2325 / 20703 | 53679 |
| 254 | PositionEngine.beginDefaultAdminTransfer | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 35553 | 53722 | 2325 / 20494 | 53722 |
| 255 | FundedFeeEngine.beginDefaultAdminTransfer | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 35345 | 53514 | 2325 / 20494 | 53514 |
| 256 | PortfolioRiskEngine.beginDefaultAdminTransfer | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 35333 | 53478 | 2325 / 20470 | 53478 |
| 257 | PositionLifecycleExecutor.beginDefaultAdminTransfer | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 35345 | 53389 | 2325 / 20369 | 53389 |
| 258 | SignedLifecycleEngine.beginDefaultAdminTransfer | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 35333 | 53711 | 2325 / 20703 | 53711 |
| 259 | CompressionCoordinator.beginDefaultAdminTransfer | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 35235 | 53613 | 2325 / 20703 | 53613 |
| 260 | PrivacyCommitmentRegistry.beginDefaultAdminTransfer | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 35345 | 53680 | 2325 / 20660 | 53680 |
| 261 | ExecutionPolicyRegistry.beginDefaultAdminTransfer | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 35301 | 53611 | 2325 / 20635 | 53611 |
| 262 | OrderState.beginDefaultAdminTransfer | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 35404 | 53714 | 2325 / 20635 | 53714 |
| 263 | AtomicClearingEngine.beginDefaultAdminTransfer | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 35421 | 53694 | 2325 / 20598 | 53694 |
| 264 | PrivateRfqBook.beginDefaultAdminTransfer | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 35565 | 53943 | 2325 / 20703 | 53943 |
| 265 | CapacityReservationRegistry.beginDefaultAdminTransfer | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 35213 | 53449 | 2325 / 20561 | 53449 |
| 266 | VaultBackedStreamCapacityManager.beginDefaultAdminTransfer | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 35267 | 53430 | 2325 / 20488 | 53430 |
| 267 | VaultBackedBatchCapacityManager.beginDefaultAdminTransfer | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 35289 | 53452 | 2325 / 20488 | 53452 |
| 268 | SealedAuctionHouse.beginDefaultAdminTransfer | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 35487 | 53559 | 2325 / 20397 | 53559 |
| 269 | ProtocolRouteLiquiditySource.beginDefaultAdminTransfer | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 35399 | 53777 | 2325 / 20703 | 53777 |
| 270 | CollateralAwareRouteEngine.beginDefaultAdminTransfer | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 35276 | 53654 | 2325 / 20703 | 53654 |

Bundle hash: `0x2d4631d5258eaaae4fb4c618a4e7c7331b3ad551ba9c14025afe73ccb9622231`. Source intent hash: `0xcf8789b2548eede38c2738f7cacb3e8854c5c0d914de0ad93469814e558676c3`.
