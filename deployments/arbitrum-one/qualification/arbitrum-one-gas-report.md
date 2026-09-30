# Arbitrum One Unsigned Deployment Gas Report (Planning Only)

This is a production planning artifact, not a claim that deployment was executed. No transaction was sent,
signed, broadcast, funded, or unlocked on Arbitrum One. Mainnet access was read-only. Dependent operations were
estimated with `eth_estimateGas` in canonical order on loopback Anvil forks of the pinned and latest blocks,
which are the only processes that received writes. Local forks meter only L2 execution, so each operation's Arbitrum
L1 data-posting gas was read with a read-only `eth_call` to NodeInterface `gasEstimateL1Component` at both
blocks and added to that block's estimate.

## Scope

- Complete DeploySetryn production graph from `contracts/script/PlanArbitrumOneDeployment.s.sol`.
- 82 contract creations, 29 linked-library creations, and 180 configuration calls (291 operations).
- Pinned block 509990000 (`0xd5edd6e1c8caac1a8bba0aadc5f3d52aecc6cf360dbeded39e898ce101433e72`); latest block 510314028 (`0xb310c90293489c57f477743935275e13372905cc05b494354d0be26b2cff01ca`).
- Estimation mode: `sequential-local-fork-plus-l1-component`. Each operation uses the larger of its pinned and latest estimates.
- Planning sender `0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef` is keyless and not an approved deployer. Principals are A4B1 planning placeholders.

## Budget

| Item | Value |
| --- | --- |
| Total gas limit | 280590802 |
| L1 data-posting gas at the pinned block | 9268795 |
| L1 data-posting gas at the latest block | 4215887 |
| Base fee | 0.0200 gwei |
| Max priority fee | 0.0000 gwei |
| Max fee per gas (2 x base + priority) | 0.0400 gwei |
| Aggregate maximum network cost | 0.01122363 ETH |
| Deployer requirement with 2x reserve | 0.02244726 ETH |

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
| 0 | AtomicClearingFundingLib | LIBRARY | `0x35980c104ea3153cf16e91868640e206bf5716d1` | 4036493 | 3969062 | 123821 / 56390 | 4036493 |
| 1 | AtomicClearingMatchLib | LIBRARY | `0x2dcbe5e16bd257079ce9593961c0fd89dc8b8159` | 4425822 | 4353561 | 132979 / 60718 | 4425822 |
| 2 | AtomicClearingPackageLib | LIBRARY | `0x3332c459a5e413efd247f3ed3ef2302ddc946ca5` | 3937658 | 3872950 | 119079 / 54371 | 3937658 |
| 3 | AtomicClearingSeriesLib | LIBRARY | `0xb37288bb284e37f8b230051738a015bbb460655a` | 3176038 | 3124080 | 95576 / 43618 | 3176038 |
| 4 | CashSettlementContextLib | LIBRARY | `0xa596605eb780a3180db3b6a716a4a5faaaa50bdb` | 4530009 | 4457270 | 133802 / 61063 | 4530009 |
| 5 | CashSettlementRecordLib | LIBRARY | `0xf6442343e32e02ed043b1e4c0a6b042365c35f29` | 3122077 | 3069362 | 96830 / 44115 | 3122077 |
| 6 | CollateralReservationLib | LIBRARY | `0x8983fb7701de78b5ba36feb694e17f64ad46368f` | 2828636 | 2776355 | 96034 / 43753 | 2828636 |
| 7 | DefaultAuctionLib | LIBRARY | `0x1a4a6f7af527e2b8e978abffede9f984e7df1f91` | 1679173 | 1646669 | 59650 / 27146 | 1679173 |
| 8 | DefaultOpeningLib | LIBRARY | `0xf2b839e75d4639288695f09edf3d79443d9977b4` | 2190219 | 2151322 | 71382 / 32485 | 2190219 |
| 9 | DefaultResolutionLib | LIBRARY | `0x148fbb00534b4fb64f154748239cda3558e604e1` | 3528335 | 3465154 | 116270 / 53089 | 3528335 |
| 10 | OperationalExternalActionLib | LIBRARY | `0x085484dc66fc7d4fb329cd67fee52b558019f844` | 2846240 | 2801452 | 82421 / 37633 | 2846240 |
| 11 | PortfolioRiskAdmissionLib | LIBRARY | `0x5fc7212f9cd0333f22433b85a2e8ab2dcade734e` | 4538187 | 4469362 | 126329 / 57504 | 4538187 |
| 12 | PortfolioRiskExposureLib | LIBRARY | `0x1c0d21b5cb478c6252879a0b2a42b2aebcdd5ceb` | 4397591 | 4321897 | 138936 / 63242 | 4397591 |
| 13 | PositionCreationLib | LIBRARY | `0xa3dbd2e52a3630a9ad594d0b690085e534fcf987` | 2764858 | 2717485 | 86902 / 39529 | 2764858 |
| 14 | PositionTerminalLib | LIBRARY | `0xb4cbf85625ad1ecc1282a811ccdc044dd9105cf1` | 1958902 | 1922640 | 66521 / 30259 | 1958902 |
| 15 | PositionViewLib | LIBRARY | `0xf0bfcc5a244573968ba58a49768ac1be6825725c` | 1391000 | 1364921 | 47840 / 21761 | 1391000 |
| 16 | LifecycleBackingLib | LIBRARY | `0x112705440c443ef44404cf6de13d68e7a1ad1669` | 2340172 | 2299647 | 74321 / 33796 | 2340172 |
| 17 | LifecycleSuccessorLib | LIBRARY | `0x93682d8747cdeea75b88b266e8bfac73535e82a7` | 2454983 | 2414515 | 74216 / 33748 | 2454983 |
| 18 | LifecycleActionLib | LIBRARY | `0xbebb62986ccca27375b3b401d41f40867c1412d6` | 4194218 | 4126337 | 124918 / 57037 | 4194218 |
| 19 | PrivateRfqHandoffLib | LIBRARY | `0xbb43179a5cb0f2449498f297eb0477d3cf9da695` | 3990731 | 3921246 | 127871 / 58386 | 3990731 |
| 20 | PrivateRfqLifecycleLib | LIBRARY | `0x15f70c086c109721b1caa2fab20dcbd7255c9e77` | 2358619 | 2315413 | 79377 / 36171 | 2358619 |
| 21 | PrivateRfqQuoteLib | LIBRARY | `0xd19e34333cc88293d0527f6679e2fae0252b60b2` | 4207604 | 4130508 | 141640 / 64544 | 4207604 |
| 22 | RouteSourceValidationLib | LIBRARY | `0x5223772d4544171a1568ada4ab2d1fa77aeb2e90` | 4666399 | 4598420 | 124879 / 56900 | 4666399 |
| 23 | RouteSourceReservationLib | LIBRARY | `0x90e36a21eab1112ab1d3948fb1b36beaef45c176` | 1736846 | 1708073 | 52857 / 24084 | 1736846 |
| 24 | SealedAuctionBidLib | LIBRARY | `0xa307d74bf8a347acfb8b59d82fd8dbb07e86cdb9` | 3976225 | 3906777 | 127492 / 58044 | 3976225 |
| 25 | SealedAuctionClearingLib | LIBRARY | `0x27da25dfa47988b1847c9a5bb78928ec84116e1c` | 3375174 | 3314159 | 112011 / 50996 | 3375174 |
| 26 | SealedAuctionSettlementLib | LIBRARY | `0x5506ab55371c0c369c9b964f8fc015ac63ca98bd` | 2777978 | 2726893 | 94009 / 42924 | 2777978 |
| 27 | SeriesValidationLib | LIBRARY | `0xa18ce6fd8311cb4f5b53a31050e213c097bfe26d` | 3220832 | 3169016 | 95354 / 43538 | 3220832 |
| 28 | SeriesLifecycleLib | LIBRARY | `0x04c25cffed6dfe1417d67a010716ff565add7c70` | 3756819 | 3689186 | 124409 / 56776 | 3756819 |
| 29 | AssetRegistry | CREATE | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 1428918 | 1402413 | 48755 / 22250 | 1428918 |
| 30 | AdapterRegistry | CREATE | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 1801049 | 1767031 | 62576 / 28558 | 1801049 |
| 31 | CalendarRegistry | CREATE | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 1966106 | 1929698 | 66939 / 30531 | 1966106 |
| 32 | SessionRegistry | CREATE | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 2517153 | 2471117 | 84641 / 38605 | 2517153 |
| 33 | SettlementAssetRegistry | CREATE | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 1979969 | 1942862 | 68194 / 31087 | 1979969 |
| 34 | BenchmarkRegistry | CREATE | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 3190384 | 3133566 | 104420 / 47602 | 3190384 |
| 35 | FeeScheduleRegistry | CREATE | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 2066448 | 2028617 | 69526 / 31695 | 2066448 |
| 36 | RiskDomainRegistry | CREATE | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 2595696 | 2549588 | 84851 / 38743 | 2595696 |
| 37 | InstrumentRegistry | CREATE | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 2345914 | 2302241 | 80370 / 36697 | 2345914 |
| 38 | CollateralVault | CREATE | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 4672872 | 4590163 | 152040 / 69331 | 4672872 |
| 39 | MarketRegistry | CREATE | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 4214545 | 4144970 | 127897 / 58322 | 4214545 |
| 40 | SeriesRegistry | CREATE | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 3512780 | 3446484 | 120672 / 54376 | 3512780 |
| 41 | PackageRegistry | CREATE | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 5170240 | 5083782 | 157370 / 70912 | 5170240 |
| 42 | CanonicalStrategyCompiler | CREATE | `0x0d8497d289933452eb9c746ccde5b8e88a474b1d` | 1178979 | 1156780 | 40406 / 18207 | 1178979 |
| 43 | PositionEngine | CREATE | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 4161021 | 4089662 | 129844 / 58485 | 4161021 |
| 44 | FixingEngine | CREATE | `0x1e8e8316a5a4e2b54ccddf73fc751175f492bf59` | 5330614 | 5232404 | 178703 / 80493 | 5330614 |
| 45 | FundedFeeEngine | CREATE | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 5407681 | 5310268 | 179265 / 81852 | 5407681 |
| 46 | PortfolioRiskEngine | CREATE | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 2871110 | 2818599 | 96634 / 44123 | 2871110 |
| 47 | ExecutionPolicyRegistry | CREATE | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 1096726 | 1076102 | 37937 / 17313 | 1096726 |
| 48 | TradingSessionPolicy | CREATE | `0xda830e11cdd0af588451b4169f327c60853e6037` | 731790 | 715399 | 30151 / 13760 | 731790 |
| 49 | PackageWitnessRegistry | CREATE | `0xa59979a74abfe5d403f1eb026e5259771f8dfc09` | 484423 | 473645 | 19817 / 9039 | 484423 |
| 50 | RiskAdmissionBindingRegistry | CREATE | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 1177124 | 1153749 | 42980 / 19605 | 1177124 |
| 51 | OrderValidationGate | CREATE | `0x273a3818833024c7baec38914d3b534e4a1a0242` | 1986391 | 1951094 | 64901 / 29604 | 1986391 |
| 52 | OrderState | CREATE | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 3101785 | 3044148 | 106067 / 48430 | 3101785 |
| 53 | RiskAdmissionBindingRegistry.bindOrderVerifyingContract | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 49989 | 48725 | 2325 / 1061 | 49989 |
| 54 | ClearingAdmissionGate | CREATE | `0x2395d2f71287f2e2d183d970d1cf62da4db62d44` | 2699072 | 2652892 | 84968 / 38788 | 2699072 |
| 55 | AtomicClearingEngine | CREATE | `0x89215bce82daa3028a18140160cdda91a2037da5` | 3670516 | 3603888 | 122593 / 55965 | 3670516 |
| 56 | PrivateRfqValidationGate | CREATE | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 2719157 | 2673009 | 84903 / 38755 | 2719157 |
| 57 | PrivateRfqBook | CREATE | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 5072343 | 4987751 | 155632 / 71040 | 5072343 |
| 58 | AtomicClearingEngine.activateClearingChannel | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 79123 | 77398 | 3173 / 1448 | 79123 |
| 59 | PublicBookEligibilityGate | CREATE | `0x41341a667339f0733e7728a57555adc9d2f68c78` | 1923132 | 1888045 | 64536 / 29449 | 1923132 |
| 60 | PublicOrderBook | CREATE | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 5591547 | 5493184 | 181015 / 82652 | 5591547 |
| 61 | PositionLifecycleExecutor | CREATE | `0x3ef7412d131ad28f89e202166b354b803892678d` | 2524740 | 2482487 | 77757 / 35504 | 2524740 |
| 62 | AccountPolicyAuthority | CREATE | `0xe757f9c22ceb8c21e3aeb70080282ac56b7b0877` | 698342 | 683984 | 26415 / 12057 | 698342 |
| 63 | LifecyclePolicyValidator | CREATE | `0xac2fc7a45967aadf2f2537debc0cee6e7c4656bf` | 2096408 | 2061593 | 64052 / 29237 | 2096408 |
| 64 | SignedLifecycleEngine | CREATE | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 5552417 | 5450703 | 186868 / 85154 | 5552417 |
| 65 | CompressionCoordinator | CREATE | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 3897136 | 3825941 | 130797 / 59602 | 3897136 |
| 66 | DefaultBidderGate | CREATE | `0x0c225ab391cc170881fed35076d86be61a439820` | 648428 | 634661 | 25200 / 11433 | 648428 |
| 67 | DefaultProcessEngine | CREATE | `0x5ef3c1d61abc99e6f7f4eb06ad955d05e8aa1465` | 2711346 | 2662450 | 89502 / 40606 | 2711346 |
| 68 | CashSettlementCoordinator | CREATE | `0x0380d5d27dbb67d41ed9fd5d648d72755cf2d002` | 4035390 | 3967254 | 124722 / 56586 | 4035390 |
| 69 | PrivacyCommitmentRegistry | CREATE | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 3090520 | 3033010 | 105270 / 47760 | 3090520 |
| 70 | OperationalAdapterExecutor | CREATE | `0x93dbc0846c10f0a3aa1b66a74acfbe96bb9f09bc` | 3575270 | 3524988 | 92532 / 42250 | 3575270 |
| 71 | CappedForwardPayoffModule | CREATE | `0x53803b5aff10137dc3109de12ef033238aaeb965` | 1410004 | 1384072 | 47722 / 21790 | 1410004 |
| 72 | NdfPayoffModule | CREATE | `0x503080ea2f8347c65cab0d9b100352cf34a0854f` | 1410016 | 1384077 | 47722 / 21783 | 1410016 |
| 73 | EuropeanCallPayoffModule | CREATE | `0x1fe69dd0db31e9bae6547f88fc507b1fec962ee1` | 1410003 | 1384071 | 47709 / 21777 | 1410003 |
| 74 | EuropeanPutPayoffModule | CREATE | `0x30badd25ad761c0a2ed0caf24c63ecad0b7a479d` | 1409964 | 1383990 | 47670 / 21696 | 1409964 |
| 75 | CollarPayoffModule | CREATE | `0xa38d850ab5735d0abb4fa1da97c26d0507e004db` | 1410055 | 1384032 | 47761 / 21738 | 1410055 |
| 76 | RateForwardPayoffModule | CREATE | `0x9b4f77d6e01d09a07c3c9d25e88a6157f397670b` | 1409990 | 1384072 | 47696 / 21778 | 1409990 |
| 77 | RateCapPayoffModule | CREATE | `0x9ed9addd96ed146493b2d00f23b727f922495b0b` | 1410016 | 1384084 | 47722 / 21790 | 1410016 |
| 78 | RateFloorPayoffModule | CREATE | `0xc5d5b0fdb7a514f50991c8edff0cdd39dbea8176` | 1410042 | 1384096 | 47748 / 21802 | 1410042 |
| 79 | RateCollarPayoffModule | CREATE | `0x15ffb6a26455f7068ae1e57fe85bcbccaaee66dd` | 1410016 | 1383855 | 47722 / 21561 | 1410016 |
| 80 | BasisSpreadPayoffModule | CREATE | `0x20876314cd378768f5eec6b9cbc452b9261bd994` | 1409978 | 1383838 | 47684 / 21544 | 1409978 |
| 81 | CalendarSpreadPayoffModule | CREATE | `0x7a250ad0f48c99104946824f8401d88ceb90cbdc` | 1410069 | 1383853 | 47775 / 21559 | 1410069 |
| 82 | WindowAverageScalarPayoffModule | CREATE | `0x281ece96739630819f865239cbdcafa39520770f` | 1409966 | 1383794 | 47696 / 21524 | 1409966 |
| 83 | CorrelationDispersionScalarPayoffModule | CREATE | `0x6ce3e0b83f1b15b15a7894516ed2926594d25620` | 1410029 | 1383814 | 47735 / 21520 | 1410029 |
| 84 | CapacityReservationRegistry | CREATE | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 979632 | 960161 | 35455 / 15984 | 979632 |
| 85 | VaultBackedStreamCapacityManager | CREATE | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 2916948 | 2863088 | 99116 / 45256 | 2916948 |
| 86 | VaultBackedBatchCapacityManager | CREATE | `0x64629bf15987542239b334ec6aecf36eda278c50` | 2472196 | 2425315 | 86274 / 39393 | 2472196 |
| 87 | AuctionValidationGate | CREATE | `0x6ecd78ca2c7c931f9508fe06551c17fcb725275c` | 2632805 | 2588244 | 81963 / 37402 | 2632805 |
| 88 | SealedAuctionHouse | CREATE | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 4771705 | 4690998 | 148447 / 67740 | 4771705 |
| 89 | AtomicClearingEngine.activateClearingChannel#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 79168 | 77443 | 3173 / 1448 | 79168 |
| 90 | StreamingQuoteEngine | CREATE | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 4756221 | 4670834 | 157056 / 71669 | 4756221 |
| 91 | BatchClearingEngine | CREATE | `0x4301ca53072c5ed9c3ba473c544cda894d5feb11` | 3958207 | 3890408 | 124527 / 56728 | 3958207 |
| 92 | ProtocolRouteLiquiditySource | CREATE | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 2271518 | 2230116 | 76045 / 34643 | 2271518 |
| 93 | CollateralAwareRouteEngine | CREATE | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 5225287 | 5130048 | 174928 / 79689 | 5225287 |
| 94 | OrderReceiptAuthority | CREATE | `0xc580c26d1f9b7fece4f96967e4cfed1e8bf53b01` | 491432 | 481132 | 18955 / 8655 | 491432 |
| 95 | RfqReceiptAuthority | CREATE | `0x937f9f47846a1b21cac04a8d67d5405cb6af90cb` | 491536 | 481186 | 19047 / 8697 | 491536 |
| 96 | BookOrderReceiptAuthority | CREATE | `0x70084db9465c56bfa7b223ca666a7a76d5ca6630` | 306964 | 299346 | 14017 / 6399 | 306964 |
| 97 | AuctionReceiptAuthority | CREATE | `0x66a7ef3a9ddfa3cadecd660fa68e8674c15cc3ba` | 833779 | 817754 | 29485 / 13460 | 833779 |
| 98 | SolverReceiptAuthority | CREATE | `0x49e3c4f35de3c1e8d3c26bef480758a2ebb8e637` | 645878 | 632985 | 23723 / 10830 | 645878 |
| 99 | FillReceiptAuthority | CREATE | `0xd77f28e104b1ce8fcd0660c03c14c4e1c5cc4b23` | 436817 | 427420 | 17270 / 7873 | 436817 |
| 100 | FixingReceiptAuthority | CREATE | `0x5aff79b56ab6c54db2dbdd8a7486917cd844760a` | 644906 | 631302 | 25004 / 11400 | 644906 |
| 101 | SettlementReceiptAuthority | CREATE | `0x0e1aecfd011bc0793409123d0d247692d9dc0448` | 473131 | 462789 | 19007 / 8665 | 473131 |
| 102 | DefaultReceiptAuthority | CREATE | `0x86018daf9170794c5f58378fae8c3b155c690b3b` | 470201 | 460519 | 17753 / 8071 | 470201 |
| 103 | RecoveryReceiptAuthority | CREATE | `0xf7e1834186a12618d528dbafe6f39d3d32ec75c8` | 388034 | 378971 | 16617 / 7554 | 388034 |
| 104 | LifecycleReceiptAuthority | CREATE | `0xcb0942ead2cf737854242ce3036ef33cab895c76` | 261091 | 254248 | 12593 / 5750 | 261091 |
| 105 | StreamReceiptAuthority | CREATE | `0x58b28715a56eeda56a4880753f94378dcd9fab28` | 557393 | 546127 | 20732 / 9466 | 557393 |
| 106 | RouteReceiptAuthority | CREATE | `0xf29e069e0355e970746057c6363a2654e8a6baee` | 272109 | 265129 | 12815 / 5835 | 272109 |
| 107 | PositionReceiptAuthority | CREATE | `0x05276ce78024382740812f4ea40ecd274b31c3dd` | 665728 | 653205 | 22992 / 10469 | 665728 |
| 108 | FeeReceiptAuthority | CREATE | `0x7cb42089232c3dc18039788011bc9ae9683d83e4` | 218009 | 211852 | 11260 / 5103 | 218009 |
| 109 | RiskReceiptAuthority | CREATE | `0xae11c30ec65118c91bfdf2b24b86419611682b0e` | 326753 | 318918 | 14330 / 6495 | 326753 |
| 110 | PrivacyReceiptAuthority | CREATE | `0x5923d9ee1f3b3594c55051972a9e558afac53c13` | 363583 | 355205 | 15323 / 6945 | 363583 |
| 111 | AsyncReceiptAuthority | CREATE | `0xa896d7b61f22df046135b15399747cb3916138a3` | 376742 | 368035 | 15925 / 7218 | 376742 |
| 112 | VerifiableReceiptLedger | CREATE | `0xf17d7e444ebee991532ad12dfa7712ce1d284e79` | 3833467 | 3778677 | 100828 / 46038 | 3833467 |
| 113 | RegistryStatusController | CREATE | `0x6974be131a1369614fdbb140031e03d156c1f368` | 2107078 | 2088550 | 34096 / 15568 | 2107078 |
| 114 | AssetRegistry.grantRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53856 | 52358 | 2755 / 1257 | 53856 |
| 115 | AdapterRegistry.grantRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53878 | 52380 | 2755 / 1257 | 53878 |
| 116 | CalendarRegistry.grantRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53834 | 52336 | 2755 / 1257 | 53834 |
| 117 | SessionRegistry.grantRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53856 | 52358 | 2755 / 1257 | 53856 |
| 118 | SettlementAssetRegistry.grantRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 53922 | 52424 | 2755 / 1257 | 53922 |
| 119 | BenchmarkRegistry.grantRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53878 | 52380 | 2755 / 1257 | 53878 |
| 120 | FeeScheduleRegistry.grantRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53856 | 52358 | 2755 / 1257 | 53856 |
| 121 | RiskDomainRegistry.grantRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53866 | 52369 | 2755 / 1258 | 53866 |
| 122 | InstrumentRegistry.grantRole | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 53900 | 52403 | 2755 / 1258 | 53900 |
| 123 | MarketRegistry.grantRole | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 53856 | 52359 | 2755 / 1258 | 53856 |
| 124 | SeriesRegistry.grantRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 53918 | 52420 | 2755 / 1257 | 53918 |
| 125 | PackageRegistry.grantRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 53856 | 52358 | 2755 / 1257 | 53856 |
| 126 | AssetRegistry.grantRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 54060 | 52563 | 2755 / 1258 | 54060 |
| 127 | AssetRegistry.revokeRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37383 | 35886 | 2755 / 1258 | 37383 |
| 128 | AdapterRegistry.grantRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 54082 | 52585 | 2755 / 1258 | 54082 |
| 129 | AdapterRegistry.revokeRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37471 | 35974 | 2755 / 1258 | 37471 |
| 130 | CalendarRegistry.grantRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 54038 | 52541 | 2755 / 1258 | 54038 |
| 131 | CalendarRegistry.revokeRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37493 | 35996 | 2755 / 1258 | 37493 |
| 132 | SessionRegistry.grantRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 54060 | 52562 | 2755 / 1257 | 54060 |
| 133 | SessionRegistry.revokeRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37603 | 36105 | 2755 / 1257 | 37603 |
| 134 | SettlementAssetRegistry.grantRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54126 | 52628 | 2755 / 1257 | 54126 |
| 135 | SettlementAssetRegistry.revokeRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 37493 | 35996 | 2755 / 1258 | 37493 |
| 136 | BenchmarkRegistry.grantRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 54082 | 52585 | 2755 / 1258 | 54082 |
| 137 | BenchmarkRegistry.revokeRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37603 | 36105 | 2755 / 1257 | 37603 |
| 138 | FeeScheduleRegistry.grantRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 54060 | 52562 | 2755 / 1257 | 54060 |
| 139 | FeeScheduleRegistry.revokeRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37493 | 35993 | 2755 / 1255 | 37493 |
| 140 | RiskDomainRegistry.grantRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 54082 | 52582 | 2755 / 1255 | 54082 |
| 141 | RiskDomainRegistry.revokeRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37449 | 35944 | 2755 / 1250 | 37449 |
| 142 | InstrumentRegistry.grantRole#2 | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 54104 | 52599 | 2755 / 1250 | 54104 |
| 143 | InstrumentRegistry.revokeRole | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 37493 | 35988 | 2755 / 1250 | 37493 |
| 144 | MarketRegistry.grantRole#2 | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 54060 | 52563 | 2755 / 1258 | 54060 |
| 145 | MarketRegistry.revokeRole | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 37581 | 36084 | 2755 / 1258 | 37581 |
| 146 | SeriesRegistry.grantRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 54122 | 52625 | 2755 / 1258 | 54122 |
| 147 | SeriesRegistry.revokeRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37577 | 36080 | 2755 / 1258 | 37577 |
| 148 | PackageRegistry.grantRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 54060 | 52563 | 2755 / 1258 | 54060 |
| 149 | PackageRegistry.revokeRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37515 | 36018 | 2755 / 1258 | 37515 |
| 150 | PrivacyCommitmentRegistry.grantRole | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 54192 | 52695 | 2755 / 1258 | 54192 |
| 151 | PrivacyCommitmentRegistry.revokeRole | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 36061 | 2755 / 1257 | 37559 |
| 152 | AssetRegistry.revokeRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37383 | 35885 | 2755 / 1257 | 37383 |
| 153 | AdapterRegistry.revokeRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37471 | 35974 | 2755 / 1258 | 37471 |
| 154 | CalendarRegistry.revokeRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37493 | 35996 | 2755 / 1258 | 37493 |
| 155 | SessionRegistry.revokeRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37603 | 36104 | 2755 / 1256 | 37603 |
| 156 | SettlementAssetRegistry.revokeRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 37493 | 35994 | 2755 / 1256 | 37493 |
| 157 | BenchmarkRegistry.revokeRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37603 | 36104 | 2755 / 1256 | 37603 |
| 158 | FeeScheduleRegistry.revokeRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37493 | 35994 | 2755 / 1256 | 37493 |
| 159 | RiskDomainRegistry.revokeRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37437 | 35938 | 2755 / 1256 | 37437 |
| 160 | InstrumentRegistry.revokeRole#2 | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 37493 | 35994 | 2755 / 1256 | 37493 |
| 161 | MarketRegistry.revokeRole#2 | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 37581 | 36081 | 2755 / 1255 | 37581 |
| 162 | SeriesRegistry.revokeRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37577 | 36077 | 2755 / 1255 | 37577 |
| 163 | PackageRegistry.revokeRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37515 | 36018 | 2755 / 1258 | 37515 |
| 164 | PositionEngine.grantRole | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54254 | 52757 | 2755 / 1258 | 54254 |
| 165 | PositionEngine.grantRole#2 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54254 | 52757 | 2755 / 1258 | 54254 |
| 166 | PositionEngine.grantRole#3 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54254 | 52756 | 2755 / 1257 | 54254 |
| 167 | PositionEngine.grantRole#4 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54254 | 52756 | 2755 / 1257 | 54254 |
| 168 | CollateralVault.grantRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52797 | 2755 / 1254 | 54298 |
| 169 | CollateralVault.grantRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52797 | 2755 / 1254 | 54298 |
| 170 | CapacityReservationRegistry.grantRole | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 52536 | 2755 / 1253 | 54038 |
| 171 | CapacityReservationRegistry.grantRole#2 | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 52536 | 2755 / 1253 | 54038 |
| 172 | CapacityReservationRegistry.grantRole#3 | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 52541 | 2755 / 1258 | 54038 |
| 173 | VaultBackedStreamCapacityManager.grantRole | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 54065 | 52568 | 2755 / 1258 | 54065 |
| 174 | VaultBackedStreamCapacityManager.revokeRole | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 37445 | 35948 | 2755 / 1258 | 37445 |
| 175 | VaultBackedBatchCapacityManager.grantRole | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 54122 | 52625 | 2755 / 1258 | 54122 |
| 176 | VaultBackedBatchCapacityManager.revokeRole | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 37379 | 35882 | 2755 / 1258 | 37379 |
| 177 | AtomicClearingEngine.grantRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 52655 | 2755 / 1257 | 54153 |
| 178 | AtomicClearingEngine.grantRole#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 52655 | 2755 / 1257 | 54153 |
| 179 | SealedAuctionHouse.grantRole | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 54166 | 52668 | 2755 / 1257 | 54166 |
| 180 | SealedAuctionHouse.grantRole#2 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 53962 | 52464 | 2755 / 1257 | 53962 |
| 181 | SealedAuctionHouse.grantRole#3 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 53962 | 52465 | 2755 / 1258 | 53962 |
| 182 | SealedAuctionHouse.revokeRole | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 36322 | 2755 / 1258 | 37819 |
| 183 | SealedAuctionHouse.revokeRole#2 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 36322 | 2755 / 1258 | 37819 |
| 184 | PublicOrderBook.grantRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 54076 | 52578 | 2755 / 1257 | 54076 |
| 185 | PrivateRfqBook.grantRole | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 54176 | 52678 | 2755 / 1257 | 54176 |
| 186 | StreamingQuoteEngine.grantRole | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 53971 | 52472 | 2755 / 1256 | 53971 |
| 187 | SealedAuctionHouse.grantRole#4 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 54166 | 52667 | 2755 / 1256 | 54166 |
| 188 | StreamingQuoteEngine.revokeRole | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 37205 | 35706 | 2755 / 1256 | 37205 |
| 189 | SealedAuctionHouse.revokeRole#3 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 36320 | 2755 / 1256 | 37819 |
| 190 | ProtocolRouteLiquiditySource.grantRole | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 54122 | 52623 | 2755 / 1256 | 54122 |
| 191 | ProtocolRouteLiquiditySource.revokeRole | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 37555 | 36058 | 2755 / 1258 | 37555 |
| 192 | CollateralAwareRouteEngine.grantRole | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 53896 | 52399 | 2755 / 1258 | 53896 |
| 193 | CollateralAwareRouteEngine.revokeRole | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 37357 | 35844 | 2755 / 1242 | 37357 |
| 194 | PortfolioRiskEngine.grantRole | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 52562 | 2755 / 1242 | 54075 |
| 195 | StreamingQuoteEngine.grantRole#2 | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 53383 | 51847 | 2755 / 1219 | 53383 |
| 196 | StreamingQuoteEngine.revokeRole#2 | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 34821 | 33285 | 2755 / 1219 | 34821 |
| 197 | ExecutionPolicyRegistry.grantRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 53834 | 52298 | 2755 / 1219 | 53834 |
| 198 | OrderState.grantRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 54078 | 52537 | 2755 / 1214 | 54078 |
| 199 | AtomicClearingEngine.grantRole#3 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 52612 | 2755 / 1214 | 54153 |
| 200 | AtomicClearingEngine.grantRole#4 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 53949 | 52452 | 2755 / 1258 | 53949 |
| 201 | PositionEngine.grantRole#5 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54242 | 52745 | 2755 / 1258 | 54242 |
| 202 | CollateralVault.grantRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52801 | 2755 / 1258 | 54298 |
| 203 | CollateralVault.grantRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52801 | 2755 / 1258 | 54298 |
| 204 | FundedFeeEngine.grantRole | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 54126 | 52628 | 2755 / 1257 | 54126 |
| 205 | PortfolioRiskEngine.grantRole#2 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 52577 | 2755 / 1257 | 54075 |
| 206 | PortfolioRiskEngine.grantRole#3 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 53871 | 52373 | 2755 / 1257 | 53871 |
| 207 | PortfolioRiskEngine.grantRole#4 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 52577 | 2755 / 1257 | 54075 |
| 208 | PublicOrderBook.grantRole#2 | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 53488 | 51990 | 2755 / 1257 | 53488 |
| 209 | PublicOrderBook.revokeRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 37369 | 35872 | 2755 / 1258 | 37369 |
| 210 | PublicOrderBook.revokeRole#2 | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 34985 | 33488 | 2755 / 1258 | 34985 |
| 211 | PrivateRfqBook.revokeRole | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 37895 | 36398 | 2755 / 1258 | 37895 |
| 212 | CollateralVault.grantRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52801 | 2755 / 1258 | 54298 |
| 213 | CollateralVault.grantRole#6 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52801 | 2755 / 1258 | 54298 |
| 214 | CollateralVault.grantRole#7 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54286 | 52789 | 2755 / 1258 | 54286 |
| 215 | CollateralVault.grantRole#8 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52801 | 2755 / 1258 | 54298 |
| 216 | CollateralVault.grantRole#9 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52801 | 2755 / 1258 | 54298 |
| 217 | CollateralVault.grantRole#10 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52801 | 2755 / 1258 | 54298 |
| 218 | CollateralVault.grantRole#11 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52801 | 2755 / 1258 | 54298 |
| 219 | PositionEngine.grantRole#6 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54254 | 52756 | 2755 / 1257 | 54254 |
| 220 | PositionEngine.grantRole#7 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54254 | 52756 | 2755 / 1257 | 54254 |
| 221 | PositionEngine.grantRole#8 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54254 | 52756 | 2755 / 1257 | 54254 |
| 222 | PositionLifecycleExecutor.grantRole | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 52650 | 2755 / 1257 | 54148 |
| 223 | PositionLifecycleExecutor.grantRole#2 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 52649 | 2755 / 1256 | 54148 |
| 224 | PositionLifecycleExecutor.grantRole#3 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 52562 | 2755 / 1169 | 54148 |
| 225 | CollateralVault.grantRole#12 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52716 | 2755 / 1173 | 54298 |
| 226 | CollateralVault.grantRole#13 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52716 | 2755 / 1173 | 54298 |
| 227 | CollateralVault.grantRole#14 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54094 | 52512 | 2755 / 1173 | 54094 |
| 228 | FundedFeeEngine.grantRole#2 | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 54126 | 52544 | 2755 / 1173 | 54126 |
| 229 | PortfolioRiskEngine.grantRole#5 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 52505 | 2755 / 1173 | 54087 |
| 230 | PortfolioRiskEngine.grantRole#6 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 52503 | 2755 / 1171 | 54087 |
| 231 | PortfolioRiskEngine.grantRole#7 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 52503 | 2755 / 1171 | 54087 |
| 232 | PositionLifecycleExecutor.grantRole#4 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 53944 | 52360 | 2755 / 1171 | 53944 |
| 233 | SignedLifecycleEngine.grantRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 53883 | 52299 | 2755 / 1171 | 53883 |
| 234 | CompressionCoordinator.grantRole | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 53856 | 52272 | 2755 / 1171 | 53856 |
| 235 | PrivacyCommitmentRegistry.grantRole#2 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 52404 | 2755 / 1171 | 53988 |
| 236 | PrivacyCommitmentRegistry.grantRole#3 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 52406 | 2755 / 1173 | 53988 |
| 237 | CollateralVault.revokeRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36655 | 2755 / 1173 | 38237 |
| 238 | CollateralVault.revokeRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36655 | 2755 / 1173 | 38237 |
| 239 | CollateralVault.revokeRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36655 | 2755 / 1173 | 38237 |
| 240 | CollateralVault.revokeRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36655 | 2755 / 1173 | 38237 |
| 241 | CollateralVault.revokeRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36655 | 2755 / 1173 | 38237 |
| 242 | PositionEngine.revokeRole | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37917 | 36335 | 2755 / 1173 | 37917 |
| 243 | PositionEngine.revokeRole#2 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37929 | 36347 | 2755 / 1173 | 37929 |
| 244 | PositionEngine.revokeRole#3 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37929 | 36347 | 2755 / 1173 | 37929 |
| 245 | PositionEngine.revokeRole#4 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37929 | 36346 | 2755 / 1172 | 37929 |
| 246 | PositionEngine.revokeRole#5 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37929 | 36346 | 2755 / 1172 | 37929 |
| 247 | FundedFeeEngine.revokeRole | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 37493 | 35910 | 2755 / 1172 | 37493 |
| 248 | PortfolioRiskEngine.revokeRole | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 37543 | 35960 | 2755 / 1172 | 37543 |
| 249 | PortfolioRiskEngine.revokeRole#2 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 37555 | 35971 | 2755 / 1171 | 37555 |
| 250 | PositionLifecycleExecutor.revokeRole | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 35887 | 2755 / 1171 | 37471 |
| 251 | PositionLifecycleExecutor.revokeRole#2 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 35887 | 2755 / 1171 | 37471 |
| 252 | PositionLifecycleExecutor.revokeRole#3 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 35889 | 2755 / 1173 | 37471 |
| 253 | PositionLifecycleExecutor.revokeRole#4 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 35889 | 2755 / 1173 | 37471 |
| 254 | SignedLifecycleEngine.revokeRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 37533 | 35950 | 2755 / 1172 | 37533 |
| 255 | CompressionCoordinator.revokeRole | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 37383 | 35800 | 2755 / 1172 | 37383 |
| 256 | PrivacyCommitmentRegistry.revokeRole#2 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 35975 | 2755 / 1171 | 37559 |
| 257 | PrivacyCommitmentRegistry.revokeRole#3 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 35975 | 2755 / 1171 | 37559 |
| 258 | ExecutionPolicyRegistry.revokeRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 37383 | 35797 | 2755 / 1169 | 37383 |
| 259 | OrderState.revokeRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 37455 | 35869 | 2755 / 1169 | 37455 |
| 260 | AtomicClearingEngine.revokeRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 37643 | 36057 | 2755 / 1169 | 37643 |
| 261 | AssetRegistry.beginDefaultAdminTransfer | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 35301 | 33965 | 2325 / 989 | 35301 |
| 262 | AdapterRegistry.beginDefaultAdminTransfer | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 35323 | 33987 | 2325 / 989 | 35323 |
| 263 | CalendarRegistry.beginDefaultAdminTransfer | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 35213 | 33868 | 2325 / 980 | 35213 |
| 264 | SessionRegistry.beginDefaultAdminTransfer | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 35301 | 33956 | 2325 / 980 | 35301 |
| 265 | SettlementAssetRegistry.beginDefaultAdminTransfer | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 35349 | 34003 | 2325 / 979 | 35349 |
| 266 | BenchmarkRegistry.beginDefaultAdminTransfer | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 35323 | 33977 | 2325 / 979 | 35323 |
| 267 | FeeScheduleRegistry.beginDefaultAdminTransfer | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 35345 | 33998 | 2325 / 978 | 35345 |
| 268 | RiskDomainRegistry.beginDefaultAdminTransfer | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 35323 | 33976 | 2325 / 978 | 35323 |
| 269 | InstrumentRegistry.beginDefaultAdminTransfer | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 35367 | 34031 | 2325 / 989 | 35367 |
| 270 | MarketRegistry.beginDefaultAdminTransfer | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 35257 | 33921 | 2325 / 989 | 35257 |
| 271 | SeriesRegistry.beginDefaultAdminTransfer | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 35311 | 33975 | 2325 / 989 | 35311 |
| 272 | CollateralVault.beginDefaultAdminTransfer | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 35645 | 34309 | 2325 / 989 | 35645 |
| 273 | PackageRegistry.beginDefaultAdminTransfer | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 35301 | 33965 | 2325 / 989 | 35301 |
| 274 | PositionEngine.beginDefaultAdminTransfer | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 35575 | 34239 | 2325 / 989 | 35575 |
| 275 | FundedFeeEngine.beginDefaultAdminTransfer | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 35345 | 34009 | 2325 / 989 | 35345 |
| 276 | PortfolioRiskEngine.beginDefaultAdminTransfer | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 35333 | 33996 | 2325 / 988 | 35333 |
| 277 | PositionLifecycleExecutor.beginDefaultAdminTransfer | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 35345 | 34008 | 2325 / 988 | 35345 |
| 278 | SignedLifecycleEngine.beginDefaultAdminTransfer | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 35333 | 33997 | 2325 / 989 | 35333 |
| 279 | CompressionCoordinator.beginDefaultAdminTransfer | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 35235 | 33899 | 2325 / 989 | 35235 |
| 280 | PrivacyCommitmentRegistry.beginDefaultAdminTransfer | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 35345 | 34009 | 2325 / 989 | 35345 |
| 281 | ExecutionPolicyRegistry.beginDefaultAdminTransfer | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 35301 | 33965 | 2325 / 989 | 35301 |
| 282 | OrderState.beginDefaultAdminTransfer | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 35404 | 34068 | 2325 / 989 | 35404 |
| 283 | AtomicClearingEngine.beginDefaultAdminTransfer | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 35421 | 34085 | 2325 / 989 | 35421 |
| 284 | PrivateRfqBook.beginDefaultAdminTransfer | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 35565 | 34229 | 2325 / 989 | 35565 |
| 285 | CapacityReservationRegistry.beginDefaultAdminTransfer | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 35213 | 33876 | 2325 / 988 | 35213 |
| 286 | VaultBackedStreamCapacityManager.beginDefaultAdminTransfer | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 35267 | 33930 | 2325 / 988 | 35267 |
| 287 | VaultBackedBatchCapacityManager.beginDefaultAdminTransfer | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 35289 | 33953 | 2325 / 989 | 35289 |
| 288 | SealedAuctionHouse.beginDefaultAdminTransfer | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 35487 | 34151 | 2325 / 989 | 35487 |
| 289 | ProtocolRouteLiquiditySource.beginDefaultAdminTransfer | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 35399 | 34063 | 2325 / 989 | 35399 |
| 290 | CollateralAwareRouteEngine.beginDefaultAdminTransfer | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 35276 | 33940 | 2325 / 989 | 35276 |

Bundle hash: `0x2aa18b7a51efd615e84d5ee903243a7c48431876d3c9d98ac62056b494bc727b`. Source intent hash: `0xed0574bafe25f66502da539a66ea060585134a02293d97ec0359d724d48e198f`.
