# CanonRun: final Arbitrum One product decision

Research date: 2026-09-17

Decision: build CanonRun, a paid executable game economy on Arbitrum One. Ship it as a responsive web PWA. Do not build an Android application first. Do not deploy to a second chain during the Buildathon.

CanonRun is not an NFT marketplace, an AI game generator, a casino, or a generic game engine. The first product is a daily logic-dungeon arcade in which players pay for canonical ranked runs and creators publish immutable executable levels. A Stylus engine verifies each compressed run transcript and the protocol splits the run fee among the current creator, reused module authors, and CanonRun.

This is the only current candidate that survives the full-product test, although it remains a high-risk consumer startup. The product must be fun before its protocol depth matters.

Most hackathon projects are inactive or never become companies. A prize, accelerator selection, grant, raise, deployment, wallet count, or TVL figure is not proof of retention, revenue, security, or product-market fit.

## 1. Similar Projects

- **ChainCraft is the closest Arbitrum collision.** It already lets users generate, publish, and play multiplayer games, mints games as NFTs, and plans creator/referrer rewards. Its February 2026 report disclosed 62 monthly active users, 75 games created, 17 published games, and 734 sessions. It also said execution was only "often deterministic" and that its wager-based Token Duels remained on testnet. CanonRun survives only by making deterministic execution, immutable versions, transcript verification, and per-run module settlement the product itself. It must never pitch "create games with AI." [ChainCraft final report](https://forum.arbitrum.foundation/t/final-report-chaincraft-ai-powered-game-creation/30581)
- **Downstream proves that an open fully onchain game platform is already a serious category.** It is deployed on Redstone and has a large public codebase. CanonRun therefore cannot claim to invent autonomous worlds or composable games. Its narrower object is a paid, independently verifiable run through a bounded creator-authored program. [Downstream repository](https://github.com/playmint/ds)
- **Story Protocol already owns programmable IP ancestry and royalty infrastructure.** A standalone remix registry or universal creator-royalty protocol is not a gap. CanonRun only enforces splits inside its own canonical paid runs. It makes no claim over copies played elsewhere. [Story royalty module](https://docs.story.foundation/concepts/royalty-module)
- **Supersize and Monsters are useful funded patterns, not products to copy.** Both reached the Colosseum accelerator by making the game economy part of the enforced game loop. Supersize is a real-time token buy-in game; Monsters lets tokenized creatures battle over liquidity. CanonRun borrows the principle that the economic action and game action must be the same state machine, while deliberately avoiding tokens, wagering, and liquidity combat. [Supersize](https://colosseum.com/companies/supersize), [Monsters](https://colosseum.com/companies/monsters)
- **Proof of Play validates composable onchain games as a venture thesis.** Its investment case emphasized permissionless extensions, new clients, forked code, and open building blocks. That validates the direction, not CanonRun's demand. [a16z investment note](https://a16zcrypto.com/posts/article/investing-in-proof-of-play)
- The Colosseum corpus contains nearby but unproven submissions: `inception-1` for community-created games, `ogal-and-the-open-ugc-ecosystem` for enforced Unity royalties, `proof-of-gameplay` for score verification, `checkmate` for onchain game logic, and `race:-no-code-onchain-appgame-editor-plug-in` for no-code onchain games. None of these project records showed a prize or accelerator selection in the focused search. They prove the nouns are crowded. They did not expose the same bounded executable-level object plus paid-run revenue loop. [Colosseum project directory](https://colosseum.com/arena/projects/explore)

## 2. Archive Insights

- Paradigm's strongest case for fully onchain games is not asset ownership. It is composable modding plus permissionless open economies. The same research warns about compute limits, exploits, metagame stagnation, and financialization. CanonRun responds by allowing a tiny audited instruction set, not arbitrary code, and by charging for ranked runs without issuing a speculative asset. [The Open Problems of Onchain Games](https://www.paradigm.xyz/2023/08/the-open-problems-of-onchain-games)
- Generic NFT royalties are not reliably enforceable at token-transfer level because assets can be transferred, wrapped, or traded through venues that ignore the royalty. CanonRun must charge for a service the protocol controls: opening and verifying a canonical ranked run. It must not pretend to enforce copyright on copied bytes. [Galaxy Research on NFT royalties](https://www.galaxy.com/insights/research/nft-royalties)
- The portable lesson from funded protocols such as Kimia is architectural, not categorical. Kimia built a perp venue, vault, settlement asset, PT/YT splitter, and yield AMM because the required Solana cash flow did not exist. On Arbitrum, that specific opportunity is occupied by Boros, which is an onchain funding-rate market deployed on Arbitrum. [Kimia overview](https://www.kimia.live/), [Boros developer documentation](https://docs.pendle.finance/boros-dev)
- Funding is not proof of durable demand. MetaDAO's current Kimia record shows $60,000 raised and a failed proposal created on August 19, 2026 to liquidate the treasury and return the IP. This means the liquidation proposal failed, not necessarily that the product failed. It still demonstrates why copying a funded architecture without proving its market is weak research. [MetaDAO Kimia record](https://metadao.fi/companies/kimia)

## 3. Current Landscape

- Arbitrum One has a credible technical reason for this product. Stylus is live on mainnet and lets the verification engine use Rust and WASM alongside Solidity. That is useful for bounded graph traversal, packed move replay, and static validation. [Stylus mainnet announcement](https://blog.arbitrum.io/arbitrum-stylus-mainnet/)
- Arbitrum continues to publish gaming as an ecosystem use case, but the investment climate is hostile. In June 2026, the DAO moved to wind down new consumer and gaming venture activity and return about 143.7 million ARB because the program no longer matched current priorities. CanonRun therefore cannot rely on a vague "Arbitrum wants games" funding story. It must show paid usage and retention. [Arbitrum gaming](https://arbitrum.io/solutions/gaming), [AGV wind-down](https://forum.arbitrum.foundation/t/agv-wind-down-structured-transition-return-of-capital-to-the-dao-treasury/31012)
- Previous Open House winners show that judges reward a coherent mechanism exposed through a complete product. Bengaluru winner Orbital paired difficult math with working liquidity, swaps, APIs, tests, contracts, and a visible interface. CanonRun needs the same coherence: create a level, publish it, pay for a run, verify it, update the leaderboard, and pay the creator. [Official Bengaluru recap](https://blog.arbitrum.foundation/arbitrum-open-house-india-concludes-with-bengaluru-hacker-house-full-recap/)
- Arbitrum already has native USDC, so paid runs and creator payouts can use an understandable unit without a protocol token. [Native USDC on Arbitrum](https://blog.arbitrum.io/usdc-to-come-natively-to-arbitrum-2/)
- The build should be a web PWA. Players need instant browser access, while creators need a desktop-friendly editor. A native Android build would divide the team and would not improve the core economic proof.

## 4. Key Insights

- The new canonical economic object is an **executable level version**, not a collectible. It has immutable bytecode, declared bounds, a validation result, a lineage graph, a usage history, and a revenue balance.
- The complete player outcome is: discover a daily run -> start with one session approval -> play locally -> submit one packed transcript -> receive a verified result and rank.
- The complete creator outcome is: compose bounded modules -> publish an immutable version -> receive paid usage -> inspect completion and replay data -> improve or fork a version.
- The chain is useful only where independent actors need shared enforcement: version identity, deterministic result verification, challenge/refund state, canonical ranking, and fee splits. Rendering, input latency, previews, and ordinary analytics stay offchain.
- There is no protocol token. Players pay in native USDC. Creators earn native USDC. A token would hide whether anybody pays for the product.
- Royalties are enforceable only on canonical runs. A person can copy public level bytes and run them elsewhere. The paid object is the verified season, leaderboard, creator community, and accumulated reputation, not access to public code.
- The hard startup problem is fun and distribution, not smart contracts. Technical depth gets a judge's attention; repeat paid play earns Founder House and a company.

## 5. Opportunities and Gaps

- **Killed: retail FX income protection.** Premia already provides permissionless fully collateralized options on Arbitrum One, while Ostium and gTrade already own FX exposure and liquidity. Exact local-currency protection needs local-currency collateral, and retail FX rules become part of the business. That is a regulated distribution app over an existing primitive. [Premia concepts](https://docs.premia.blue/the-premia-protocol/concepts), [Ostium overview](https://ostium-labs.gitbook.io/ostium-docs/getting-started/overview-technical)
- **Killed: borrower rescue auction.** DeFi Saver already protects and closes Aave positions on Arbitrum, including existing EOA positions, and Morpho has an audited pre-liquidation primitive. Competitive quote selection would be an incumbent feature, not a new protocol. [DeFi Saver Aave automation](https://help.defisaver.com/protocols/aave/compatibility-and-automations), [Morpho PreLiquidation](https://github.com/morpho-org/pre-liquidation)
- **Killed: a Kimia port.** Boros already trades funding rates on Arbitrum with an onchain interest-rate market. [Boros](https://docs.pendle.finance/boros-dev)
- **Killed: generic UGC game platform.** ChainCraft and Downstream already occupy it.
- **Killed: recursive royalty registry.** Story already occupies it, and royalties cannot be universally enforced on public code.
- **Surviving gap: canonical executable sessions.** Existing Arbitrum game creation products do not currently demonstrate a mainnet protocol where bounded creator-authored logic is itself verified onchain and every paid canonical run automatically routes usage revenue through that logic's version lineage.

The surviving gap is narrow. That is a strength. If the pitch grows into "Roblox onchain," "AI builds any game," "NFT ownership," or "play to earn," the differentiation disappears.

## 6. Deep Dive: Top Opportunity

### Market Landscape

CanonRun sits between three existing categories:

- UGC platforms provide creation and discovery but usually execute on controlled servers.
- Fully onchain games provide open state but are usually one first-party world.
- creator protocols provide attribution and royalty graphs but do not execute the work.

CanonRun joins those layers around a tiny, enforceable object. The first object is not a general game. It is an 8x8 deterministic logic-dungeon program assembled from about 12 audited opcodes such as move, gate, key, switch, hazard, counter, branch, and terminal state.

The long-term protocol can support additional bounded game families, but each family needs its own audited verifier. Arbitrary uploaded WASM is not part of the product roadmap until the company has security maturity.

### Problem

Players face low-trust leaderboards, disposable crypto games, and creator economies based on speculative asset sales. Small game creators face distribution platforms that own the audience, can change revenue rules, and do not pay automatically when their mechanics are reused.

CanonRun's promise is:

> Play a level whose rules and result cannot be changed after the fact. Build a level that earns every time the canonical game uses it.

The protocol state machine is:

`Draft -> Bonded -> StaticVerified -> Active -> RunOpened -> RunResolved | RunExpired -> Rated`

A published version may also enter:

`Active -> Challenged -> Slashed | Restored -> Archived`

The system has six core components:

- `LevelRegistry` stores immutable version hashes, creator identity, declared bounds, and parent module references.
- `StaticVerifier` in Stylus validates the restricted bytecode, maximum state space, legal transitions, and solvability for the published finite seed set.
- `RunEscrow` accepts the USDC run fee, creates a session commitment, and handles expiry or objective refunds.
- `RunEngine` in Stylus replays one packed move transcript and returns the terminal state, move count, and score.
- `LineageRouter` distributes the fee to the current author, capped ancestor authors, the season pool, and CanonRun.
- `SeasonRegistry` maintains canonical daily seeds and verified leaderboards.

No move is sent as its own transaction. The browser runs the game locally and submits one packed transcript at completion. The app uses a session key or one bounded approval so the game does not interrupt play with repeated wallet prompts.

### Revenue Model

The primary business model is a protocol fee on paid canonical runs.

- Initial run price: $0.10 to $0.50 in USDC, with $0.25 as the planning midpoint.
- Protocol take: 12 percent.
- Current level and active module creators: 75 percent.
- Capped ancestor pool: 10 percent across at most four lineage levels.
- Season/community pool: 3 percent.

At 5,000 daily active players, three paid runs per day, and a $0.25 average price, annual gross run volume is about $1.37 million and CanonRun revenue is about $164,000. At 50,000 daily active players under the same behavior, protocol revenue is about $1.64 million. These are scenarios, not forecasts.

Creator tooling subscriptions and sponsored seasons can become later revenue lines, but they are not needed to make the protocol transaction legible. Do not count token emissions, NFT appreciation, or grant money as revenue.

### GTM Friction

The marketplace has a cold-start problem on both sides, so the initial product cannot launch as an empty platform.

- Ship 20 first-party levels and one polished daily dungeon before inviting creators.
- Recruit five external puzzle or level designers, not crypto influencers, and pay a fixed creation bounty only for launch supply.
- Give each new player three sponsored runs, then ask for USDC only after the leaderboard and replay loop are understood.
- Run one daily global seed and one weekly creator spotlight. Concentrated attention is more useful than hundreds of empty games.
- Make every completed run shareable as a replay card with level, seed, moves, rank, and creator payout.
- Let creators fork only through the browser builder and display the exact revenue split before publishing.

The main acquisition wedge is speedrunning and daily logic games, not "Web3 gaming." The chain should be invisible until the player opens the verification or creator revenue panel.

### Founder-Market Fit

The team has already built Orcus, which combines encrypted strategies, protected compute, storage, and settlement, and Moros, which contains multiple Groth16 circuits and a complete private-payment/prediction workflow. That experience maps directly to CanonRun's real hard parts:

- a Rust Stylus verifier and deterministic state machine;
- compact transcript encoding and adversarial boundary handling;
- commitment and session flows;
- creator fee accounting;
- a polished product wrapped around a protocol.

The missing founder skill is game design and retention, not protocol engineering. The first external collaborator should therefore be a level designer, not another Solidity developer.

### Why Crypto/Arbitrum?

CanonRun passes the crypto test because the same transaction integrates independent creators, player payment, deterministic execution, canonical result settlement, lineage accounting, and revenue distribution. A database can run one company's arcade, but it cannot give unknown creators permissionless publication and non-revocable usage settlement without trusting that company.

Arbitrum One is the only launch chain because:

- Stylus provides Rust/WASM execution for computation-heavy replay and finite-state verification.
- Solidity remains available for registry, escrow, USDC, and fee-routing contracts.
- Native USDC makes prices and creator earnings understandable.
- One has shared liquidity and a visible mainnet transaction history. An Orbit chain would add operational work and weaken the Open House proof.

Mainnet is part of the demonstration, not a roadmap slide. Use small real USDC amounts, caps, pausing, and immutable opcode allowlists.

### Risk Assessment

- **Fun risk is fatal.** Kill or radically redesign if fewer than 25 percent of first-time players return the next day after the first 100 real users.
- **Creator risk is fatal.** Kill the platform thesis if five external creators do not publish and at least three do not publish a second version after observing real plays.
- **Payment risk is fatal.** Kill paid runs if fewer than 10 percent of activated users pay after sponsored credits.
- **ChainCraft collision is high.** Stop claiming a new category if users describe CanonRun as "ChainCraft without AI." The demo must make executable verification and automatic module usage revenue obvious within 60 seconds.
- **Content leakage is unavoidable.** Never claim that the protocol prevents copying. Canonical ranking, seasons, creator identity, and accumulated play history must be valuable enough that users choose the official run.
- **Arbitrary-code risk is fatal.** The MVP accepts only audited opcodes. User-uploaded Rust, Solidity, scripts, images, or remote callbacks are out of scope.
- **Gas and wallet friction can destroy the loop.** A completed run gets one transcript transaction, not one transaction per move. Stop if gas plus sponsorship cost is more than 10 percent of the average paid run or if a returning player faces more than one confirmation per session.
- **Financialization can destroy the game.** No protocol token, tradeable level shares, cash prizes, player staking, or wagering at launch.
- **Gaming funding is weak.** The AGV wind-down means technical ecosystem fit alone will not carry the company. Paid retention must be the Founder House evidence.

## Mainnet product scope

The Buildathon product is one complete loop:

- Responsive web PWA with passkey or embedded-wallet onboarding.
- One 8x8 logic-dungeon game family and about 12 fixed opcodes.
- Browser level builder, simulator, and immutable publish flow.
- Stylus static verifier and packed-transcript run verifier.
- Solidity registry, session escrow, fee router, challenge/refund path, and season leaderboard.
- Native USDC paid runs on Arbitrum One.
- Twenty first-party levels, five external creators, and one live daily season.
- Public verification view showing the level hash, engine version, transcript, result, and exact payout split.

Do not build Android, NFTs, a token, arbitrary mods, multiple game genres, multiple chains, wagering, prize pools, AI level generation, or cross-game assets during the Buildathon.

## Founder House evidence target

The product should enter Founder House with evidence, not promises:

- 100 real activated players.
- 1,000 completed canonical runs.
- At least 100 paid runs in real USDC.
- Five external creators and three second-version publications.
- Day-one retention at or above 25 percent.
- A complete public revenue trail from player payment to creator and ancestor payouts.

If the team cannot make the first game fun enough to approach these gates, do not disguise the miss by adding more contracts. The correct response is to change the game loop, not widen the platform.
