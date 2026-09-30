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
- Pinned block 509990000 (`0xd5edd6e1c8caac1a8bba0aadc5f3d52aecc6cf360dbeded39e898ce101433e72`); latest block 510197250 (`0x45e9a901ab8b96bf1ce758931b67b3e74c36a91b2020b944913782de83ee9986`).
- Estimation mode: `sequential-local-fork-plus-l1-component`. Each operation uses the larger of its pinned and latest estimates.
- Planning sender `0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef` is keyless and not an approved deployer. Principals are A4B1 planning placeholders.

## Budget

| Item | Value |
| --- | --- |
| Total gas limit | 277646821 |
| L1 data-posting gas at the pinned block | 9209644 |
| L1 data-posting gas at the latest block | 2459013 |
| Base fee | 0.0200 gwei |
| Max priority fee | 0.0000 gwei |
| Max fee per gas (2 x base + priority) | 0.0400 gwei |
| Aggregate maximum network cost | 0.01110587 ETH |
| Deployer requirement with 2x reserve | 0.02221174 ETH |

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
| 0 | AtomicClearingFundingLib | LIBRARY | `0x35980c104ea3153cf16e91868640e206bf5716d1` | 4036493 | 3946073 | 123821 / 33401 | 4036493 |
| 1 | AtomicClearingMatchLib | LIBRARY | `0x2dcbe5e16bd257079ce9593961c0fd89dc8b8159` | 4425822 | 4328715 | 132979 / 35872 | 4425822 |
| 2 | AtomicClearingPackageLib | LIBRARY | `0x3332c459a5e413efd247f3ed3ef2302ddc946ca5` | 3937658 | 3850510 | 119079 / 31931 | 3937658 |
| 3 | AtomicClearingSeriesLib | LIBRARY | `0xb37288bb284e37f8b230051738a015bbb460655a` | 3176038 | 3106042 | 95576 / 25580 | 3176038 |
| 4 | CashSettlementContextLib | LIBRARY | `0xd86cc8d797d2c21ce03a827ae037dce4e52216f2` | 4219220 | 4128462 | 123925 / 33167 | 4219220 |
| 5 | CashSettlementRecordLib | LIBRARY | `0xf6442343e32e02ed043b1e4c0a6b042365c35f29` | 3122077 | 3051142 | 96830 / 25895 | 3122077 |
| 6 | CollateralReservationLib | LIBRARY | `0x8983fb7701de78b5ba36feb694e17f64ad46368f` | 2828636 | 2758284 | 96034 / 25682 | 2828636 |
| 7 | DefaultAuctionLib | LIBRARY | `0x1a4a6f7af527e2b8e978abffede9f984e7df1f91` | 1679173 | 1635614 | 59650 / 16091 | 1679173 |
| 8 | DefaultOpeningLib | LIBRARY | `0xf2b839e75d4639288695f09edf3d79443d9977b4` | 2190219 | 2138092 | 71382 / 19255 | 2190219 |
| 9 | DefaultResolutionLib | LIBRARY | `0x148fbb00534b4fb64f154748239cda3558e604e1` | 3528335 | 3443423 | 116270 / 31358 | 3528335 |
| 10 | OperationalExternalActionLib | LIBRARY | `0x085484dc66fc7d4fb329cd67fee52b558019f844` | 2846240 | 2786048 | 82421 / 22229 | 2846240 |
| 11 | PortfolioRiskAdmissionLib | LIBRARY | `0x5fc7212f9cd0333f22433b85a2e8ab2dcade734e` | 4538187 | 4445926 | 126329 / 34068 | 4538187 |
| 12 | PortfolioRiskExposureLib | LIBRARY | `0x1c0d21b5cb478c6252879a0b2a42b2aebcdd5ceb` | 4397591 | 4296123 | 138936 / 37468 | 4397591 |
| 13 | PositionCreationLib | LIBRARY | `0xa3dbd2e52a3630a9ad594d0b690085e534fcf987` | 2764858 | 2701398 | 86902 / 23442 | 2764858 |
| 14 | PositionTerminalLib | LIBRARY | `0x4e789a19dbe129b8b24b419cf65072074e1793c5` | 1839148 | 1792781 | 63465 / 17098 | 1839148 |
| 15 | PositionViewLib | LIBRARY | `0xf0bfcc5a244573968ba58a49768ac1be6825725c` | 1391000 | 1356048 | 47840 / 12888 | 1391000 |
| 16 | LifecycleBackingLib | LIBRARY | `0x112705440c443ef44404cf6de13d68e7a1ad1669` | 2340172 | 2285867 | 74321 / 20016 | 2340172 |
| 17 | LifecycleSuccessorLib | LIBRARY | `0x93682d8747cdeea75b88b266e8bfac73535e82a7` | 2454983 | 2400755 | 74216 / 19988 | 2454983 |
| 18 | LifecycleActionLib | LIBRARY | `0xbebb62986ccca27375b3b401d41f40867c1412d6` | 4194218 | 4102943 | 124918 / 33643 | 4194218 |
| 19 | PrivateRfqHandoffLib | LIBRARY | `0xbb43179a5cb0f2449498f297eb0477d3cf9da695` | 3990731 | 3897299 | 127871 / 34439 | 3990731 |
| 20 | PrivateRfqLifecycleLib | LIBRARY | `0x15f70c086c109721b1caa2fab20dcbd7255c9e77` | 2358619 | 2300654 | 79377 / 21412 | 2358619 |
| 21 | PrivateRfqQuoteLib | LIBRARY | `0xd19e34333cc88293d0527f6679e2fae0252b60b2` | 4207604 | 4104153 | 141640 / 38189 | 4207604 |
| 22 | RouteSourceValidationLib | LIBRARY | `0x5223772d4544171a1568ada4ab2d1fa77aeb2e90` | 4666399 | 4575190 | 124879 / 33670 | 4666399 |
| 23 | RouteSourceReservationLib | LIBRARY | `0x90e36a21eab1112ab1d3948fb1b36beaef45c176` | 1736846 | 1698231 | 52857 / 14242 | 1736846 |
| 24 | SealedAuctionBidLib | LIBRARY | `0xa307d74bf8a347acfb8b59d82fd8dbb07e86cdb9` | 3976225 | 3883087 | 127492 / 34354 | 3976225 |
| 25 | SealedAuctionClearingLib | LIBRARY | `0x27da25dfa47988b1847c9a5bb78928ec84116e1c` | 3375174 | 3293333 | 112011 / 30170 | 3375174 |
| 26 | SealedAuctionSettlementLib | LIBRARY | `0x5506ab55371c0c369c9b964f8fc015ac63ca98bd` | 2777978 | 2709290 | 94009 / 25321 | 2777978 |
| 27 | SeriesValidationLib | LIBRARY | `0xa18ce6fd8311cb4f5b53a31050e213c097bfe26d` | 3220832 | 3151200 | 95354 / 25722 | 3220832 |
| 28 | SeriesLifecycleLib | LIBRARY | `0x04c25cffed6dfe1417d67a010716ff565add7c70` | 3756819 | 3665651 | 124409 / 33241 | 3756819 |
| 29 | AssetRegistry | CREATE | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 1428918 | 1393190 | 48755 / 13027 | 1428918 |
| 30 | AdapterRegistry | CREATE | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 1801049 | 1755183 | 62576 / 16710 | 1801049 |
| 31 | CalendarRegistry | CREATE | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 1966106 | 1917042 | 66939 / 17875 | 1966106 |
| 32 | SessionRegistry | CREATE | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 2517153 | 2455047 | 84641 / 22535 | 2517153 |
| 33 | SettlementAssetRegistry | CREATE | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 1979969 | 1930171 | 68194 / 18396 | 1979969 |
| 34 | BenchmarkRegistry | CREATE | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 3190384 | 3114132 | 104420 / 28168 | 3190384 |
| 35 | FeeScheduleRegistry | CREATE | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 2066448 | 2015673 | 69526 / 18751 | 2066448 |
| 36 | RiskDomainRegistry | CREATE | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 2595696 | 2533709 | 84851 / 22864 | 2595696 |
| 37 | InstrumentRegistry | CREATE | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 2345914 | 2287200 | 80370 / 21656 | 2345914 |
| 38 | CollateralVault | CREATE | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 4672872 | 4561739 | 152040 / 40907 | 4672872 |
| 39 | MarketRegistry | CREATE | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 4214545 | 4121149 | 127897 / 34501 | 4214545 |
| 40 | SeriesRegistry | CREATE | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 3512780 | 3424660 | 120672 / 32552 | 3512780 |
| 41 | PackageRegistry | CREATE | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 5170240 | 5055317 | 157370 / 42447 | 5170240 |
| 42 | CanonicalStrategyCompiler | CREATE | `0x0d8497d289933452eb9c746ccde5b8e88a474b1d` | 1178979 | 1149471 | 40406 / 10898 | 1178979 |
| 43 | PositionEngine | CREATE | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 4123539 | 4028390 | 130249 / 35100 | 4123539 |
| 44 | FixingEngine | CREATE | `0x1e8e8316a5a4e2b54ccddf73fc751175f492bf59` | 5330945 | 5200638 | 178194 / 47887 | 5330945 |
| 45 | FundedFeeEngine | CREATE | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 5407681 | 5276774 | 179265 / 48358 | 5407681 |
| 46 | PortfolioRiskEngine | CREATE | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 2871110 | 2800544 | 96634 / 26068 | 2871110 |
| 47 | ExecutionPolicyRegistry | CREATE | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 1096726 | 1069005 | 37937 / 10216 | 1096726 |
| 48 | TradingSessionPolicy | CREATE | `0xda830e11cdd0af588451b4169f327c60853e6037` | 731790 | 709758 | 30151 / 8119 | 731790 |
| 49 | PackageWitnessRegistry | CREATE | `0xa59979a74abfe5d403f1eb026e5259771f8dfc09` | 484423 | 469942 | 19817 / 5336 | 484423 |
| 50 | RiskAdmissionBindingRegistry | CREATE | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 1177124 | 1145717 | 42980 / 11573 | 1177124 |
| 51 | OrderValidationGate | CREATE | `0x273a3818833024c7baec38914d3b534e4a1a0242` | 1986391 | 1938966 | 64901 / 17476 | 1986391 |
| 52 | OrderState | CREATE | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 3101785 | 3024330 | 106067 / 28612 | 3101785 |
| 53 | RiskAdmissionBindingRegistry.bindOrderVerifyingContract | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 49989 | 48291 | 2325 / 627 | 49989 |
| 54 | ClearingAdmissionGate | CREATE | `0x2395d2f71287f2e2d183d970d1cf62da4db62d44` | 2699072 | 2637022 | 84968 / 22918 | 2699072 |
| 55 | AtomicClearingEngine | CREATE | `0x89215bce82daa3028a18140160cdda91a2037da5` | 3670494 | 3580915 | 122593 / 33014 | 3670494 |
| 56 | PrivateRfqValidationGate | CREATE | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 2719157 | 2657075 | 84903 / 22821 | 2719157 |
| 57 | PrivateRfqBook | CREATE | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 5072343 | 4958543 | 155632 / 41832 | 5072343 |
| 58 | AtomicClearingEngine.activateClearingChannel | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 79123 | 76806 | 3173 / 856 | 79123 |
| 59 | PublicBookEligibilityGate | CREATE | `0x41341a667339f0733e7728a57555adc9d2f68c78` | 1923132 | 1876005 | 64536 / 17409 | 1923132 |
| 60 | PublicOrderBook | CREATE | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 5591547 | 5459182 | 181015 / 48650 | 5591547 |
| 61 | PositionLifecycleExecutor | CREATE | `0x3ef7412d131ad28f89e202166b354b803892678d` | 2524740 | 2467881 | 77757 / 20898 | 2524740 |
| 62 | AccountPolicyAuthority | CREATE | `0xe757f9c22ceb8c21e3aeb70080282ac56b7b0877` | 698342 | 679023 | 26415 / 7096 | 698342 |
| 63 | LifecyclePolicyValidator | CREATE | `0xac2fc7a45967aadf2f2537debc0cee6e7c4656bf` | 2096386 | 2049530 | 64052 / 17196 | 2096386 |
| 64 | SignedLifecycleEngine | CREATE | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 5558476 | 5421441 | 187326 / 50291 | 5558476 |
| 65 | CompressionCoordinator | CREATE | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 3897136 | 3801454 | 130797 / 35115 | 3897136 |
| 66 | DefaultBidderGate | CREATE | `0x0c225ab391cc170881fed35076d86be61a439820` | 648428 | 629993 | 25200 / 6765 | 648428 |
| 67 | DefaultProcessEngine | CREATE | `0x5ef3c1d61abc99e6f7f4eb06ad955d05e8aa1465` | 2711346 | 2645872 | 89502 / 24028 | 2711346 |
| 68 | CashSettlementCoordinator | CREATE | `0x0380d5d27dbb67d41ed9fd5d648d72755cf2d002` | 3663230 | 3581118 | 112246 / 30134 | 3663230 |
| 69 | PrivacyCommitmentRegistry | CREATE | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 3090520 | 3013647 | 105270 / 28397 | 3090520 |
| 70 | OperationalAdapterExecutor | CREATE | `0x93dbc0846c10f0a3aa1b66a74acfbe96bb9f09bc` | 3575270 | 3507699 | 92532 / 24961 | 3575270 |
| 71 | CappedForwardPayoffModule | CREATE | `0x53803b5aff10137dc3109de12ef033238aaeb965` | 1410004 | 1375155 | 47722 / 12873 | 1410004 |
| 72 | NdfPayoffModule | CREATE | `0x503080ea2f8347c65cab0d9b100352cf34a0854f` | 1410016 | 1375167 | 47722 / 12873 | 1410016 |
| 73 | EuropeanCallPayoffModule | CREATE | `0x1fe69dd0db31e9bae6547f88fc507b1fec962ee1` | 1410003 | 1375152 | 47709 / 12858 | 1410003 |
| 74 | EuropeanPutPayoffModule | CREATE | `0x30badd25ad761c0a2ed0caf24c63ecad0b7a479d` | 1409964 | 1375141 | 47670 / 12847 | 1409964 |
| 75 | CollarPayoffModule | CREATE | `0xa38d850ab5735d0abb4fa1da97c26d0507e004db` | 1410055 | 1375117 | 47761 / 12823 | 1410055 |
| 76 | RateForwardPayoffModule | CREATE | `0x9b4f77d6e01d09a07c3c9d25e88a6157f397670b` | 1409990 | 1375160 | 47696 / 12866 | 1409990 |
| 77 | RateCapPayoffModule | CREATE | `0x9ed9addd96ed146493b2d00f23b727f922495b0b` | 1410016 | 1375167 | 47722 / 12873 | 1410016 |
| 78 | RateFloorPayoffModule | CREATE | `0xc5d5b0fdb7a514f50991c8edff0cdd39dbea8176` | 1410042 | 1375174 | 47748 / 12880 | 1410042 |
| 79 | RateCollarPayoffModule | CREATE | `0x15ffb6a26455f7068ae1e57fe85bcbccaaee66dd` | 1410016 | 1375165 | 47722 / 12871 | 1410016 |
| 80 | BasisSpreadPayoffModule | CREATE | `0x20876314cd378768f5eec6b9cbc452b9261bd994` | 1409978 | 1375154 | 47684 / 12860 | 1409978 |
| 81 | CalendarSpreadPayoffModule | CREATE | `0x7a250ad0f48c99104946824f8401d88ceb90cbdc` | 1410069 | 1375166 | 47775 / 12872 | 1410069 |
| 82 | WindowAverageScalarPayoffModule | CREATE | `0x281ece96739630819f865239cbdcafa39520770f` | 1409966 | 1375121 | 47696 / 12851 | 1409966 |
| 83 | CorrelationDispersionScalarPayoffModule | CREATE | `0x6ce3e0b83f1b15b15a7894516ed2926594d25620` | 1410029 | 1375171 | 47735 / 12877 | 1410029 |
| 84 | CapacityReservationRegistry | CREATE | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 979632 | 953741 | 35455 / 9564 | 979632 |
| 85 | VaultBackedStreamCapacityManager | CREATE | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 2916948 | 2844566 | 99116 / 26734 | 2916948 |
| 86 | VaultBackedBatchCapacityManager | CREATE | `0x64629bf15987542239b334ec6aecf36eda278c50` | 2472196 | 2409193 | 86274 / 23271 | 2472196 |
| 87 | AuctionValidationGate | CREATE | `0x6ecd78ca2c7c931f9508fe06551c17fcb725275c` | 2632805 | 2572930 | 81963 / 22088 | 2632805 |
| 88 | SealedAuctionHouse | CREATE | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 4771705 | 4663262 | 148447 / 40004 | 4771705 |
| 89 | AtomicClearingEngine.activateClearingChannel#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 79168 | 76850 | 3173 / 855 | 79168 |
| 90 | StreamingQuoteEngine | CREATE | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 4756221 | 4641489 | 157056 / 42324 | 4756221 |
| 91 | BatchClearingEngine | CREATE | `0x4301ca53072c5ed9c3ba473c544cda894d5feb11` | 3958207 | 3867272 | 124527 / 33592 | 3958207 |
| 92 | ProtocolRouteLiquiditySource | CREATE | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 2271518 | 2215987 | 76045 / 20514 | 2271518 |
| 93 | CollateralAwareRouteEngine | CREATE | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 5225287 | 5097523 | 174928 / 47164 | 5225287 |
| 94 | OrderReceiptAuthority | CREATE | `0xc580c26d1f9b7fece4f96967e4cfed1e8bf53b01` | 491432 | 477559 | 18955 / 5082 | 491432 |
| 95 | RfqReceiptAuthority | CREATE | `0x937f9f47846a1b21cac04a8d67d5405cb6af90cb` | 491536 | 477595 | 19047 / 5106 | 491536 |
| 96 | BookOrderReceiptAuthority | CREATE | `0x70084db9465c56bfa7b223ca666a7a76d5ca6630` | 306964 | 296728 | 14017 / 3781 | 306964 |
| 97 | AuctionReceiptAuthority | CREATE | `0x66a7ef3a9ddfa3cadecd660fa68e8674c15cc3ba` | 833779 | 812243 | 29485 / 7949 | 833779 |
| 98 | SolverReceiptAuthority | CREATE | `0x49e3c4f35de3c1e8d3c26bef480758a2ebb8e637` | 645878 | 628550 | 23723 / 6395 | 645878 |
| 99 | FillReceiptAuthority | CREATE | `0xd77f28e104b1ce8fcd0660c03c14c4e1c5cc4b23` | 436817 | 424197 | 17270 / 4650 | 436817 |
| 100 | FixingReceiptAuthority | CREATE | `0x5aff79b56ab6c54db2dbdd8a7486917cd844760a` | 644906 | 626635 | 25004 / 6733 | 644906 |
| 101 | SettlementReceiptAuthority | CREATE | `0x0e1aecfd011bc0793409123d0d247692d9dc0448` | 473131 | 459241 | 19007 / 5117 | 473131 |
| 102 | DefaultReceiptAuthority | CREATE | `0x86018daf9170794c5f58378fae8c3b155c690b3b` | 470201 | 457227 | 17753 / 4779 | 470201 |
| 103 | RecoveryReceiptAuthority | CREATE | `0xf7e1834186a12618d528dbafe6f39d3d32ec75c8` | 388034 | 375899 | 16617 / 4482 | 388034 |
| 104 | LifecycleReceiptAuthority | CREATE | `0xcb0942ead2cf737854242ce3036ef33cab895c76` | 261091 | 251894 | 12593 / 3396 | 261091 |
| 105 | StreamReceiptAuthority | CREATE | `0x58b28715a56eeda56a4880753f94378dcd9fab28` | 557393 | 542253 | 20732 / 5592 | 557393 |
| 106 | RouteReceiptAuthority | CREATE | `0xf29e069e0355e970746057c6363a2654e8a6baee` | 272109 | 262747 | 12815 / 3453 | 272109 |
| 107 | PositionReceiptAuthority | CREATE | `0x05276ce78024382740812f4ea40ecd274b31c3dd` | 665728 | 648931 | 22992 / 6195 | 665728 |
| 108 | FeeReceiptAuthority | CREATE | `0x7cb42089232c3dc18039788011bc9ae9683d83e4` | 218009 | 209775 | 11260 / 3026 | 218009 |
| 109 | RiskReceiptAuthority | CREATE | `0xae11c30ec65118c91bfdf2b24b86419611682b0e` | 326753 | 316288 | 14330 / 3865 | 326753 |
| 110 | PrivacyReceiptAuthority | CREATE | `0x5923d9ee1f3b3594c55051972a9e558afac53c13` | 363583 | 352393 | 15323 / 4133 | 363583 |
| 111 | AsyncReceiptAuthority | CREATE | `0xa896d7b61f22df046135b15399747cb3916138a3` | 376742 | 365110 | 15925 / 4293 | 376742 |
| 112 | VerifiableReceiptLedger | CREATE | `0xf17d7e444ebee991532ad12dfa7712ce1d284e79` | 3833467 | 3759824 | 100828 / 27185 | 3833467 |
| 113 | AssetRegistry.grantRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53856 | 51844 | 2755 / 743 | 53856 |
| 114 | AssetRegistry.grantRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53856 | 51843 | 2755 / 742 | 53856 |
| 115 | AdapterRegistry.grantRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53878 | 51865 | 2755 / 742 | 53878 |
| 116 | AdapterRegistry.grantRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53878 | 51866 | 2755 / 743 | 53878 |
| 117 | CalendarRegistry.grantRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53834 | 51822 | 2755 / 743 | 53834 |
| 118 | CalendarRegistry.grantRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53834 | 51822 | 2755 / 743 | 53834 |
| 119 | SessionRegistry.grantRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53856 | 51826 | 2755 / 725 | 53856 |
| 120 | SessionRegistry.grantRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53856 | 51826 | 2755 / 725 | 53856 |
| 121 | SettlementAssetRegistry.grantRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 53922 | 51889 | 2755 / 722 | 53922 |
| 122 | SettlementAssetRegistry.grantRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 53922 | 51910 | 2755 / 743 | 53922 |
| 123 | BenchmarkRegistry.grantRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53878 | 51866 | 2755 / 743 | 53878 |
| 124 | BenchmarkRegistry.grantRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53878 | 51865 | 2755 / 742 | 53878 |
| 125 | FeeScheduleRegistry.grantRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53856 | 51843 | 2755 / 742 | 53856 |
| 126 | FeeScheduleRegistry.grantRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53856 | 51843 | 2755 / 742 | 53856 |
| 127 | RiskDomainRegistry.grantRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53866 | 51854 | 2755 / 743 | 53866 |
| 128 | RiskDomainRegistry.grantRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53878 | 51866 | 2755 / 743 | 53878 |
| 129 | InstrumentRegistry.grantRole | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 53900 | 51888 | 2755 / 743 | 53900 |
| 130 | InstrumentRegistry.grantRole#2 | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 53900 | 51887 | 2755 / 742 | 53900 |
| 131 | MarketRegistry.grantRole | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 53856 | 51843 | 2755 / 742 | 53856 |
| 132 | MarketRegistry.grantRole#2 | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 53856 | 51843 | 2755 / 742 | 53856 |
| 133 | SeriesRegistry.grantRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 53918 | 51905 | 2755 / 742 | 53918 |
| 134 | SeriesRegistry.grantRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 53918 | 51905 | 2755 / 742 | 53918 |
| 135 | PackageRegistry.grantRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 53856 | 51844 | 2755 / 743 | 53856 |
| 136 | PackageRegistry.grantRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 53856 | 51843 | 2755 / 742 | 53856 |
| 137 | AssetRegistry.revokeRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37383 | 35370 | 2755 / 742 | 37383 |
| 138 | AssetRegistry.revokeRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37383 | 35370 | 2755 / 742 | 37383 |
| 139 | AdapterRegistry.revokeRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37471 | 35459 | 2755 / 743 | 37471 |
| 140 | AdapterRegistry.revokeRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37471 | 35459 | 2755 / 743 | 37471 |
| 141 | CalendarRegistry.revokeRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37493 | 35481 | 2755 / 743 | 37493 |
| 142 | CalendarRegistry.revokeRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37493 | 35479 | 2755 / 741 | 37493 |
| 143 | SessionRegistry.revokeRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37603 | 35589 | 2755 / 741 | 37603 |
| 144 | SessionRegistry.revokeRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37603 | 35589 | 2755 / 741 | 37603 |
| 145 | SettlementAssetRegistry.revokeRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 37493 | 35479 | 2755 / 741 | 37493 |
| 146 | SettlementAssetRegistry.revokeRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 37493 | 35481 | 2755 / 743 | 37493 |
| 147 | BenchmarkRegistry.revokeRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37603 | 35590 | 2755 / 742 | 37603 |
| 148 | BenchmarkRegistry.revokeRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37603 | 35590 | 2755 / 742 | 37603 |
| 149 | FeeScheduleRegistry.revokeRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37493 | 35479 | 2755 / 741 | 37493 |
| 150 | FeeScheduleRegistry.revokeRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37493 | 35479 | 2755 / 741 | 37493 |
| 151 | RiskDomainRegistry.revokeRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37437 | 35423 | 2755 / 741 | 37437 |
| 152 | RiskDomainRegistry.revokeRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37449 | 35437 | 2755 / 743 | 37449 |
| 153 | InstrumentRegistry.revokeRole | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 37493 | 35481 | 2755 / 743 | 37493 |
| 154 | InstrumentRegistry.revokeRole#2 | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 37493 | 35481 | 2755 / 743 | 37493 |
| 155 | MarketRegistry.revokeRole | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 37581 | 35569 | 2755 / 743 | 37581 |
| 156 | MarketRegistry.revokeRole#2 | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 37581 | 35569 | 2755 / 743 | 37581 |
| 157 | SeriesRegistry.revokeRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37577 | 35563 | 2755 / 741 | 37577 |
| 158 | SeriesRegistry.revokeRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37577 | 35565 | 2755 / 743 | 37577 |
| 159 | PackageRegistry.revokeRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37515 | 35503 | 2755 / 743 | 37515 |
| 160 | PackageRegistry.revokeRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37515 | 35502 | 2755 / 742 | 37515 |
| 161 | PositionEngine.grantRole | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 52206 | 2755 / 742 | 54219 |
| 162 | PositionEngine.grantRole#2 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 52206 | 2755 / 742 | 54219 |
| 163 | PositionEngine.grantRole#3 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 52202 | 2755 / 738 | 54219 |
| 164 | PositionEngine.grantRole#4 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 52202 | 2755 / 738 | 54219 |
| 165 | CollateralVault.grantRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52286 | 2755 / 743 | 54298 |
| 166 | CollateralVault.grantRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52286 | 2755 / 743 | 54298 |
| 167 | CapacityReservationRegistry.grantRole | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 52025 | 2755 / 742 | 54038 |
| 168 | CapacityReservationRegistry.grantRole#2 | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 52024 | 2755 / 741 | 54038 |
| 169 | CapacityReservationRegistry.grantRole#3 | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 54038 | 52024 | 2755 / 741 | 54038 |
| 170 | VaultBackedStreamCapacityManager.grantRole | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 54065 | 52051 | 2755 / 741 | 54065 |
| 171 | VaultBackedStreamCapacityManager.revokeRole | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 37445 | 35431 | 2755 / 741 | 37445 |
| 172 | VaultBackedBatchCapacityManager.grantRole | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 54122 | 52110 | 2755 / 743 | 54122 |
| 173 | VaultBackedBatchCapacityManager.revokeRole | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 37379 | 35367 | 2755 / 743 | 37379 |
| 174 | AtomicClearingEngine.grantRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 52141 | 2755 / 743 | 54153 |
| 175 | AtomicClearingEngine.grantRole#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 52141 | 2755 / 743 | 54153 |
| 176 | SealedAuctionHouse.grantRole | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 54166 | 52154 | 2755 / 743 | 54166 |
| 177 | SealedAuctionHouse.grantRole#2 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 53962 | 51950 | 2755 / 743 | 53962 |
| 178 | SealedAuctionHouse.grantRole#3 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 53962 | 51949 | 2755 / 742 | 53962 |
| 179 | SealedAuctionHouse.revokeRole | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 35807 | 2755 / 743 | 37819 |
| 180 | SealedAuctionHouse.revokeRole#2 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 35807 | 2755 / 743 | 37819 |
| 181 | PublicOrderBook.grantRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 54076 | 52064 | 2755 / 743 | 54076 |
| 182 | PrivateRfqBook.grantRole | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 54176 | 52164 | 2755 / 743 | 54176 |
| 183 | StreamingQuoteEngine.grantRole | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 53971 | 51761 | 2755 / 545 | 53971 |
| 184 | SealedAuctionHouse.grantRole#4 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 54166 | 51956 | 2755 / 545 | 54166 |
| 185 | StreamingQuoteEngine.revokeRole | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 37205 | 34995 | 2755 / 545 | 37205 |
| 186 | SealedAuctionHouse.revokeRole#3 | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 37819 | 35610 | 2755 / 546 | 37819 |
| 187 | ProtocolRouteLiquiditySource.grantRole | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 54122 | 51909 | 2755 / 542 | 54122 |
| 188 | ProtocolRouteLiquiditySource.revokeRole | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 37555 | 35342 | 2755 / 542 | 37555 |
| 189 | CollateralAwareRouteEngine.grantRole | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 53896 | 51682 | 2755 / 541 | 53896 |
| 190 | CollateralAwareRouteEngine.revokeRole | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 37357 | 35143 | 2755 / 541 | 37357 |
| 191 | PortfolioRiskEngine.grantRole | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 51861 | 2755 / 541 | 54075 |
| 192 | StreamingQuoteEngine.grantRole#2 | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 53383 | 51174 | 2755 / 546 | 53383 |
| 193 | StreamingQuoteEngine.revokeRole#2 | CALL | `0xc80e322959ffa8d88bec5c666929355f3dfe812f` | 34821 | 32612 | 2755 / 546 | 34821 |
| 194 | ExecutionPolicyRegistry.grantRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 53834 | 51622 | 2755 / 543 | 53834 |
| 195 | OrderState.grantRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 54078 | 51866 | 2755 / 543 | 54078 |
| 196 | AtomicClearingEngine.grantRole#3 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 54153 | 51941 | 2755 / 543 | 54153 |
| 197 | AtomicClearingEngine.grantRole#4 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 53949 | 51737 | 2755 / 543 | 53949 |
| 198 | PositionEngine.grantRole#5 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54207 | 51995 | 2755 / 543 | 54207 |
| 199 | CollateralVault.grantRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52089 | 2755 / 546 | 54298 |
| 200 | CollateralVault.grantRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52089 | 2755 / 546 | 54298 |
| 201 | FundedFeeEngine.grantRole | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 54126 | 51917 | 2755 / 546 | 54126 |
| 202 | PortfolioRiskEngine.grantRole#2 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 51866 | 2755 / 546 | 54075 |
| 203 | PortfolioRiskEngine.grantRole#3 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 53871 | 51662 | 2755 / 546 | 53871 |
| 204 | PortfolioRiskEngine.grantRole#4 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54075 | 51866 | 2755 / 546 | 54075 |
| 205 | PublicOrderBook.grantRole#2 | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 53488 | 51279 | 2755 / 546 | 53488 |
| 206 | PublicOrderBook.revokeRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 37369 | 35160 | 2755 / 546 | 37369 |
| 207 | PublicOrderBook.revokeRole#2 | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 34985 | 32776 | 2755 / 546 | 34985 |
| 208 | PrivateRfqBook.revokeRole | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 37895 | 35686 | 2755 / 546 | 37895 |
| 209 | CollateralVault.grantRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52089 | 2755 / 546 | 54298 |
| 210 | CollateralVault.grantRole#6 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52089 | 2755 / 546 | 54298 |
| 211 | CollateralVault.grantRole#7 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54286 | 52077 | 2755 / 546 | 54286 |
| 212 | CollateralVault.grantRole#8 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52089 | 2755 / 546 | 54298 |
| 213 | CollateralVault.grantRole#9 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52084 | 2755 / 541 | 54298 |
| 214 | CollateralVault.grantRole#10 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52084 | 2755 / 541 | 54298 |
| 215 | CollateralVault.grantRole#11 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52084 | 2755 / 541 | 54298 |
| 216 | PositionEngine.grantRole#6 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 52005 | 2755 / 541 | 54219 |
| 217 | PositionEngine.grantRole#7 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 52003 | 2755 / 539 | 54219 |
| 218 | PositionEngine.grantRole#8 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 54219 | 52003 | 2755 / 539 | 54219 |
| 219 | PositionLifecycleExecutor.grantRole | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 51939 | 2755 / 546 | 54148 |
| 220 | PositionLifecycleExecutor.grantRole#2 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 51938 | 2755 / 545 | 54148 |
| 221 | PositionLifecycleExecutor.grantRole#3 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 54148 | 51938 | 2755 / 545 | 54148 |
| 222 | CollateralVault.grantRole#12 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52088 | 2755 / 545 | 54298 |
| 223 | CollateralVault.grantRole#13 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54298 | 52088 | 2755 / 545 | 54298 |
| 224 | CollateralVault.grantRole#14 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54094 | 51884 | 2755 / 545 | 54094 |
| 225 | FundedFeeEngine.grantRole#2 | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 54126 | 51917 | 2755 / 546 | 54126 |
| 226 | PortfolioRiskEngine.grantRole#5 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 51878 | 2755 / 546 | 54087 |
| 227 | PortfolioRiskEngine.grantRole#6 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 51878 | 2755 / 546 | 54087 |
| 228 | PortfolioRiskEngine.grantRole#7 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 54087 | 51878 | 2755 / 546 | 54087 |
| 229 | PositionLifecycleExecutor.grantRole#4 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 53944 | 51734 | 2755 / 545 | 53944 |
| 230 | SignedLifecycleEngine.grantRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 53883 | 51672 | 2755 / 544 | 53883 |
| 231 | CompressionCoordinator.grantRole | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 53856 | 51645 | 2755 / 544 | 53856 |
| 232 | PrivacyCommitmentRegistry.grantRole | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 51779 | 2755 / 546 | 53988 |
| 233 | PrivacyCommitmentRegistry.grantRole#2 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 51779 | 2755 / 546 | 53988 |
| 234 | PrivacyCommitmentRegistry.grantRole#3 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 53988 | 51779 | 2755 / 546 | 53988 |
| 235 | CollateralVault.revokeRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36027 | 2755 / 545 | 38237 |
| 236 | CollateralVault.revokeRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36027 | 2755 / 545 | 38237 |
| 237 | CollateralVault.revokeRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36027 | 2755 / 545 | 38237 |
| 238 | CollateralVault.revokeRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36027 | 2755 / 545 | 38237 |
| 239 | CollateralVault.revokeRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 38237 | 36028 | 2755 / 546 | 38237 |
| 240 | PositionEngine.revokeRole | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37895 | 35685 | 2755 / 545 | 37895 |
| 241 | PositionEngine.revokeRole#2 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 35696 | 2755 / 544 | 37907 |
| 242 | PositionEngine.revokeRole#3 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 35696 | 2755 / 544 | 37907 |
| 243 | PositionEngine.revokeRole#4 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 35698 | 2755 / 546 | 37907 |
| 244 | PositionEngine.revokeRole#5 | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 37907 | 35698 | 2755 / 546 | 37907 |
| 245 | FundedFeeEngine.revokeRole | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 37493 | 35284 | 2755 / 546 | 37493 |
| 246 | PortfolioRiskEngine.revokeRole | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 37543 | 35333 | 2755 / 545 | 37543 |
| 247 | PortfolioRiskEngine.revokeRole#2 | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 37555 | 35345 | 2755 / 545 | 37555 |
| 248 | PositionLifecycleExecutor.revokeRole | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 35260 | 2755 / 544 | 37471 |
| 249 | PositionLifecycleExecutor.revokeRole#2 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 35260 | 2755 / 544 | 37471 |
| 250 | PositionLifecycleExecutor.revokeRole#3 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 35262 | 2755 / 546 | 37471 |
| 251 | PositionLifecycleExecutor.revokeRole#4 | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 37471 | 35262 | 2755 / 546 | 37471 |
| 252 | SignedLifecycleEngine.revokeRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 37533 | 35324 | 2755 / 546 | 37533 |
| 253 | CompressionCoordinator.revokeRole | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 37383 | 35173 | 2755 / 545 | 37383 |
| 254 | PrivacyCommitmentRegistry.revokeRole | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 35349 | 2755 / 545 | 37559 |
| 255 | PrivacyCommitmentRegistry.revokeRole#2 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 35349 | 2755 / 545 | 37559 |
| 256 | PrivacyCommitmentRegistry.revokeRole#3 | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 37559 | 35349 | 2755 / 545 | 37559 |
| 257 | ExecutionPolicyRegistry.revokeRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 37383 | 35174 | 2755 / 546 | 37383 |
| 258 | OrderState.revokeRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 37455 | 35238 | 2755 / 538 | 37455 |
| 259 | AtomicClearingEngine.revokeRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 37643 | 35426 | 2755 / 538 | 37643 |
| 260 | AssetRegistry.beginDefaultAdminTransfer | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 35301 | 33429 | 2325 / 453 | 35301 |
| 261 | AdapterRegistry.beginDefaultAdminTransfer | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 35323 | 33447 | 2325 / 449 | 35323 |
| 262 | CalendarRegistry.beginDefaultAdminTransfer | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 35213 | 33348 | 2325 / 460 | 35213 |
| 263 | SessionRegistry.beginDefaultAdminTransfer | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 35301 | 33436 | 2325 / 460 | 35301 |
| 264 | SettlementAssetRegistry.beginDefaultAdminTransfer | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 35349 | 33484 | 2325 / 460 | 35349 |
| 265 | BenchmarkRegistry.beginDefaultAdminTransfer | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 35323 | 33458 | 2325 / 460 | 35323 |
| 266 | FeeScheduleRegistry.beginDefaultAdminTransfer | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 35345 | 33479 | 2325 / 459 | 35345 |
| 267 | RiskDomainRegistry.beginDefaultAdminTransfer | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 35323 | 33457 | 2325 / 459 | 35323 |
| 268 | InstrumentRegistry.beginDefaultAdminTransfer | CALL | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 35367 | 33501 | 2325 / 459 | 35367 |
| 269 | MarketRegistry.beginDefaultAdminTransfer | CALL | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 35257 | 33392 | 2325 / 460 | 35257 |
| 270 | SeriesRegistry.beginDefaultAdminTransfer | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 35311 | 33446 | 2325 / 460 | 35311 |
| 271 | CollateralVault.beginDefaultAdminTransfer | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 35645 | 33780 | 2325 / 460 | 35645 |
| 272 | PackageRegistry.beginDefaultAdminTransfer | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 35301 | 33436 | 2325 / 460 | 35301 |
| 273 | PositionEngine.beginDefaultAdminTransfer | CALL | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 35553 | 33688 | 2325 / 460 | 35553 |
| 274 | FundedFeeEngine.beginDefaultAdminTransfer | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 35345 | 33480 | 2325 / 460 | 35345 |
| 275 | PortfolioRiskEngine.beginDefaultAdminTransfer | CALL | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 35333 | 33468 | 2325 / 460 | 35333 |
| 276 | PositionLifecycleExecutor.beginDefaultAdminTransfer | CALL | `0x3ef7412d131ad28f89e202166b354b803892678d` | 35345 | 33480 | 2325 / 460 | 35345 |
| 277 | SignedLifecycleEngine.beginDefaultAdminTransfer | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 35333 | 33468 | 2325 / 460 | 35333 |
| 278 | CompressionCoordinator.beginDefaultAdminTransfer | CALL | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 35235 | 33370 | 2325 / 460 | 35235 |
| 279 | PrivacyCommitmentRegistry.beginDefaultAdminTransfer | CALL | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 35345 | 33480 | 2325 / 460 | 35345 |
| 280 | ExecutionPolicyRegistry.beginDefaultAdminTransfer | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 35301 | 33436 | 2325 / 460 | 35301 |
| 281 | OrderState.beginDefaultAdminTransfer | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 35404 | 33539 | 2325 / 460 | 35404 |
| 282 | AtomicClearingEngine.beginDefaultAdminTransfer | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 35421 | 33556 | 2325 / 460 | 35421 |
| 283 | PrivateRfqBook.beginDefaultAdminTransfer | CALL | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 35565 | 33700 | 2325 / 460 | 35565 |
| 284 | CapacityReservationRegistry.beginDefaultAdminTransfer | CALL | `0x59a977566174b587359d7b21f09bf9417c6f4403` | 35213 | 33348 | 2325 / 460 | 35213 |
| 285 | VaultBackedStreamCapacityManager.beginDefaultAdminTransfer | CALL | `0xeba2bae48bd183198fcf8ddab5e46ce902692798` | 35267 | 33402 | 2325 / 460 | 35267 |
| 286 | VaultBackedBatchCapacityManager.beginDefaultAdminTransfer | CALL | `0x64629bf15987542239b334ec6aecf36eda278c50` | 35289 | 33419 | 2325 / 455 | 35289 |
| 287 | SealedAuctionHouse.beginDefaultAdminTransfer | CALL | `0x14a8ef92baa876c91d93c0ef26e88dba2fcb7f20` | 35487 | 33622 | 2325 / 460 | 35487 |
| 288 | ProtocolRouteLiquiditySource.beginDefaultAdminTransfer | CALL | `0x473af1cf6f0832cb909f62884796fd4d6cdc36bf` | 35399 | 33534 | 2325 / 460 | 35399 |
| 289 | CollateralAwareRouteEngine.beginDefaultAdminTransfer | CALL | `0x53e87142dbf602757b1f0be629a4077c668a3bb6` | 35276 | 33411 | 2325 / 460 | 35276 |

Bundle hash: `0x716195ca73752fa1defe0378cf8e1c0f32b01d84531c37dbdea75839d4832086`. Source intent hash: `0x446288d81c1314c5b0dae5d6f599d717942219e6be97de5df71c3a8f5a661745`.
