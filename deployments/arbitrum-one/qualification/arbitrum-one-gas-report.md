# Arbitrum One Unsigned Deployment Gas Report (Planning Only)

This is a production planning artifact, not a claim that deployment was executed. No transaction was sent,
signed, broadcast, funded, or unlocked on Arbitrum One. Mainnet access was read-only. Dependent operations were
estimated with `eth_estimateGas` in canonical order on loopback Anvil forks of the pinned and latest blocks,
which are the only processes that received writes. Local forks meter only L2 execution, so each operation's Arbitrum
L1 data-posting gas was read with a read-only `eth_call` to NodeInterface `gasEstimateL1Component` at both
blocks and added to that block's estimate.

## Scope

- Complete DeploySetryn production graph from `contracts/script/PlanArbitrumOneDeployment.s.sol`.
- 81 contract creations, 29 linked-library creations, and 180 configuration calls (290 operations).
- Pinned block 509990000 (`0xd5edd6e1c8caac1a8bba0aadc5f3d52aecc6cf360dbeded39e898ce101433e72`); latest block 510089209 (`0x32c7368e28bba64c0e50a1246baca9e79360873ae70b8079d446e63357d98e65`).
- Estimation mode: `sequential-local-fork-plus-l1-component`. Each operation uses the larger of its pinned and latest estimates.
- Planning sender `0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef` is keyless and not an approved deployer. Principals are A4B1 planning placeholders.

## Budget

| Item | Value |
| --- | --- |
| Total gas limit | 290686199 |
| L1 data-posting gas at the pinned block | 9205685 |
| L1 data-posting gas at the latest block | 22251979 |
| Base fee | 0.0200 gwei |
| Max priority fee | 0.0000 gwei |
| Max fee per gas (2 x base + priority) | 0.0400 gwei |
| Aggregate maximum network cost | 0.01164140 ETH |
| Deployer requirement with 2x reserve | 0.02328280 ETH |

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
| 0 | AtomicClearingFundingLib | LIBRARY | `0x35980c104ea3153cf16e91868640e206bf5716d1` | 4036493 | 4167564 | 123821 / 254892 | 4167564 |
| 1 | SeriesValidationLib | LIBRARY | `0xa18ce6fd8311cb4f5b53a31050e213c097bfe26d` | 3220832 | 3321710 | 95354 / 196232 | 3321710 |
| 2 | SeriesLifecycleLib | LIBRARY | `0x04c25cffed6dfe1417d67a010716ff565add7c70` | 3756819 | 3888307 | 124409 / 255897 | 3888307 |
| 3 | AtomicClearingMatchLib | LIBRARY | `0x2dcbe5e16bd257079ce9593961c0fd89dc8b8159` | 4425822 | 4566368 | 132979 / 273525 | 4566368 |
| 4 | SealedAuctionClearingLib | LIBRARY | `0x27da25dfa47988b1847c9a5bb78928ec84116e1c` | 3375174 | 3493743 | 112011 / 230580 | 3493743 |
| 5 | SealedAuctionBidLib | LIBRARY | `0xa307d74bf8a347acfb8b59d82fd8dbb07e86cdb9` | 3976225 | 4111182 | 127492 / 262449 | 4111182 |
| 6 | SealedAuctionSettlementLib | LIBRARY | `0x5506ab55371c0c369c9b964f8fc015ac63ca98bd` | 2777978 | 2877491 | 94009 / 193522 | 2877491 |
| 7 | RouteSourceValidationLib | LIBRARY | `0x5223772d4544171a1568ada4ab2d1fa77aeb2e90` | 4666399 | 4798565 | 124879 / 257045 | 4798565 |
| 8 | RouteSourceReservationLib | LIBRARY | `0x90e36a21eab1112ab1d3948fb1b36beaef45c176` | 1736846 | 1792656 | 52857 / 108667 | 1792656 |
| 9 | PrivateRfqLifecycleLib | LIBRARY | `0x15f70c086c109721b1caa2fab20dcbd7255c9e77` | 2358619 | 2442432 | 79377 / 163190 | 2442432 |
| 10 | PrivateRfqHandoffLib | LIBRARY | `0xbb43179a5cb0f2449498f297eb0477d3cf9da695` | 3990731 | 4126089 | 127871 / 263229 | 4126089 |
| 11 | PositionViewLib | LIBRARY | `0xf0bfcc5a244573968ba58a49768ac1be6825725c` | 1391000 | 1441542 | 47840 / 98382 | 1441542 |
| 12 | PositionTerminalLib | LIBRARY | `0x4e789a19dbe129b8b24b419cf65072074e1793c5` | 1839148 | 1906198 | 63465 / 130515 | 1906198 |
| 13 | PositionCreationLib | LIBRARY | `0xa3dbd2e52a3630a9ad594d0b690085e534fcf987` | 2764858 | 2856509 | 86902 / 178553 | 2856509 |
| 14 | PortfolioRiskExposureLib | LIBRARY | `0x1c0d21b5cb478c6252879a0b2a42b2aebcdd5ceb` | 4397591 | 4540130 | 138936 / 281475 | 4540130 |
| 15 | PortfolioRiskAdmissionLib | LIBRARY | `0x5fc7212f9cd0333f22433b85a2e8ab2dcade734e` | 4538187 | 4667793 | 126329 / 255935 | 4667793 |
| 16 | OperationalExternalActionLib | LIBRARY | `0x085484dc66fc7d4fb329cd67fee52b558019f844` | 2846240 | 2933487 | 82421 / 169668 | 2933487 |
| 17 | LifecycleSuccessorLib | LIBRARY | `0x93682d8747cdeea75b88b266e8bfac73535e82a7` | 2454983 | 2533545 | 74216 / 152778 | 2533545 |
| 18 | LifecycleBackingLib | LIBRARY | `0x112705440c443ef44404cf6de13d68e7a1ad1669` | 2340172 | 2416778 | 74321 / 150927 | 2416778 |
| 19 | LifecycleActionLib | LIBRARY | `0xbebb62986ccca27375b3b401d41f40867c1412d6` | 4194218 | 4319617 | 124918 / 250317 | 4319617 |
| 20 | DefaultResolutionLib | LIBRARY | `0x148fbb00534b4fb64f154748239cda3558e604e1` | 3528335 | 3645053 | 116270 / 232988 | 3645053 |
| 21 | DefaultOpeningLib | LIBRARY | `0xf2b839e75d4639288695f09edf3d79443d9977b4` | 2190219 | 2261695 | 71382 / 142858 | 2261695 |
| 22 | DefaultAuctionLib | LIBRARY | `0x1a4a6f7af527e2b8e978abffede9f984e7df1f91` | 1679173 | 1738901 | 59650 / 119378 | 1738901 |
| 23 | CollateralReservationLib | LIBRARY | `0x8983fb7701de78b5ba36feb694e17f64ad46368f` | 2828636 | 2930293 | 96034 / 197691 | 2930293 |
| 24 | CashSettlementRecordLib | LIBRARY | `0xf6442343e32e02ed043b1e4c0a6b042365c35f29` | 3122077 | 3224537 | 96830 / 199290 | 3224537 |
| 25 | CashSettlementContextLib | LIBRARY | `0xd86cc8d797d2c21ce03a827ae037dce4e52216f2` | 4219220 | 4349867 | 123925 / 254572 | 4349867 |
| 26 | AtomicClearingSeriesLib | LIBRARY | `0xb37288bb284e37f8b230051738a015bbb460655a` | 3176038 | 3276799 | 95576 / 196337 | 3276799 |
| 27 | AtomicClearingPackageLib | LIBRARY | `0x3332c459a5e413efd247f3ed3ef2302ddc946ca5` | 3937658 | 4062951 | 119079 / 244372 | 4062951 |
| 28 | PrivateRfqQuoteLib | LIBRARY | `0xd19e34333cc88293d0527f6679e2fae0252b60b2` | 4207604 | 4357538 | 141640 / 291574 | 4357538 |
| 29 | AssetRegistry | CREATE | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 1428918 | 1480528 | 48755 / 100365 | 1480528 |
| 30 | AdapterRegistry | CREATE | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 1801049 | 1866433 | 62576 / 127960 | 1866433 |
| 31 | CalendarRegistry | CREATE | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 1966106 | 2036048 | 66939 / 136881 | 2036048 |
| 32 | SessionRegistry | CREATE | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 2517153 | 2605471 | 84641 / 172959 | 2605471 |
| 33 | SettlementAssetRegistry | CREATE | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 1979969 | 2051125 | 68194 / 139350 | 2051125 |
| 34 | BenchmarkRegistry | CREATE | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 3190384 | 3298265 | 104420 / 212301 | 3298265 |
| 35 | FeeScheduleRegistry | CREATE | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 2066448 | 2140046 | 69526 / 143124 | 2140046 |
| 36 | RiskDomainRegistry | CREATE | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 2595696 | 2685498 | 84851 / 174653 | 2685498 |
| 37 | InstrumentRegistry | CREATE | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 2345914 | 2430973 | 80370 / 165429 | 2430973 |
| 38 | CollateralVault | CREATE | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 4672872 | 4833501 | 152040 / 312669 | 4833501 |
| 39 | MarketRegistry | CREATE | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 4214545 | 4349589 | 127897 / 262941 | 4349589 |
| 40 | SeriesRegistry | CREATE | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 3512780 | 3640518 | 120672 / 248410 | 3640518 |
| 41 | PackageRegistry | CREATE | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 5170240 | 5336824 | 157370 / 323954 | 5336824 |
| 42 | CanonicalStrategyCompiler | CREATE | `0x0d8497d289933452eb9c746ccde5b8e88a474b1d` | 1178979 | 1221668 | 40406 / 83095 | 1221668 |
| 43 | PositionEngine | CREATE | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 4123539 | 4261146 | 130249 / 267856 | 4261146 |
| 44 | FixingEngine | CREATE | `0x1e8e8316a5a4e2b54ccddf73fc751175f492bf59` | 5303802 | 5487014 | 173752 / 356964 | 5487014 |
| 45 | FundedFeeEngine | CREATE | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 5407681 | 5596706 | 179265 / 368290 | 5596706 |
| 46 | PortfolioRiskEngine | CREATE | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 2871110 | 2973403 | 96634 / 198927 | 2973403 |
| 47 | ExecutionPolicyRegistry | CREATE | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 1096726 | 1136799 | 37937 / 78010 | 1136799 |
| 48 | TradingSessionPolicy | CREATE | `0xda830e11cdd0af588451b4169f327c60853e6037` | 731790 | 763639 | 30151 / 62000 | 763639 |
| 49 | PackageWitnessRegistry | CREATE | `0xa59979a74abfe5d403f1eb026e5259771f8dfc09` | 484423 | 505316 | 19817 / 40710 | 505316 |
| 50 | RiskAdmissionBindingRegistry | CREATE | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 1177124 | 1222076 | 42980 / 87932 | 1222076 |
| 51 | OrderValidationGate | CREATE | `0x273a3818833024c7baec38914d3b534e4a1a0242` | 1986391 | 2054270 | 64901 / 132780 | 2054270 |
| 52 | OrderState | CREATE | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 3101785 | 3214063 | 106067 / 218345 | 3214063 |
| 53 | RiskAdmissionBindingRegistry.bindOrderVerifyingContract | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 49989 | 52450 | 2325 / 4786 | 52450 |
| 54 | ClearingAdmissionGate | CREATE | `0x2395d2f71287f2e2d183d970d1cf62da4db62d44` | 2699072 | 2789015 | 84968 / 174911 | 2789015 |
| 55 | AtomicClearingEngine | CREATE | `0x89215bce82daa3028a18140160cdda91a2037da5` | 3670494 | 3800013 | 122593 / 252112 | 3800013 |
| 56 | PrivateRfqValidationGate | CREATE | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 2719157 | 2808856 | 84903 / 174602 | 2808856 |
| 57 | PrivateRfqBook | CREATE | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 5072343 | 5236641 | 155632 / 319930 | 5236641 |
| 58 | AtomicClearingEngine.activateClearingChannel | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 79123 | 82474 | 3173 / 6524 | 82474 |
| 59 | PublicBookEligibilityGate | CREATE | `0x41341a667339f0733e7728a57555adc9d2f68c78` | 1943359 | 2012186 | 65019 / 133846 | 2012186 |
| 60 | PublicOrderBook | CREATE | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 5591547 | 5783087 | 181015 / 372555 | 5783087 |
| 61 | PositionLifecycleExecutor | CREATE | `0x3ef7412d131ad28f89e202166b354b803892678d` | 2524740 | 2607018 | 77757 / 160035 | 2607018 |
| 62 | AccountPolicyAuthority | CREATE | `0xe757f9c22ceb8c21e3aeb70080282ac56b7b0877` | 698342 | 726293 | 26415 / 54366 | 726293 |
| 63 | LifecyclePolicyValidator | CREATE | `0xac2fc7a45967aadf2f2537debc0cee6e7c4656bf` | 2096386 | 2164111 | 64052 / 131777 | 2164111 |
| 64 | SignedLifecycleEngine | CREATE | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 5558476 | 5756770 | 187326 / 385620 | 5756770 |
| 65 | CompressionCoordinator | CREATE | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 3897136 | 4035591 | 130797 / 269252 | 4035591 |
| 66 | DefaultBidderGate | CREATE | `0x0c225ab391cc170881fed35076d86be61a439820` | 648428 | 675077 | 25200 / 51849 | 675077 |
| 67 | DefaultProcessEngine | CREATE | `0x5ef3c1d61abc99e6f7f4eb06ad955d05e8aa1465` | 2711346 | 2805812 | 89502 / 183968 | 2805812 |
| 68 | CashSettlementCoordinator | CREATE | `0x0380d5d27dbb67d41ed9fd5d648d72755cf2d002` | 3663230 | 3781702 | 112246 / 230718 | 3781702 |
| 69 | PrivacyCommitmentRegistry | CREATE | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 3090520 | 3201392 | 105270 / 216142 | 3201392 |
| 70 | OperationalAdapterExecutor | CREATE | `0x93dbc0846c10f0a3aa1b66a74acfbe96bb9f09bc` | 3575270 | 3672727 | 92532 / 189989 | 3672727 |
| 71 | CappedForwardPayoffModule | CREATE | `0x53803b5aff10137dc3109de12ef033238aaeb965` | 1410004 | 1460521 | 47722 / 98239 | 1460521 |
| 72 | NdfPayoffModule | CREATE | `0x503080ea2f8347c65cab0d9b100352cf34a0854f` | 1410016 | 1460514 | 47722 / 98220 | 1460514 |
| 73 | EuropeanCallPayoffModule | CREATE | `0x1fe69dd0db31e9bae6547f88fc507b1fec962ee1` | 1410003 | 1460487 | 47709 / 98193 | 1460487 |
| 74 | EuropeanPutPayoffModule | CREATE | `0x30badd25ad761c0a2ed0caf24c63ecad0b7a479d` | 1409964 | 1460347 | 47670 / 98053 | 1460347 |
| 75 | CollarPayoffModule | CREATE | `0xa38d850ab5735d0abb4fa1da97c26d0507e004db` | 1410055 | 1460535 | 47761 / 98241 | 1460535 |
| 76 | RateForwardPayoffModule | CREATE | `0x9b4f77d6e01d09a07c3c9d25e88a6157f397670b` | 1409990 | 1460372 | 47696 / 98078 | 1460372 |
| 77 | RateCapPayoffModule | CREATE | `0x9ed9addd96ed146493b2d00f23b727f922495b0b` | 1410016 | 1460533 | 47722 / 98239 | 1460533 |
| 78 | RateFloorPayoffModule | CREATE | `0xc5d5b0fdb7a514f50991c8edff0cdd39dbea8176` | 1410042 | 1460587 | 47748 / 98293 | 1460587 |
| 79 | RateCollarPayoffModule | CREATE | `0x15ffb6a26455f7068ae1e57fe85bcbccaaee66dd` | 1410016 | 1460484 | 47722 / 98190 | 1460484 |
| 80 | BasisSpreadPayoffModule | CREATE | `0x20876314cd378768f5eec6b9cbc452b9261bd994` | 1409978 | 1460404 | 47684 / 98110 | 1460404 |
| 81 | CalendarSpreadPayoffModule | CREATE | `0x7a250ad0f48c99104946824f8401d88ceb90cbdc` | 1410069 | 1460396 | 47775 / 98102 | 1460396 |
| 82 | WindowAverageScalarPayoffModule | CREATE | `0x281ece96739630819f865239cbdcafa39520770f` | 1409966 | 1460104 | 47696 / 97834 | 1460104 |
| 83 | CorrelationDispersionScalarPayoffModule | CREATE | `0x6ce3e0b83f1b15b15a7894516ed2926594d25620` | 1410029 | 1414764 | 47735 / 52470 | 1414764 |
| 84 | CapacityReservationRegistry | CREATE | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 979632 | 983149 | 35455 / 38972 | 983149 |
| 85 | VaultBackedStreamCapacityManager | CREATE | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 2916948 | 3205891 | 99116 / 388059 | 3205891 |
| 86 | VaultBackedBatchCapacityManager | CREATE | `0x64629bf15987542239b334ec6aecf36eda278c50` | 2472196 | 2723703 | 86274 / 337781 | 2723703 |
| 87 | AuctionValidationGate | CREATE | `0x6ecd78ca2c7c931f9508fe06551c17fcb725275c` | 2632805 | 2871679 | 81963 / 320837 | 2871679 |
| 88 | SealedAuctionHouse | CREATE | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 4771705 | 5204107 | 148447 / 580849 | 5204107 |
| 89 | AtomicClearingEngine.activateClearingChannel#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 79168 | 88413 | 3173 / 12418 | 88413 |
| 90 | StreamingQuoteEngine | CREATE | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 4756221 | 5214375 | 157056 / 615210 | 5214375 |
| 91 | BatchClearingEngine | CREATE | `0x4301ca53072c5ed9c3ba473c544cda894d5feb11` | 3958207 | 4320544 | 124527 / 486864 | 4320544 |
| 92 | ProtocolRouteLiquiditySource | CREATE | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 2271518 | 2492790 | 76045 / 297317 | 2492790 |
| 93 | CollateralAwareRouteEngine | CREATE | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 5225287 | 5731286 | 174928 / 680927 | 5731286 |
| 94 | OrderReceiptAuthority | CREATE | `0xc580c26d1f9b7fece4f96967e4cfed1e8bf53b01` | 491432 | 546264 | 18955 / 73787 | 546264 |
| 95 | RfqReceiptAuthority | CREATE | `0x937f9f47846a1b21cac04a8d67d5405cb6af90cb` | 491536 | 546522 | 19047 / 74033 | 546522 |
| 96 | BookOrderReceiptAuthority | CREATE | `0x70084db9465c56bfa7b223ca666a7a76d5ca6630` | 306964 | 347854 | 14017 / 54907 | 347854 |
| 97 | AuctionReceiptAuthority | CREATE | `0x66a7ef3a9ddfa3cadecd660fa68e8674c15cc3ba` | 833779 | 919793 | 29485 / 115499 | 919793 |
| 98 | SolverReceiptAuthority | CREATE | `0x49e3c4f35de3c1e8d3c26bef480758a2ebb8e637` | 645878 | 714992 | 23723 / 92837 | 714992 |
| 99 | FillReceiptAuthority | CREATE | `0xd77f28e104b1ce8fcd0660c03c14c4e1c5cc4b23` | 436817 | 487116 | 17270 / 67569 | 487116 |
| 100 | FixingReceiptAuthority | CREATE | `0x5aff79b56ab6c54db2dbdd8a7486917cd844760a` | 644906 | 717730 | 25004 / 97828 | 717730 |
| 101 | SettlementReceiptAuthority | CREATE | `0x0e1aecfd011bc0793409123d0d247692d9dc0448` | 473131 | 528393 | 19007 / 74269 | 528393 |
| 102 | DefaultReceiptAuthority | CREATE | `0x86018daf9170794c5f58378fae8c3b155c690b3b` | 470201 | 521818 | 17753 / 69370 | 521818 |
| 103 | RecoveryReceiptAuthority | CREATE | `0xf7e1834186a12618d528dbafe6f39d3d32ec75c8` | 388034 | 436508 | 16617 / 65091 | 436508 |
| 104 | LifecycleReceiptAuthority | CREATE | `0xcb0942ead2cf737854242ce3036ef33cab895c76` | 261091 | 297583 | 12593 / 49085 | 297583 |
| 105 | StreamReceiptAuthority | CREATE | `0x58b28715a56eeda56a4880753f94378dcd9fab28` | 557393 | 617467 | 20732 / 80806 | 617467 |
| 106 | RouteReceiptAuthority | CREATE | `0xf29e069e0355e970746057c6363a2654e8a6baee` | 272109 | 309237 | 12815 / 49943 | 309237 |
| 107 | PositionReceiptAuthority | CREATE | `0x05276ce78024382740812f4ea40ecd274b31c3dd` | 665728 | 732316 | 22992 / 89580 | 732316 |
| 108 | FeeReceiptAuthority | CREATE | `0x7cb42089232c3dc18039788011bc9ae9683d83e4` | 218009 | 250621 | 11260 / 43872 | 250621 |
| 109 | RiskReceiptAuthority | CREATE | `0xae11c30ec65118c91bfdf2b24b86419611682b0e` | 326753 | 368559 | 14330 / 56136 | 368559 |
| 110 | PrivacyReceiptAuthority | CREATE | `0x5923d9ee1f3b3594c55051972a9e558afac53c13` | 363583 | 408284 | 15323 / 60024 | 408284 |
| 111 | AsyncReceiptAuthority | CREATE | `0xa896d7b61f22df046135b15399747cb3916138a3` | 376742 | 423179 | 15925 / 62362 | 423179 |
| 112 | VerifiableReceiptLedger | CREATE | `0xf17d7e444ebee991532ad12dfa7712ce1d284e79` | 3833467 | 4127201 | 100828 / 394562 | 4127201 |
| 113 | AssetRegistry.grantRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53856 | 61885 | 2755 / 10784 | 61885 |
| 114 | AssetRegistry.grantRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53856 | 61870 | 2755 / 10769 | 61870 |
| 115 | AdapterRegistry.grantRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53878 | 61918 | 2755 / 10795 | 61918 |
| 116 | AdapterRegistry.grantRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53878 | 61918 | 2755 / 10795 | 61918 |
| 117 | CalendarRegistry.grantRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53834 | 61869 | 2755 / 10790 | 61869 |
| 118 | CalendarRegistry.grantRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53834 | 61869 | 2755 / 10790 | 61869 |
| 119 | SessionRegistry.grantRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53856 | 61889 | 2755 / 10788 | 61889 |
| 120 | SessionRegistry.grantRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53856 | 61889 | 2755 / 10788 | 61889 |
| 121 | SettlementAssetRegistry.grantRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 53922 | 61950 | 2755 / 10783 | 61950 |
| 122 | SettlementAssetRegistry.grantRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 53922 | 61962 | 2755 / 10795 | 61962 |
| 123 | BenchmarkRegistry.grantRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53878 | 61918 | 2755 / 10795 | 61918 |
| 124 | BenchmarkRegistry.grantRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53878 | 61895 | 2755 / 10772 | 61895 |
| 125 | FeeScheduleRegistry.grantRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53856 | 61873 | 2755 / 10772 | 61873 |
| 126 | FeeScheduleRegistry.grantRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53856 | 61871 | 2755 / 10770 | 61871 |
| 127 | RiskDomainRegistry.grantRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53866 | 61790 | 2755 / 10679 | 61790 |
| 128 | RiskDomainRegistry.grantRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53878 | 61802 | 2755 / 10679 | 61802 |
| 129 | InstrumentRegistry.grantRole | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 53900 | 61940 | 2755 / 10795 | 61940 |
| 130 | InstrumentRegistry.grantRole#2 | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 53900 | 61940 | 2755 / 10795 | 61940 |
| 131 | MarketRegistry.grantRole | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 53856 | 61888 | 2755 / 10787 | 61888 |
| 132 | MarketRegistry.grantRole#2 | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 53856 | 61885 | 2755 / 10784 | 61885 |
| 133 | SeriesRegistry.grantRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 53918 | 61947 | 2755 / 10784 | 61947 |
| 134 | SeriesRegistry.grantRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 53918 | 61939 | 2755 / 10776 | 61939 |
| 135 | PackageRegistry.grantRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 53856 | 61896 | 2755 / 10795 | 61896 |
| 136 | PackageRegistry.grantRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 53856 | 61896 | 2755 / 10795 | 61896 |
| 137 | AssetRegistry.revokeRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37383 | 45395 | 2755 / 10767 | 45395 |
| 138 | AssetRegistry.revokeRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37383 | 45395 | 2755 / 10767 | 45395 |
| 139 | AdapterRegistry.revokeRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37471 | 45471 | 2755 / 10755 | 45471 |
| 140 | AdapterRegistry.revokeRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37471 | 45471 | 2755 / 10755 | 45471 |
| 141 | CalendarRegistry.revokeRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37493 | 45493 | 2755 / 10755 | 45493 |
| 142 | CalendarRegistry.revokeRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37493 | 45533 | 2755 / 10795 | 45533 |
| 143 | SessionRegistry.revokeRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37603 | 45640 | 2755 / 10792 | 45640 |
| 144 | SessionRegistry.revokeRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37603 | 45640 | 2755 / 10792 | 45640 |
| 145 | SettlementAssetRegistry.revokeRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 37493 | 45522 | 2755 / 10784 | 45522 |
| 146 | SettlementAssetRegistry.revokeRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 37493 | 45522 | 2755 / 10784 | 45522 |
| 147 | BenchmarkRegistry.revokeRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37603 | 45643 | 2755 / 10795 | 45643 |
| 148 | BenchmarkRegistry.revokeRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37603 | 45635 | 2755 / 10787 | 45635 |
| 149 | FeeScheduleRegistry.revokeRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37493 | 45525 | 2755 / 10787 | 45525 |
| 150 | FeeScheduleRegistry.revokeRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37493 | 45522 | 2755 / 10784 | 45522 |
| 151 | RiskDomainRegistry.revokeRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37437 | 45463 | 2755 / 10781 | 45463 |
| 152 | RiskDomainRegistry.revokeRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37449 | 45475 | 2755 / 10781 | 45475 |
| 153 | InstrumentRegistry.revokeRole | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 37493 | 45519 | 2755 / 10781 | 45519 |
| 154 | InstrumentRegistry.revokeRole#2 | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 37493 | 45533 | 2755 / 10795 | 45533 |
| 155 | MarketRegistry.revokeRole | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 37581 | 45607 | 2755 / 10781 | 45607 |
| 156 | MarketRegistry.revokeRole#2 | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 37581 | 45607 | 2755 / 10781 | 45607 |
| 157 | SeriesRegistry.revokeRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37577 | 45601 | 2755 / 10779 | 45601 |
| 158 | SeriesRegistry.revokeRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37577 | 45601 | 2755 / 10779 | 45601 |
| 159 | PackageRegistry.revokeRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37515 | 45533 | 2755 / 10773 | 45533 |
| 160 | PackageRegistry.revokeRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37515 | 45533 | 2755 / 10773 | 45533 |
| 161 | PositionEngine.grantRole | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 62259 | 2755 / 10795 | 62259 |
| 162 | PositionEngine.grantRole#2 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 62259 | 2755 / 10795 | 62259 |
| 163 | PositionEngine.grantRole#3 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 62243 | 2755 / 10779 | 62243 |
| 164 | PositionEngine.grantRole#4 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 61957 | 2755 / 10493 | 61957 |
| 165 | CollateralVault.grantRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62036 | 2755 / 10493 | 62036 |
| 166 | CollateralVault.grantRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62338 | 2755 / 10795 | 62338 |
| 167 | CapacityReservationRegistry.grantRole | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 61920 | 2755 / 10637 | 61920 |
| 168 | CapacityReservationRegistry.grantRole#2 | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 61898 | 2755 / 10615 | 61898 |
| 169 | CapacityReservationRegistry.grantRole#3 | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 61898 | 2755 / 10615 | 61898 |
| 170 | VaultBackedStreamCapacityManager.grantRole | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 54065 | 61885 | 2755 / 10575 | 61885 |
| 171 | VaultBackedStreamCapacityManager.revokeRole | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 37445 | 45265 | 2755 / 10575 | 45265 |
| 172 | VaultBackedBatchCapacityManager.grantRole | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 54122 | 62162 | 2755 / 10795 | 62162 |
| 173 | VaultBackedBatchCapacityManager.revokeRole | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 37379 | 45397 | 2755 / 10773 | 45397 |
| 174 | AtomicClearingEngine.grantRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 62171 | 2755 / 10773 | 62171 |
| 175 | AtomicClearingEngine.grantRole#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 62167 | 2755 / 10769 | 62167 |
| 176 | SealedAuctionHouse.grantRole | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 54166 | 62180 | 2755 / 10769 | 62180 |
| 177 | SealedAuctionHouse.grantRole#2 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 53962 | 61974 | 2755 / 10767 | 61974 |
| 178 | SealedAuctionHouse.grantRole#3 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 53962 | 62002 | 2755 / 10795 | 62002 |
| 179 | SealedAuctionHouse.revokeRole | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 45859 | 2755 / 10795 | 45859 |
| 180 | SealedAuctionHouse.revokeRole#2 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 45859 | 2755 / 10795 | 45859 |
| 181 | PublicOrderBook.grantRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 54076 | 62115 | 2755 / 10794 | 62115 |
| 182 | PrivateRfqBook.grantRole | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 54176 | 62205 | 2755 / 10784 | 62205 |
| 183 | StreamingQuoteEngine.grantRole | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 53971 | 62000 | 2755 / 10784 | 62000 |
| 184 | SealedAuctionHouse.grantRole#4 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 54166 | 62206 | 2755 / 10795 | 62206 |
| 185 | StreamingQuoteEngine.revokeRole | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 37205 | 45245 | 2755 / 10795 | 45245 |
| 186 | SealedAuctionHouse.revokeRole#3 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 45853 | 2755 / 10789 | 45853 |
| 187 | ProtocolRouteLiquiditySource.grantRole | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 54122 | 62150 | 2755 / 10783 | 62150 |
| 188 | ProtocolRouteLiquiditySource.revokeRole | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 37555 | 45583 | 2755 / 10783 | 45583 |
| 189 | CollateralAwareRouteEngine.grantRole | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 53896 | 61910 | 2755 / 10769 | 61910 |
| 190 | CollateralAwareRouteEngine.revokeRole | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 37357 | 45371 | 2755 / 10769 | 45371 |
| 191 | PortfolioRiskEngine.grantRole | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 62115 | 2755 / 10795 | 62115 |
| 192 | StreamingQuoteEngine.grantRole#2 | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 53383 | 61423 | 2755 / 10795 | 61423 |
| 193 | StreamingQuoteEngine.revokeRole#2 | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 34821 | 42799 | 2755 / 10733 | 42799 |
| 194 | ExecutionPolicyRegistry.grantRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 53834 | 61809 | 2755 / 10730 | 61809 |
| 195 | OrderState.grantRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 54078 | 62053 | 2755 / 10730 | 62053 |
| 196 | AtomicClearingEngine.grantRole#3 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 62127 | 2755 / 10729 | 62127 |
| 197 | AtomicClearingEngine.grantRole#4 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 53949 | 61923 | 2755 / 10729 | 61923 |
| 198 | PositionEngine.grantRole#5 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54207 | 62247 | 2755 / 10795 | 62247 |
| 199 | CollateralVault.grantRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62338 | 2755 / 10795 | 62338 |
| 200 | CollateralVault.grantRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62325 | 2755 / 10782 | 62325 |
| 201 | FundedFeeEngine.grantRole | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 54126 | 62153 | 2755 / 10782 | 62153 |
| 202 | PortfolioRiskEngine.grantRole#2 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 62056 | 2755 / 10736 | 62056 |
| 203 | PortfolioRiskEngine.grantRole#3 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 53871 | 61852 | 2755 / 10736 | 61852 |
| 204 | PortfolioRiskEngine.grantRole#4 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 62009 | 2755 / 10689 | 62009 |
| 205 | PublicOrderBook.grantRole#2 | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 53488 | 61422 | 2755 / 10689 | 61422 |
| 206 | PublicOrderBook.revokeRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 37369 | 45409 | 2755 / 10795 | 45409 |
| 207 | PublicOrderBook.revokeRole#2 | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 34985 | 43000 | 2755 / 10770 | 43000 |
| 208 | PrivateRfqBook.revokeRole | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 37895 | 45910 | 2755 / 10770 | 45910 |
| 209 | CollateralVault.grantRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62295 | 2755 / 10752 | 62295 |
| 210 | CollateralVault.grantRole#6 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62295 | 2755 / 10752 | 62295 |
| 211 | CollateralVault.grantRole#7 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54286 | 62326 | 2755 / 10795 | 62326 |
| 212 | CollateralVault.grantRole#8 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62338 | 2755 / 10795 | 62338 |
| 213 | CollateralVault.grantRole#9 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62337 | 2755 / 10794 | 62337 |
| 214 | CollateralVault.grantRole#10 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62331 | 2755 / 10788 | 62331 |
| 215 | CollateralVault.grantRole#11 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62331 | 2755 / 10788 | 62331 |
| 216 | PositionEngine.grantRole#6 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 62245 | 2755 / 10781 | 62245 |
| 217 | PositionEngine.grantRole#7 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 62245 | 2755 / 10781 | 62245 |
| 218 | PositionEngine.grantRole#8 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 62259 | 2755 / 10795 | 62259 |
| 219 | PositionLifecycleExecutor.grantRole | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 62176 | 2755 / 10783 | 62176 |
| 220 | PositionLifecycleExecutor.grantRole#2 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 62176 | 2755 / 10783 | 62176 |
| 221 | PositionLifecycleExecutor.grantRole#3 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 62167 | 2755 / 10774 | 62167 |
| 222 | CollateralVault.grantRole#12 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62297 | 2755 / 10754 | 62297 |
| 223 | CollateralVault.grantRole#13 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 62338 | 2755 / 10795 | 62338 |
| 224 | CollateralVault.grantRole#14 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54094 | 62134 | 2755 / 10795 | 62134 |
| 225 | FundedFeeEngine.grantRole#2 | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 54126 | 62135 | 2755 / 10764 | 62135 |
| 226 | PortfolioRiskEngine.grantRole#5 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 62096 | 2755 / 10764 | 62096 |
| 227 | PortfolioRiskEngine.grantRole#6 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 62083 | 2755 / 10751 | 62083 |
| 228 | PortfolioRiskEngine.grantRole#7 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 62075 | 2755 / 10743 | 62075 |
| 229 | PositionLifecycleExecutor.grantRole#4 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 53944 | 61932 | 2755 / 10743 | 61932 |
| 230 | SignedLifecycleEngine.grantRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 53883 | 61923 | 2755 / 10795 | 61923 |
| 231 | CompressionCoordinator.grantRole | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 53856 | 61896 | 2755 / 10795 | 61896 |
| 232 | PrivacyCommitmentRegistry.grantRole | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 62009 | 2755 / 10776 | 62009 |
| 233 | PrivacyCommitmentRegistry.grantRole#2 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 62003 | 2755 / 10770 | 62003 |
| 234 | PrivacyCommitmentRegistry.grantRole#3 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 62003 | 2755 / 10770 | 62003 |
| 235 | CollateralVault.revokeRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 46238 | 2755 / 10756 | 46238 |
| 236 | CollateralVault.revokeRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 46277 | 2755 / 10795 | 46277 |
| 237 | CollateralVault.revokeRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 46277 | 2755 / 10795 | 46277 |
| 238 | CollateralVault.revokeRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 46255 | 2755 / 10773 | 46255 |
| 239 | CollateralVault.revokeRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 46255 | 2755 / 10773 | 46255 |
| 240 | PositionEngine.revokeRole | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37895 | 45911 | 2755 / 10771 | 45911 |
| 241 | PositionEngine.revokeRole#2 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 45923 | 2755 / 10771 | 45923 |
| 242 | PositionEngine.revokeRole#3 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 45914 | 2755 / 10762 | 45914 |
| 243 | PositionEngine.revokeRole#4 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 45947 | 2755 / 10795 | 45947 |
| 244 | PositionEngine.revokeRole#5 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 45947 | 2755 / 10795 | 45947 |
| 245 | FundedFeeEngine.revokeRole | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 37493 | 45519 | 2755 / 10781 | 45519 |
| 246 | PortfolioRiskEngine.revokeRole | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 37543 | 45527 | 2755 / 10739 | 45527 |
| 247 | PortfolioRiskEngine.revokeRole#2 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 37555 | 45539 | 2755 / 10739 | 45539 |
| 248 | PositionLifecycleExecutor.revokeRole | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 45455 | 2755 / 10739 | 45455 |
| 249 | PositionLifecycleExecutor.revokeRole#2 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 45453 | 2755 / 10737 | 45453 |
| 250 | PositionLifecycleExecutor.revokeRole#3 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 45511 | 2755 / 10795 | 45511 |
| 251 | PositionLifecycleExecutor.revokeRole#4 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 45485 | 2755 / 10769 | 45485 |
| 252 | SignedLifecycleEngine.revokeRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 37533 | 45547 | 2755 / 10769 | 45547 |
| 253 | CompressionCoordinator.revokeRole | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 37383 | 45382 | 2755 / 10754 | 45382 |
| 254 | PrivacyCommitmentRegistry.revokeRole | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 45558 | 2755 / 10754 | 45558 |
| 255 | PrivacyCommitmentRegistry.revokeRole#2 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 45502 | 2755 / 10698 | 45502 |
| 256 | PrivacyCommitmentRegistry.revokeRole#3 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 45599 | 2755 / 10795 | 45599 |
| 257 | ExecutionPolicyRegistry.revokeRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 37383 | 45423 | 2755 / 10795 | 45423 |
| 258 | OrderState.revokeRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 37455 | 45451 | 2755 / 10751 | 45451 |
| 259 | AtomicClearingEngine.revokeRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 37643 | 45639 | 2755 / 10751 | 45639 |
| 260 | AssetRegistry.beginDefaultAdminTransfer | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 35301 | 42039 | 2325 / 9063 | 42039 |
| 261 | AdapterRegistry.beginDefaultAdminTransfer | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 35323 | 42061 | 2325 / 9063 | 42061 |
| 262 | CalendarRegistry.beginDefaultAdminTransfer | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 35213 | 41947 | 2325 / 9059 | 41947 |
| 263 | SessionRegistry.beginDefaultAdminTransfer | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 35301 | 42035 | 2325 / 9059 | 42035 |
| 264 | SettlementAssetRegistry.beginDefaultAdminTransfer | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 35349 | 42131 | 2325 / 9107 | 42131 |
| 265 | BenchmarkRegistry.beginDefaultAdminTransfer | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 35323 | 42105 | 2325 / 9107 | 42105 |
| 266 | FeeScheduleRegistry.beginDefaultAdminTransfer | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 35345 | 42126 | 2325 / 9106 | 42126 |
| 267 | RiskDomainRegistry.beginDefaultAdminTransfer | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 35323 | 42104 | 2325 / 9106 | 42104 |
| 268 | InstrumentRegistry.beginDefaultAdminTransfer | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 35367 | 42148 | 2325 / 9106 | 42148 |
| 269 | MarketRegistry.beginDefaultAdminTransfer | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 35257 | 42037 | 2325 / 9105 | 42037 |
| 270 | SeriesRegistry.beginDefaultAdminTransfer | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 35311 | 42093 | 2325 / 9107 | 42093 |
| 271 | CollateralVault.beginDefaultAdminTransfer | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 35645 | 42427 | 2325 / 9107 | 42427 |
| 272 | PackageRegistry.beginDefaultAdminTransfer | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 35301 | 42078 | 2325 / 9102 | 42078 |
| 273 | PositionEngine.beginDefaultAdminTransfer | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 35553 | 42330 | 2325 / 9102 | 42330 |
| 274 | FundedFeeEngine.beginDefaultAdminTransfer | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 35345 | 42112 | 2325 / 9092 | 42112 |
| 275 | PortfolioRiskEngine.beginDefaultAdminTransfer | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 35333 | 42094 | 2325 / 9086 | 42094 |
| 276 | PositionLifecycleExecutor.beginDefaultAdminTransfer | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 35345 | 42106 | 2325 / 9086 | 42106 |
| 277 | SignedLifecycleEngine.beginDefaultAdminTransfer | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 35333 | 42115 | 2325 / 9107 | 42115 |
| 278 | CompressionCoordinator.beginDefaultAdminTransfer | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 35235 | 42017 | 2325 / 9107 | 42017 |
| 279 | PrivacyCommitmentRegistry.beginDefaultAdminTransfer | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 35345 | 42127 | 2325 / 9107 | 42127 |
| 280 | ExecutionPolicyRegistry.beginDefaultAdminTransfer | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 35301 | 42083 | 2325 / 9107 | 42083 |
| 281 | OrderState.beginDefaultAdminTransfer | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 35404 | 42183 | 2325 / 9104 | 42183 |
| 282 | AtomicClearingEngine.beginDefaultAdminTransfer | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 35421 | 42196 | 2325 / 9100 | 42196 |
| 283 | PrivateRfqBook.beginDefaultAdminTransfer | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 35565 | 42340 | 2325 / 9100 | 42340 |
| 284 | CapacityReservationRegistry.beginDefaultAdminTransfer | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 35213 | 41995 | 2325 / 9107 | 41995 |
| 285 | VaultBackedStreamCapacityManager.beginDefaultAdminTransfer | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 35267 | 42049 | 2325 / 9107 | 42049 |
| 286 | VaultBackedBatchCapacityManager.beginDefaultAdminTransfer | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 35289 | 42061 | 2325 / 9097 | 42061 |
| 287 | SealedAuctionHouse.beginDefaultAdminTransfer | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 35487 | 42258 | 2325 / 9096 | 42258 |
| 288 | ProtocolRouteLiquiditySource.beginDefaultAdminTransfer | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 35399 | 42170 | 2325 / 9096 | 42170 |
| 289 | CollateralAwareRouteEngine.beginDefaultAdminTransfer | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 35276 | 42042 | 2325 / 9091 | 42042 |

Bundle hash: `0xa20828c91d3b3260942b6ffa186f043d29b5271ca8e06e46ae02f94b685ae0af`. Source intent hash: `0x88e9d6eb91b7ec2dbeaac81b7580c883d02fa467565a39a0f15f8eb50d86979f`.
