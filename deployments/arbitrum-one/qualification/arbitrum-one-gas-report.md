# Arbitrum One Unsigned Deployment Gas Report (Planning Only)

This is a production planning artifact, not a claim that deployment was executed. No transaction was sent,
signed, broadcast, funded, or unlocked on Arbitrum One. Mainnet access was read-only. Dependent operations were
estimated with `eth_estimateGas` in canonical order on loopback Anvil forks of the pinned and latest blocks,
which are the only processes that received writes. Local forks meter only L2 execution, so each operation's Arbitrum
L1 data-posting gas was read with a read-only `eth_call` to NodeInterface `gasEstimateL1Component` at both
blocks and added to that block's estimate.

## Scope

- Complete DeploySetryn production graph from `contracts/script/PlanArbitrumOneDeployment.s.sol`.
- 53 contract creations, 24 linked-library creations, and 142 configuration calls (219 operations).
- Pinned block 509990000 (`0xd5edd6e1c8caac1a8bba0aadc5f3d52aecc6cf360dbeded39e898ce101433e72`); latest block 510072374 (`0xd4e3a5c4dcfe0e72f04224cb4d9c49e12cd8d476c382c26f33532fe444fdf5e0`).
- Estimation mode: `sequential-local-fork-plus-l1-component`. Each operation uses the larger of its pinned and latest estimates.
- Planning sender `0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef` is keyless and not an approved deployer. Principals are A4B1 planning placeholders.

## Budget

| Item | Value |
| --- | --- |
| Total gas limit | 274113018 |
| L1 data-posting gas at the pinned block | 7183189 |
| L1 data-posting gas at the latest block | 64060366 |
| Base fee | 0.0201 gwei |
| Max priority fee | 0.0000 gwei |
| Max fee per gas (2 x base + priority) | 0.0401 gwei |
| Aggregate maximum network cost | 0.01100508 ETH |
| Deployer requirement with 2x reserve | 0.02201017 ETH |

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
| 0 | AtomicClearingFundingLib | LIBRARY | `0x35980c104ea3153cf16e91868640e206bf5716d1` | 4036493 | 5014627 | 123821 / 1101955 | 5014627 |
| 1 | SeriesValidationLib | LIBRARY | `0xa18ce6fd8311cb4f5b53a31050e213c097bfe26d` | 3220832 | 3978417 | 95354 / 852939 | 3978417 |
| 2 | SeriesLifecycleLib | LIBRARY | `0x04c25cffed6dfe1417d67a010716ff565add7c70` | 3756819 | 4745242 | 124409 / 1112832 | 4745242 |
| 3 | PrivateRfqQuoteLib | LIBRARY | `0xd19e34333cc88293d0527f6679e2fae0252b60b2` | 4207604 | 5332045 | 141640 / 1266081 | 5332045 |
| 4 | PrivateRfqLifecycleLib | LIBRARY | `0x15f70c086c109721b1caa2fab20dcbd7255c9e77` | 2358619 | 2988347 | 79377 / 709105 | 2988347 |
| 5 | PrivateRfqHandoffLib | LIBRARY | `0xbb43179a5cb0f2449498f297eb0477d3cf9da695` | 3990731 | 5005178 | 127871 / 1142318 | 5005178 |
| 6 | PositionViewLib | LIBRARY | `0xf0bfcc5a244573968ba58a49768ac1be6825725c` | 1391000 | 1770488 | 47840 / 427328 | 1770488 |
| 7 | PositionTerminalLib | LIBRARY | `0x4e789a19dbe129b8b24b419cf65072074e1793c5` | 1839148 | 2342582 | 63465 / 566899 | 2342582 |
| 8 | PositionCreationLib | LIBRARY | `0xa3dbd2e52a3630a9ad594d0b690085e534fcf987` | 2764858 | 3455292 | 86902 / 777336 | 3455292 |
| 9 | PortfolioRiskExposureLib | LIBRARY | `0x1c0d21b5cb478c6252879a0b2a42b2aebcdd5ceb` | 4397591 | 5501433 | 138936 / 1242778 | 5501433 |
| 10 | PortfolioRiskAdmissionLib | LIBRARY | `0x5fc7212f9cd0333f22433b85a2e8ab2dcade734e` | 4538187 | 5541871 | 126329 / 1130013 | 5541871 |
| 11 | OperationalExternalActionLib | LIBRARY | `0x085484dc66fc7d4fb329cd67fee52b558019f844` | 2846240 | 3498061 | 82421 / 734242 | 3498061 |
| 12 | LifecycleSuccessorLib | LIBRARY | `0x93682d8747cdeea75b88b266e8bfac73535e82a7` | 2454983 | 3037601 | 74216 / 656834 | 3037601 |
| 13 | LifecycleBackingLib | LIBRARY | `0x112705440c443ef44404cf6de13d68e7a1ad1669` | 2340172 | 2923615 | 74321 / 657764 | 2923615 |
| 14 | LifecycleActionLib | LIBRARY | `0xbebb62986ccca27375b3b401d41f40867c1412d6` | 4194218 | 5186688 | 124918 / 1117388 | 5186688 |
| 15 | DefaultResolutionLib | LIBRARY | `0x148fbb00534b4fb64f154748239cda3558e604e1` | 3528335 | 4452099 | 116270 / 1040034 | 4452099 |
| 16 | DefaultOpeningLib | LIBRARY | `0xf2b839e75d4639288695f09edf3d79443d9977b4` | 2190219 | 2756708 | 71382 / 637871 | 2756708 |
| 17 | DefaultAuctionLib | LIBRARY | `0x1a4a6f7af527e2b8e978abffede9f984e7df1f91` | 1679173 | 2149962 | 59650 / 530439 | 2149962 |
| 18 | CollateralReservationLib | LIBRARY | `0x8983fb7701de78b5ba36feb694e17f64ad46368f` | 2828636 | 3586584 | 96034 / 853982 | 3586584 |
| 19 | CashSettlementRecordLib | LIBRARY | `0xf6442343e32e02ed043b1e4c0a6b042365c35f29` | 3122077 | 3883835 | 96830 / 858588 | 3883835 |
| 20 | CashSettlementContextLib | LIBRARY | `0xd86cc8d797d2c21ce03a827ae037dce4e52216f2` | 4219220 | 5194133 | 123925 / 1098838 | 5194133 |
| 21 | AtomicClearingMatchLib | LIBRARY | `0x2dcbe5e16bd257079ce9593961c0fd89dc8b8159` | 4425822 | 5482334 | 132979 / 1189491 | 5482334 |
| 22 | AtomicClearingSeriesLib | LIBRARY | `0xb37288bb284e37f8b230051738a015bbb460655a` | 3176038 | 3935389 | 95576 / 854927 | 3935389 |
| 23 | AtomicClearingPackageLib | LIBRARY | `0x3332c459a5e413efd247f3ed3ef2302ddc946ca5` | 3937658 | 4881397 | 119079 / 1062818 | 4881397 |
| 24 | AssetRegistry | CREATE | `0xf9f758886b0a5147bbdc143cfd3c31ac5802cce4` | 1428918 | 1815318 | 48755 / 435155 | 1815318 |
| 25 | AdapterRegistry | CREATE | `0x813d1edab81bbfd1d1c1dfd09d13a95128e98d79` | 1801049 | 2296100 | 62576 / 557627 | 2296100 |
| 26 | CalendarRegistry | CREATE | `0x8bdbe7799301aa9a9472fc5f56cce3d8dd14ff64` | 1966106 | 2492776 | 66939 / 593609 | 2492776 |
| 27 | SessionRegistry | CREATE | `0x286d515c427c9a86f40141b7c9744029c0f8d80d` | 2517153 | 3183099 | 84641 / 750587 | 3183099 |
| 28 | SettlementAssetRegistry | CREATE | `0x7be828edd5e393af07e01661930f7c3fb5f42fcc` | 1979995 | 2522002 | 68220 / 610227 | 2522002 |
| 29 | BenchmarkRegistry | CREATE | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 3190384 | 4020002 | 104420 / 934038 | 4020002 |
| 30 | FeeScheduleRegistry | CREATE | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 2066461 | 2618267 | 69539 / 621345 | 2618267 |
| 31 | RiskDomainRegistry | CREATE | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 2595656 | 3262118 | 84811 / 751273 | 3262118 |
| 32 | InstrumentRegistry | CREATE | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 2345914 | 2977474 | 80370 / 711930 | 2977474 |
| 33 | CollateralVault | CREATE | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 4672858 | 5867369 | 152026 / 1346537 | 5867369 |
| 34 | MarketRegistry | CREATE | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 4214570 | 5219595 | 127910 / 1132935 | 5219595 |
| 35 | SeriesRegistry | CREATE | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 3512794 | 4471640 | 120686 / 1079532 | 4471640 |
| 36 | PackageRegistry | CREATE | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 5170174 | 6419951 | 157304 / 1407081 | 6419951 |
| 37 | CanonicalStrategyCompiler | CREATE | `0xe6cb92adb3eb658de8c1ab6ba95e51aa7a71385d` | 1178979 | 1499971 | 40406 / 361398 | 1499971 |
| 38 | PositionEngine | CREATE | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 4123538 | 5158141 | 130236 / 1164839 | 5158141 |
| 39 | FixingEngine | CREATE | `0xe866c689c6acd564376c7f5356180caffc9d2b45` | 5330945 | 6745574 | 178194 / 1592823 | 6745574 |
| 40 | FundedFeeEngine | CREATE | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 5407733 | 6829579 | 179305 / 1601151 | 6829579 |
| 41 | PortfolioRiskEngine | CREATE | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 2871150 | 3637756 | 96674 / 863280 | 3637756 |
| 42 | ExecutionPolicyRegistry | CREATE | `0x0d8497d289933452eb9c746ccde5b8e88a474b1d` | 1096726 | 1397563 | 37937 / 338774 | 1397563 |
| 43 | TradingSessionPolicy | CREATE | `0x61ea3c5138b4fb499e98130994970d66396a8c5c` | 731803 | 971460 | 30164 / 269821 | 971460 |
| 44 | PackageWitnessRegistry | CREATE | `0x1e8e8316a5a4e2b54ccddf73fc751175f492bf59` | 484450 | 642112 | 19844 / 177506 | 642112 |
| 45 | RiskAdmissionBindingRegistry | CREATE | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 1177085 | 1517062 | 42941 / 382918 | 1517062 |
| 46 | OrderValidationGate | CREATE | `0x196e4b3b1b4a70235c2c54d1d2a1abf4df4c202a` | 1986353 | 2499996 | 64875 / 578518 | 2499996 |
| 47 | OrderState | CREATE | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 3101758 | 3940280 | 106040 / 944562 | 3940280 |
| 48 | RiskAdmissionBindingRegistry.bindOrderVerifyingContract | CALL | `0x5fb7187b08adae83330d4ce9dc699ae476f4ec00` | 49989 | 68328 | 2325 / 20664 | 68328 |
| 49 | ClearingAdmissionGate | CREATE | `0xa59979a74abfe5d403f1eb026e5259771f8dfc09` | 2699021 | 3368952 | 84929 / 754860 | 3368952 |
| 50 | AtomicClearingEngine | CREATE | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 3670440 | 4643918 | 122527 / 1096005 | 4643918 |
| 51 | PrivateRfqValidationGate | CREATE | `0x273a3818833024c7baec38914d3b534e4a1a0242` | 2719209 | 3394177 | 84955 / 759923 | 3394177 |
| 52 | PrivateRfqBook | CREATE | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 5072407 | 6307643 | 155684 / 1390920 | 6307643 |
| 53 | AtomicClearingEngine.activateClearingChannel | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 79123 | 104306 | 3173 / 28356 | 104306 |
| 54 | PublicBookEligibilityGate | CREATE | `0x2395d2f71287f2e2d183d970d1cf62da4db62d44` | 1943333 | 2458779 | 64993 / 580439 | 2458779 |
| 55 | PublicOrderBook | CREATE | `0x89215bce82daa3028a18140160cdda91a2037da5` | 5591587 | 7027474 | 181055 / 1616942 | 7027474 |
| 56 | PositionLifecycleExecutor | CREATE | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 2524754 | 3141418 | 77783 / 694447 | 3141418 |
| 57 | AccountPolicyAuthority | CREATE | `0xe60c87bd57bf28f97165169c81cd0e6e32dd3c9e` | 698380 | 908453 | 26441 / 236514 | 908453 |
| 58 | LifecyclePolicyValidator | CREATE | `0x4c69832e969a811f4874585e8493979f7858a332` | 2096387 | 2605388 | 64065 / 573066 | 2605388 |
| 59 | SignedLifecycleEngine | CREATE | `0x41341a667339f0733e7728a57555adc9d2f68c78` | 5558527 | 7045393 | 187377 / 1674243 | 7045393 |
| 60 | CompressionCoordinator | CREATE | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 3897188 | 4935497 | 130849 / 1169158 | 4935497 |
| 61 | DefaultBidderGate | CREATE | `0x3ef7412d131ad28f89e202166b354b803892678d` | 648518 | 848971 | 25278 / 225731 | 848971 |
| 62 | DefaultProcessEngine | CREATE | `0xe757f9c22ceb8c21e3aeb70080282ac56b7b0877` | 2711359 | 3421192 | 89515 / 799348 | 3421192 |
| 63 | CashSettlementCoordinator | CREATE | `0xac2fc7a45967aadf2f2537debc0cee6e7c4656bf` | 3623000 | 4495977 | 110286 / 983263 | 4495977 |
| 64 | PrivacyCommitmentRegistry | CREATE | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 3090520 | 3926888 | 105270 / 941638 | 3926888 |
| 65 | OperationalAdapterExecutor | CREATE | `0x017d2546392ed6d9878d2cf65d439a6e464866da` | 3575322 | 4310902 | 92584 / 828164 | 4310902 |
| 66 | CappedForwardPayoffModule | CREATE | `0x0c225ab391cc170881fed35076d86be61a439820` | 1410004 | 1788180 | 47722 / 425898 | 1788180 |
| 67 | NdfPayoffModule | CREATE | `0x5ef3c1d61abc99e6f7f4eb06ad955d05e8aa1465` | 1410016 | 1788192 | 47722 / 425898 | 1788192 |
| 68 | EuropeanCallPayoffModule | CREATE | `0x0380d5d27dbb67d41ed9fd5d648d72755cf2d002` | 1410003 | 1786764 | 47709 / 424470 | 1786764 |
| 69 | EuropeanPutPayoffModule | CREATE | `0xbf5769add85ce00a96ff6961f7c3435715aae6b6` | 1409964 | 1782111 | 47670 / 419817 | 1782111 |
| 70 | CollarPayoffModule | CREATE | `0x93dbc0846c10f0a3aa1b66a74acfbe96bb9f09bc` | 1410055 | 1782915 | 47761 / 420621 | 1782915 |
| 71 | RateForwardPayoffModule | CREATE | `0x53803b5aff10137dc3109de12ef033238aaeb965` | 1409990 | 1788940 | 47696 / 426646 | 1788940 |
| 72 | RateCapPayoffModule | CREATE | `0x503080ea2f8347c65cab0d9b100352cf34a0854f` | 1410016 | 1789172 | 47722 / 426878 | 1789172 |
| 73 | RateFloorPayoffModule | CREATE | `0x1fe69dd0db31e9bae6547f88fc507b1fec962ee1` | 1410042 | 1786898 | 47748 / 424604 | 1786898 |
| 74 | RateCollarPayoffModule | CREATE | `0x30badd25ad761c0a2ed0caf24c63ecad0b7a479d` | 1410016 | 1786668 | 47722 / 424374 | 1786668 |
| 75 | BasisSpreadPayoffModule | CREATE | `0xa38d850ab5735d0abb4fa1da97c26d0507e004db` | 1409978 | 1784853 | 47684 / 422559 | 1784853 |
| 76 | CalendarSpreadPayoffModule | CREATE | `0x9b4f77d6e01d09a07c3c9d25e88a6157f397670b` | 1410069 | 1785662 | 47775 / 423368 | 1785662 |
| 77 | WindowAverageScalarPayoffModule | CREATE | `0x9ed9addd96ed146493b2d00f23b727f922495b0b` | 1409966 | 1783400 | 47696 / 421130 | 1783400 |
| 78 | CorrelationDispersionScalarPayoffModule | CREATE | `0xc5d5b0fdb7a514f50991c8edff0cdd39dbea8176` | 1410029 | 1783766 | 47735 / 421472 | 1783766 |
| 79 | AssetRegistry.grantRole | CALL | `0xf9f758886b0a5147bbdc143cfd3c31ac5802cce4` | 53856 | 75752 | 2755 / 24651 | 75752 |
| 80 | AssetRegistry.grantRole#2 | CALL | `0xf9f758886b0a5147bbdc143cfd3c31ac5802cce4` | 53856 | 75752 | 2755 / 24651 | 75752 |
| 81 | AdapterRegistry.grantRole | CALL | `0x813d1edab81bbfd1d1c1dfd09d13a95128e98d79` | 53878 | 75747 | 2755 / 24624 | 75747 |
| 82 | AdapterRegistry.grantRole#2 | CALL | `0x813d1edab81bbfd1d1c1dfd09d13a95128e98d79` | 53878 | 75698 | 2755 / 24575 | 75698 |
| 83 | CalendarRegistry.grantRole | CALL | `0x8bdbe7799301aa9a9472fc5f56cce3d8dd14ff64` | 53834 | 75654 | 2755 / 24575 | 75654 |
| 84 | CalendarRegistry.grantRole#2 | CALL | `0x8bdbe7799301aa9a9472fc5f56cce3d8dd14ff64` | 53834 | 75730 | 2755 / 24651 | 75730 |
| 85 | SessionRegistry.grantRole | CALL | `0x286d515c427c9a86f40141b7c9744029c0f8d80d` | 53856 | 75752 | 2755 / 24651 | 75752 |
| 86 | SessionRegistry.grantRole#2 | CALL | `0x286d515c427c9a86f40141b7c9744029c0f8d80d` | 53856 | 75651 | 2755 / 24550 | 75651 |
| 87 | SettlementAssetRegistry.grantRole | CALL | `0x7be828edd5e393af07e01661930f7c3fb5f42fcc` | 53922 | 75717 | 2755 / 24550 | 75717 |
| 88 | SettlementAssetRegistry.grantRole#2 | CALL | `0x7be828edd5e393af07e01661930f7c3fb5f42fcc` | 53922 | 75569 | 2755 / 24402 | 75569 |
| 89 | BenchmarkRegistry.grantRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53878 | 75525 | 2755 / 24402 | 75525 |
| 90 | BenchmarkRegistry.grantRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 53878 | 75474 | 2755 / 24351 | 75474 |
| 91 | FeeScheduleRegistry.grantRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53856 | 75752 | 2755 / 24651 | 75752 |
| 92 | FeeScheduleRegistry.grantRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 53856 | 75752 | 2755 / 24651 | 75752 |
| 93 | RiskDomainRegistry.grantRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53866 | 75720 | 2755 / 24609 | 75720 |
| 94 | RiskDomainRegistry.grantRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 53878 | 75732 | 2755 / 24609 | 75732 |
| 95 | InstrumentRegistry.grantRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53900 | 75695 | 2755 / 24550 | 75695 |
| 96 | InstrumentRegistry.grantRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 53900 | 75336 | 2755 / 24191 | 75336 |
| 97 | MarketRegistry.grantRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53856 | 75292 | 2755 / 24191 | 75292 |
| 98 | MarketRegistry.grantRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 53856 | 75752 | 2755 / 24651 | 75752 |
| 99 | SeriesRegistry.grantRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53918 | 75814 | 2755 / 24651 | 75814 |
| 100 | SeriesRegistry.grantRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 53918 | 75814 | 2755 / 24651 | 75814 |
| 101 | PackageRegistry.grantRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53856 | 75752 | 2755 / 24651 | 75752 |
| 102 | PackageRegistry.grantRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 53856 | 75747 | 2755 / 24646 | 75747 |
| 103 | AssetRegistry.revokeRole | CALL | `0xf9f758886b0a5147bbdc143cfd3c31ac5802cce4` | 37383 | 59159 | 2755 / 24531 | 59159 |
| 104 | AssetRegistry.revokeRole#2 | CALL | `0xf9f758886b0a5147bbdc143cfd3c31ac5802cce4` | 37383 | 59159 | 2755 / 24531 | 59159 |
| 105 | AdapterRegistry.revokeRole | CALL | `0x813d1edab81bbfd1d1c1dfd09d13a95128e98d79` | 37471 | 59367 | 2755 / 24651 | 59367 |
| 106 | AdapterRegistry.revokeRole#2 | CALL | `0x813d1edab81bbfd1d1c1dfd09d13a95128e98d79` | 37471 | 59367 | 2755 / 24651 | 59367 |
| 107 | CalendarRegistry.revokeRole | CALL | `0x8bdbe7799301aa9a9472fc5f56cce3d8dd14ff64` | 37493 | 59296 | 2755 / 24558 | 59296 |
| 108 | CalendarRegistry.revokeRole#2 | CALL | `0x8bdbe7799301aa9a9472fc5f56cce3d8dd14ff64` | 37493 | 59296 | 2755 / 24558 | 59296 |
| 109 | SessionRegistry.revokeRole | CALL | `0x286d515c427c9a86f40141b7c9744029c0f8d80d` | 37603 | 59393 | 2755 / 24545 | 59393 |
| 110 | SessionRegistry.revokeRole#2 | CALL | `0x286d515c427c9a86f40141b7c9744029c0f8d80d` | 37603 | 59393 | 2755 / 24545 | 59393 |
| 111 | SettlementAssetRegistry.revokeRole | CALL | `0x7be828edd5e393af07e01661930f7c3fb5f42fcc` | 37493 | 59198 | 2755 / 24460 | 59198 |
| 112 | SettlementAssetRegistry.revokeRole#2 | CALL | `0x7be828edd5e393af07e01661930f7c3fb5f42fcc` | 37493 | 59198 | 2755 / 24460 | 59198 |
| 113 | BenchmarkRegistry.revokeRole | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37603 | 59499 | 2755 / 24651 | 59499 |
| 114 | BenchmarkRegistry.revokeRole#2 | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 37603 | 59403 | 2755 / 24555 | 59403 |
| 115 | FeeScheduleRegistry.revokeRole | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37493 | 59293 | 2755 / 24555 | 59293 |
| 116 | FeeScheduleRegistry.revokeRole#2 | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 37493 | 59279 | 2755 / 24541 | 59279 |
| 117 | RiskDomainRegistry.revokeRole | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37437 | 59223 | 2755 / 24541 | 59223 |
| 118 | RiskDomainRegistry.revokeRole#2 | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 37449 | 59191 | 2755 / 24497 | 59191 |
| 119 | InstrumentRegistry.revokeRole | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37493 | 59235 | 2755 / 24497 | 59235 |
| 120 | InstrumentRegistry.revokeRole#2 | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 37493 | 59389 | 2755 / 24651 | 59389 |
| 121 | MarketRegistry.revokeRole | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37581 | 59477 | 2755 / 24651 | 59477 |
| 122 | MarketRegistry.revokeRole#2 | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 37581 | 59460 | 2755 / 24634 | 59460 |
| 123 | SeriesRegistry.revokeRole | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37577 | 59456 | 2755 / 24634 | 59456 |
| 124 | SeriesRegistry.revokeRole#2 | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 37577 | 59456 | 2755 / 24634 | 59456 |
| 125 | PackageRegistry.revokeRole | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37515 | 59374 | 2755 / 24614 | 59374 |
| 126 | PackageRegistry.revokeRole#2 | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 37515 | 59362 | 2755 / 24602 | 59362 |
| 127 | ExecutionPolicyRegistry.grantRole | CALL | `0x0d8497d289933452eb9c746ccde5b8e88a474b1d` | 53834 | 75681 | 2755 / 24602 | 75681 |
| 128 | OrderState.grantRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 54078 | 75925 | 2755 / 24602 | 75925 |
| 129 | AtomicClearingEngine.grantRole | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 54153 | 76049 | 2755 / 24651 | 76049 |
| 130 | AtomicClearingEngine.grantRole#2 | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 53949 | 75845 | 2755 / 24651 | 75845 |
| 131 | PositionEngine.grantRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54207 | 76096 | 2755 / 24644 | 76096 |
| 132 | CollateralVault.grantRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54298 | 76187 | 2755 / 24644 | 76187 |
| 133 | CollateralVault.grantRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54298 | 76101 | 2755 / 24558 | 76101 |
| 134 | FundedFeeEngine.grantRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 54126 | 75929 | 2755 / 24558 | 75929 |
| 135 | PortfolioRiskEngine.grantRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 54075 | 75971 | 2755 / 24651 | 75971 |
| 136 | PortfolioRiskEngine.grantRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 53871 | 75752 | 2755 / 24636 | 75752 |
| 137 | PortfolioRiskEngine.grantRole#3 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 54063 | 75944 | 2755 / 24636 | 75944 |
| 138 | PublicOrderBook.grantRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 53488 | 75332 | 2755 / 24599 | 75332 |
| 139 | PublicOrderBook.grantRole#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 53872 | 75716 | 2755 / 24599 | 75716 |
| 140 | PublicOrderBook.revokeRole | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 37369 | 59199 | 2755 / 24585 | 59199 |
| 141 | PublicOrderBook.revokeRole#2 | CALL | `0x89215bce82daa3028a18140160cdda91a2037da5` | 34985 | 56815 | 2755 / 24585 | 56815 |
| 142 | PrivateRfqBook.grantRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 53972 | 75868 | 2755 / 24651 | 75868 |
| 143 | PrivateRfqBook.revokeRole | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 37895 | 59791 | 2755 / 24651 | 59791 |
| 144 | CollateralVault.grantRole#3 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54286 | 76177 | 2755 / 24646 | 76177 |
| 145 | CollateralVault.grantRole#4 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54286 | 76152 | 2755 / 24621 | 76152 |
| 146 | CollateralVault.grantRole#5 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54298 | 76164 | 2755 / 24621 | 76164 |
| 147 | CollateralVault.grantRole#6 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54286 | 76152 | 2755 / 24621 | 76152 |
| 148 | CollateralVault.grantRole#7 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54286 | 76152 | 2755 / 24621 | 76152 |
| 149 | CollateralVault.grantRole#8 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54298 | 76152 | 2755 / 24609 | 76152 |
| 150 | CollateralVault.grantRole#9 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54298 | 76152 | 2755 / 24609 | 76152 |
| 151 | PositionEngine.grantRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54219 | 76115 | 2755 / 24651 | 76115 |
| 152 | PositionEngine.grantRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54219 | 76115 | 2755 / 24651 | 76115 |
| 153 | PositionEngine.grantRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 54219 | 76046 | 2755 / 24582 | 76046 |
| 154 | PositionLifecycleExecutor.grantRole | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 54148 | 75653 | 2755 / 24260 | 75653 |
| 155 | PositionLifecycleExecutor.grantRole#2 | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 54148 | 75653 | 2755 / 24260 | 75653 |
| 156 | PositionLifecycleExecutor.grantRole#3 | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 54136 | 75587 | 2755 / 24206 | 75587 |
| 157 | CollateralVault.grantRole#10 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54286 | 75737 | 2755 / 24206 | 75737 |
| 158 | CollateralVault.grantRole#11 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54286 | 76182 | 2755 / 24651 | 76182 |
| 159 | CollateralVault.grantRole#12 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 54094 | 75990 | 2755 / 24651 | 75990 |
| 160 | FundedFeeEngine.grantRole#2 | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 54126 | 76022 | 2755 / 24651 | 76022 |
| 161 | PortfolioRiskEngine.grantRole#4 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 54087 | 75976 | 2755 / 24644 | 75976 |
| 162 | PortfolioRiskEngine.grantRole#5 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 54087 | 75983 | 2755 / 24651 | 75983 |
| 163 | PortfolioRiskEngine.grantRole#6 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 54075 | 75971 | 2755 / 24651 | 75971 |
| 164 | PositionLifecycleExecutor.grantRole#4 | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 53944 | 75801 | 2755 / 24612 | 75801 |
| 165 | SignedLifecycleEngine.grantRole | CALL | `0x41341a667339f0733e7728a57555adc9d2f68c78` | 53883 | 75740 | 2755 / 24612 | 75740 |
| 166 | CompressionCoordinator.grantRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 53856 | 75668 | 2755 / 24567 | 75668 |
| 167 | PrivacyCommitmentRegistry.grantRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 53988 | 75800 | 2755 / 24567 | 75800 |
| 168 | PrivacyCommitmentRegistry.grantRole#2 | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 53988 | 75791 | 2755 / 24558 | 75791 |
| 169 | PrivacyCommitmentRegistry.grantRole#3 | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 53988 | 75884 | 2755 / 24651 | 75884 |
| 170 | CollateralVault.revokeRole | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 38237 | 60133 | 2755 / 24651 | 60133 |
| 171 | CollateralVault.revokeRole#2 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 38237 | 60118 | 2755 / 24636 | 60118 |
| 172 | CollateralVault.revokeRole#3 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 38237 | 60118 | 2755 / 24636 | 60118 |
| 173 | CollateralVault.revokeRole#4 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 38237 | 60118 | 2755 / 24636 | 60118 |
| 174 | CollateralVault.revokeRole#5 | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 38237 | 60094 | 2755 / 24612 | 60094 |
| 175 | PositionEngine.revokeRole | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 37895 | 59308 | 2755 / 24168 | 59308 |
| 176 | PositionEngine.revokeRole#2 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 37907 | 59320 | 2755 / 24168 | 59320 |
| 177 | PositionEngine.revokeRole#3 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 37907 | 59803 | 2755 / 24651 | 59803 |
| 178 | PositionEngine.revokeRole#4 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 37907 | 59803 | 2755 / 24651 | 59803 |
| 179 | PositionEngine.revokeRole#5 | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 37907 | 59786 | 2755 / 24634 | 59786 |
| 180 | FundedFeeEngine.revokeRole | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 37493 | 59325 | 2755 / 24587 | 59325 |
| 181 | PortfolioRiskEngine.revokeRole | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37543 | 59375 | 2755 / 24587 | 59375 |
| 182 | PortfolioRiskEngine.revokeRole#2 | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 37555 | 59348 | 2755 / 24548 | 59348 |
| 183 | PositionLifecycleExecutor.revokeRole | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 37471 | 59264 | 2755 / 24548 | 59264 |
| 184 | PositionLifecycleExecutor.revokeRole#2 | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 37471 | 59367 | 2755 / 24651 | 59367 |
| 185 | PositionLifecycleExecutor.revokeRole#3 | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 37471 | 59367 | 2755 / 24651 | 59367 |
| 186 | PositionLifecycleExecutor.revokeRole#4 | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 37471 | 59360 | 2755 / 24644 | 59360 |
| 187 | SignedLifecycleEngine.revokeRole | CALL | `0x41341a667339f0733e7728a57555adc9d2f68c78` | 37533 | 59422 | 2755 / 24644 | 59422 |
| 188 | CompressionCoordinator.revokeRole | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 37383 | 59252 | 2755 / 24624 | 59252 |
| 189 | PrivacyCommitmentRegistry.revokeRole | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 37559 | 59423 | 2755 / 24619 | 59423 |
| 190 | PrivacyCommitmentRegistry.revokeRole#2 | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 37559 | 59423 | 2755 / 24619 | 59423 |
| 191 | PrivacyCommitmentRegistry.revokeRole#3 | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 37559 | 59455 | 2755 / 24651 | 59455 |
| 192 | ExecutionPolicyRegistry.revokeRole | CALL | `0x0d8497d289933452eb9c746ccde5b8e88a474b1d` | 37383 | 59279 | 2755 / 24651 | 59279 |
| 193 | OrderState.revokeRole | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 37455 | 59351 | 2755 / 24651 | 59351 |
| 194 | AtomicClearingEngine.revokeRole | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 37643 | 59514 | 2755 / 24626 | 59514 |
| 195 | AssetRegistry.beginDefaultAdminTransfer | CALL | `0xf9f758886b0a5147bbdc143cfd3c31ac5802cce4` | 35301 | 53752 | 2325 / 20776 | 53752 |
| 196 | AdapterRegistry.beginDefaultAdminTransfer | CALL | `0x813d1edab81bbfd1d1c1dfd09d13a95128e98d79` | 35323 | 53770 | 2325 / 20772 | 53770 |
| 197 | CalendarRegistry.beginDefaultAdminTransfer | CALL | `0x8bdbe7799301aa9a9472fc5f56cce3d8dd14ff64` | 35213 | 53660 | 2325 / 20772 | 53660 |
| 198 | SessionRegistry.beginDefaultAdminTransfer | CALL | `0x286d515c427c9a86f40141b7c9744029c0f8d80d` | 35301 | 53748 | 2325 / 20772 | 53748 |
| 199 | SettlementAssetRegistry.beginDefaultAdminTransfer | CALL | `0x7be828edd5e393af07e01661930f7c3fb5f42fcc` | 35349 | 53821 | 2325 / 20797 | 53821 |
| 200 | BenchmarkRegistry.beginDefaultAdminTransfer | CALL | `0x32a5ac3102970957854fa8751ce0083b190f73e6` | 35323 | 53791 | 2325 / 20793 | 53791 |
| 201 | FeeScheduleRegistry.beginDefaultAdminTransfer | CALL | `0xabc5ca4834c84a2abede7262a0950b81e44fae36` | 35345 | 53813 | 2325 / 20793 | 53813 |
| 202 | RiskDomainRegistry.beginDefaultAdminTransfer | CALL | `0xbe7dc1f7f0dab7ecbcf7c67df6fc2c9997a3e5d7` | 35323 | 53768 | 2325 / 20770 | 53768 |
| 203 | InstrumentRegistry.beginDefaultAdminTransfer | CALL | `0x24c228fbcb10e2e4a9fab882ffe559dce0134ed4` | 35367 | 53812 | 2325 / 20770 | 53812 |
| 204 | MarketRegistry.beginDefaultAdminTransfer | CALL | `0x4016553769f223f571e729a55f18abdd3ea56ef1` | 35257 | 53621 | 2325 / 20689 | 53621 |
| 205 | SeriesRegistry.beginDefaultAdminTransfer | CALL | `0xac7ee253fa4b17d3bab7a30b5b6657945161b1f4` | 35311 | 53675 | 2325 / 20689 | 53675 |
| 206 | CollateralVault.beginDefaultAdminTransfer | CALL | `0x660fd577dd0d55109c3b42e6af989a1f51bcab7c` | 35645 | 54117 | 2325 / 20797 | 54117 |
| 207 | PackageRegistry.beginDefaultAdminTransfer | CALL | `0x5516fa5809dee1ec2cdaa456836c764777bc0743` | 35301 | 53742 | 2325 / 20766 | 53742 |
| 208 | PositionEngine.beginDefaultAdminTransfer | CALL | `0xf889880c0d935c5ba200e7aefbdca07645f51681` | 35553 | 53994 | 2325 / 20766 | 53994 |
| 209 | FundedFeeEngine.beginDefaultAdminTransfer | CALL | `0x556233b8876896a9ce2d0c9ec3836dd193479768` | 35345 | 53695 | 2325 / 20675 | 53695 |
| 210 | PortfolioRiskEngine.beginDefaultAdminTransfer | CALL | `0x237f9f58551448a9f41c4688b9d1100ccc2f364f` | 35333 | 53683 | 2325 / 20675 | 53683 |
| 211 | PositionLifecycleExecutor.beginDefaultAdminTransfer | CALL | `0xd4be2ed19398b3660749dc9cd4193bccb2cc0ac0` | 35345 | 53689 | 2325 / 20669 | 53689 |
| 212 | SignedLifecycleEngine.beginDefaultAdminTransfer | CALL | `0x41341a667339f0733e7728a57555adc9d2f68c78` | 35333 | 53677 | 2325 / 20669 | 53677 |
| 213 | CompressionCoordinator.beginDefaultAdminTransfer | CALL | `0x428eb3fd3f998da47af7c961bc1032b78e5250ec` | 35235 | 53707 | 2325 / 20797 | 53707 |
| 214 | PrivacyCommitmentRegistry.beginDefaultAdminTransfer | CALL | `0x991ed3b20994d0d51415c968d5c6255343b130e6` | 35345 | 53817 | 2325 / 20797 | 53817 |
| 215 | ExecutionPolicyRegistry.beginDefaultAdminTransfer | CALL | `0x0d8497d289933452eb9c746ccde5b8e88a474b1d` | 35301 | 53737 | 2325 / 20761 | 53737 |
| 216 | OrderState.beginDefaultAdminTransfer | CALL | `0x5238ae51f791c3868c8efa67676fa1217ba47c37` | 35404 | 53840 | 2325 / 20761 | 53840 |
| 217 | AtomicClearingEngine.beginDefaultAdminTransfer | CALL | `0x7ae16c4d7b0a35e3c764d58979f8699ca1348d19` | 35421 | 53816 | 2325 / 20720 | 53816 |
| 218 | PrivateRfqBook.beginDefaultAdminTransfer | CALL | `0x589b707ea8bb540f4dc8b7a5979b388885332223` | 35565 | 53719 | 2325 / 20479 | 53719 |

Bundle hash: `0x948621c6d57ca13285e2400045d470011708f97304d22e24c38c0aefda8384ef`. Source intent hash: `0x477fa2579739b4e4b7c4cb0e6ef0bd66924775e988613aa8c60fdf940cd9e223`.
