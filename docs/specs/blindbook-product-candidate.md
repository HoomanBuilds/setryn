# Blindbook: confidential repo network

Status: rejected as the current build direction. It remains historical product research, not a validated startup or authorization to accept public funds. The final cross-ecosystem comparison found that this is still private secured lending with a privacy layer. The current replacement decision is [Charter Protocol](../research/arbitrum-market-governed-capital-formation-decision-2026-09-16.md).

Research snapshot: September 16, 2026. The historical comparison is in [Arbitrum One product gap decision](../research/arbitrum-kimia-ordr-gap-deep-research-2026-09-16.md). The final decision is the [Colosseum-to-Arbitrum protocol comparison](../research/colosseum-to-arbitrum-protocol-opportunities-2026-09-16.md). Deployment and competitor claims must be rechecked before implementation. This document is product reference material, not runtime configuration or authorization to deploy or move funds.

## Product

Fixed-term repo-style USDC financing for crypto-native market makers and trading treasuries that already use smart-contract collateral and require per-position amount confidentiality plus predictable, non-callable term funding. The intended benefit is competitively priced financing without publishing a reconstructable individual collateral and debt book. Whether those firms value that combination enough to switch is unvalidated.

The surviving positioning is a confidential repo network, not generic private lending or prime brokerage. Qualified counterparties discover and settle fixed-term USDC financing against WETH on Arbitrum One. Loan size, collateral quantity and healthy servicing remain private, while lenders receive cryptographic state assurance, borrower-independent recovery and selective audit access.

Non-callable means no ordinary discretionary lender recall while the borrower complies with the agreement. It does not mean immunity from margin liquidation, maturity, default acceleration or expressly agreed legal termination. The latest primary-research comparison retains this as a credible full-product direction, not a first-ever private-lending claim or an instruction to implement.

Custody-mandated institutions are excluded from the initial customer hypothesis. [Annamite Capital's documented Zodia/Hidden Road workflow](https://zodia-custody.com/case-studies/how-annamite-capital-uses-interchange-to-access-credit-from-hidden-road-with-safety-speed-and-structure/) keeps assets in segregated custody while obtaining credit. Its actual choice supports custody-preserving financing, not willingness to move collateral into our escrow.

Initial collateral: WETH, with WBTC admitted separately only after its asset-specific custody, pricing and recovery risks are assessed. The initial deployment target is Arbitrum One mainnet only. Product interface: professional web application plus API, not a native Android application by default.

## Intended customer journey

1. Pledge eligible collateral and prove its encumbrance within the protocol.
2. Receive binding lender offers specifying rate, term, margin policy, disclosure and recovery conditions.
3. Accept an offer and draw USDC.
4. Maintain collateral coverage, repay, or refinance under explicit terms.
5. Settle maturity, default or liquidation, including lender losses and borrower surplus.

The product would need to own confidential collateral/debt accounting and the financing lifecycle. A private interface routing into an unchanged public Aave position would not meet that requirement.

## Privacy and recovery requirements

- Individual positions are intended to be confidential from the public while healthy, not absolutely confidential from every participant.
- Explicitly designated risk/recovery executors may receive necessary position information. Their authority must be restricted to agreed protocol conditions and asset distribution rules.
- Recovery must not require a new borrower signature, voluntary disclosure, or borrower-generated proof after default.
- A health proof alone does not supply the hidden witness or collateral-seizure authority.
- Default disclosure must be explicit: recovering an unhealthy loan may expose necessary position information without promising perpetual secrecy. Testing must determine whether that disclosure reconstructs unrelated healthy loans.
- Aggregate accounting must reconcile the complete protocol book, not selectively chosen healthy loans. It cannot certify the absence of a firm's external obligations.
- Deposits, withdrawals, timing, liquidations and sparse aggregate changes may reveal information. Practical confidentiality needs independent reconstruction testing.
- Oracle freshness, stopped provers, unavailable executors, missing liquidation liquidity and collateral price gaps need explicit economic outcomes. No guaranteed recovery or continuous solvency claim has been established.

## Native Arbitrum design hypothesis

[Arbitrum's current confidentiality page](https://arbitrum.io/why-arbitrum/features/confidentiality) explicitly distinguishes application-level confidentiality on Arbitrum One from future dedicated-chain privacy. A native proof-enforced pledged-collateral ledger is therefore worth investigating without assuming an unavailable FHE host. This is an architectural hypothesis, not a chosen proof system or verified production implementation.

The product would own pooled WETH/WBTC collateral and USDC liquidity, confidential active loan commitments, and restricted collateral claims. Ordinary loan operations must preserve cash, collateral encumbrance and debt accounting, rather than routing into a public per-borrower position. Funding, repayment and fee allocation need shielded internal accounting where public amounts would expose the healthy loan; a public USDC draw with a new loan identifier would defeat the amount-confidentiality claim even if the borrower's original address were obscured.

At origination the borrower accepts the recovery policy, permitted recipients and designated executors. A later executor transaction must establish the current pledged claim, agreed default or oracle-bound liquidation condition, and permitted lender repayment, executor compensation and borrower surplus. The executor receives no arbitrary withdrawal or destination authority, and requires no new borrower signature. The implementation must show actual assets settling, not merely emit a liquidation flag or cancel a debt record.

Every accepted state update must leave authorized recovery parties with consistent, decryptable current data. Attaching an unverified ciphertext is insufficient. A viewing key supplies information, not spend authority, as [RAILGUN's view-only documentation](https://docs.railgun.org/developer-guide/wallet/private-wallets/view-only-wallets) illustrates. Proof authorization also does not guarantee executor availability or sale liquidity; redundant operators, incentives and explicit outage/loss handling remain necessary.

Public-flow reconstruction is a delivery test, not a claim that all confidentiality is impossible. Sparse aggregate changes, fee transfers, direct withdrawals and disclosed defaults can reveal healthy positions. Aggregate reporting policy must preserve complete accounting while defining which information lenders receive privately and which becomes public.

## Concrete recovery-state direction

The preferred hypothesis is a proof-bound, complete recovery snapshot for every continuing loan state, rather than an unchecked attachment or a keeper replaying an unbounded history of debt deltas. This is new loan-specific engineering, not a completed or audited lending circuit.

The team's inspected payment circuit already constrains encrypted output plaintext and note commitments to the same values. That is relevant capability evidence, not a security endorsement, proof of deployed verifier matching, or evidence that a loan recovery branch exists. Independent mechanism prior art comes from [Mysten's implemented auditor ciphertext flow](https://github.com/MystenLabs/confidential-transfers/blob/main/AUDITORS.md), which proves auditor and transfer amounts agree. Its [repository disclaimer](https://github.com/MystenLabs/confidential-transfers) says work in progress, unaudited and unsuitable for production. It is a research comparison, not an Arbitrum dependency.

The continuing state must satisfy all of these requirements:

1. Ordinary collateral notes are consumed into purpose-restricted pledged state. The same assets cannot back another obligation or remain freely spendable by the borrower.
2. The current loan head binds debt, pledged assets, agreed terms, version, and complete loan-scoped recovery data. Historical Merkle membership alone is insufficient authority to act on an already replaced head.
3. The transition proof binds the encrypted recovery snapshot to that exact state and to the registered executor recipients. The borrower cannot substitute an arbitrary recipient key. The ciphertext itself must remain retrievable from chain data; publishing only its hash is insufficient.
4. Recovery data supplies the current opening and permitted proof witness without granting unrestricted owner-spend authority. The verifier/escrow separately enforces the agreed condition and distribution destinations.
5. Partial repayment and accepted top-ups produce replacement consistent snapshots. Pending deposits cannot count as pledged margin cure until merged into an accepted head. Repayment, refinancing and recovery atomically compete to consume the same current head.
6. Full repayment can consume the current head, satisfy the exact accrued obligation and return collateral privately without a keeper acknowledgement, because it leaves no continuing debt state. Refinancing closes the old obligation and establishes a newly consented one rather than silently rewriting lender rights.
7. Key rotation cannot retire recovery access for outstanding heads before replacement snapshots are verifiably available. Secondary operators can recover from published current state, but cryptographic decryptability does not guarantee their uptime or willingness to execute.

An acknowledgement-first alternative can have designated executors decrypt and recompute each new continuing state before countersigning it. It adds operator censorship/downtime to top-up and partial-repayment availability. [EIP-712](https://eips.ethereum.org/EIPS/eip-712) does not itself prevent replay: acknowledgements must bind the current old/new heads, exact action, terms and envelope hashes, key epoch, chain/contract and expiry, with atomic consumption. A signature over ciphertext alone is insufficient.

Validate borrower authorization when originating the pledge, then persist its condition-bound escrow policy. Do not depend on asking the borrower wallet to validate an old signature again at default: [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) permits state-dependent signature validity. Key changes must not revoke accepted credit obligations.

## Complete first product and acceptance boundaries

The first product owns binding funded lender offers, collateral pledging, confidential USDC draws, servicing, top-up, partial/full repayment, maturity, permitted collateral sale, creditor distribution, borrower surplus and bad-debt accounting. Unaccepted offers can expire or be cancelled; already allocated lender principal cannot exit as freely withdrawable liquidity. An outstanding lender claim can move only through an authorized funded transfer or after the obligation is extinguished.

The web application must expose borrower terms and actual usable proceeds, lender allocated/free capital, and executor recovery operations. The API serves treasury integration, quotes and servicing. A proof playground, public Aave wrapper or private balance that cannot be used as financing is not this product.

External spending remains an explicit delivery boundary: public withdrawals reveal amounts even when internal balances are confidential. The practical promise must survive the intended borrower's real spending/withdrawal pattern, not merely an unused private balance. Pooling, unlinkability and batching require reconstruction tests and do not automatically solve sparse-flow inference.

The decisive demonstration is a borrower stopping all cooperation after multiple private updates, followed by a secondary executor recovering the latest pledged state, selling actual collateral and paying actual USDC to the entitled parties. A competing full repayment must not permit double recovery. Malformed recovery ciphertext, stale heads, destination substitution, duplicate pledges and unavailable primary executors must be exercised.

Authorized recovery is not guaranteed repayment. For example, a hypothetical $12M collateral position securing $7.2M principal has a $1.2M principal shortfall after a 50% collateral-price gap, even before interest, fees and sale slippage. Lenders bear residual losses under disclosed terms unless a separately funded and contractually defined first-loss arrangement exists. A governance token or future fundraising is not that reserve.

## Competition and switching risk

- [Hush](https://github.com/0xdeval/hush) uses Hinkal and per-user Aave vaults to obscure strategy origin. Aave position accounting remains public.
- [Term Finance](https://docs.term.finance/) already provides competitive fixed-term collateralized financing and a complete loan lifecycle.
- [August](https://docs.augustdigital.io/protocol-overview) provides institutional OTC term credit, lender-specific constraints, a universal margin account, risk-engine liquidation and allowlisted Arbitrum DeFi execution. It can be more capital-efficient than isolated WETH escrow. Term commitment alone is not Blindbook's difference; continuing individual-position confidentiality would need its own value and recovery implementation.
- [Secured Finance](https://docs.secured.finance/developer-portal/api-reference/fixed-rate-lending-subgraph) documents fixed-rate, fixed-maturity order books and an Arbitrum One endpoint. Its present activity and endpoint health require rechecking, but public term matching, zero-coupon claims and maturity management are not differentiators by themselves.
- [Gavel](https://www.thegavelprotocol.org/) is an audited Arbitrum One collateralized term-loan auction with transferable positions. Its live interface displayed zero active and zero total loans during the September 16 review. This is a warning that correct term-loan infrastructure does not create demand by itself.
- [Ghost Finance's current repository](https://github.com/snehendu098/ghost) describes sealed-rate peer-to-peer financing, collateral tiers, matching and liquidation workflows. It won second place in Convergence 2026's DeFi track, according to [Chainlink's April 6 recap](https://chain.link/blog/convergence-hackathon-winners). Its documented custody is Sepolia with mock assets, and its privacy table exposes loan amounts to the server. It is close concept prior art, not verified production equivalence to Blindbook's proposed private book.
- [Fairates was featured by Arbitrum in September 2025](https://blog.arbitrum.io/how-fairblock-is-unlocking-confidential-payments-and-auctions-on-arbitrum/). Its current [auction](https://github.com/Fairblock/fairates/blob/main/contracts/AuctionEngine.sol) and [collateral](https://github.com/Fairblock/fairates/blob/main/contracts/CollateralManager.sol) source expose per-address final allocations, repayments and collateral amounts. Confidential auction inputs are already Arbitrum-adjacent prior art, not private ongoing loan-book accounting. Current funded mainnet activity was not independently verified here.
- [Maple and Zodia](https://maple.finance/insights/zodia-custody-opens-interchange-to-maple) announced segregated-custody financing with scoped enforcement rights on September 14, 2026.
- [Obscura Finance](https://github.com/karagozemin/Obscura) demonstrates a confidential deal room on Arbitrum Sepolia. A separate [Obscura Credit](https://github.com/mohamedwael201193/OBSCURA) demonstrates encrypted balances, collateral, debt and liquidation auctions using testnet dependencies. Neither establishes the required mainnet recovery lifecycle, but together they prevent any first-private-lending claim.
- [Noiri](https://github.com/JernKunpittaya/zk-lending), [ShadeX](https://docs.shadeprotocol.io/shade-protocol/advanced-topics-apps/shadex-money-market/liquidations) and [Umbra](https://github.com/dekunlab/umbra-protocol) establish private-lending concept or implementation prior art with different disclosure, execution and deployment limitations.
- [Writz](https://github.com/WritzProtocol/writz) is close private-lending prior art on Stellar testnet/Bitcoin Signet. Its inspected proof path collects repayment USDC, but its [Bitcoin script](https://github.com/WritzProtocol/writz/blob/main/bitcoin-script/src/script.ts) permits cooperative borrower/protocol spending or a borrower timelock escape, not an inspected independent creditor seizure branch. That distinction matters more than a permissionless liquidation-proof entry point.
- [Zama's September 15 release](https://www.zama.org/post/confidential-defi-at-scale) reports 16 confidential Morpho vaults, confidential swaps and more than $40 million of shielded TVL on Ethereum. This is not evidence of private borrower collateral/debt accounting, but it supports meaningful position-confidentiality demand while making generic confidential-lending positioning weak. The reported TVL is not independently verified fee-paying borrower demand.

[GSR's executed confidential OTC trade](https://www.gsr.io/insights/gsr-and-zama-complete-landmark-first-confidential-otc-trade-on-ethereum) establishes real use of confidential settlement. It does not establish demand for confidential borrowing or a privacy premium. Test the value of confidentiality separately from protection against an early lender repayment call; fixed-term funding itself already has competitors.

[ShadeX's liquidation documentation](https://docs.shadeprotocol.io/shade-protocol/advanced-topics-apps/shadex-money-market/liquidations) is a stronger recovery benchmark than private health proofs: private streaming sales restore coverage, with a higher-threshold public position/asset disclosure fallback for broader liquidator access. This relies on Secret Network's encrypted execution and its authority over pledged collateral; those properties are not automatically available on Arbitrum One. Noiri's [checked-in contract](https://github.com/JernKunpittaya/zk-lending/blob/main/contracts/src/zkLend.sol) uses mock assets and liquidation-history updates rather than demonstrating a complete third-party recovery sale. These sources must not be presented as equivalent production systems.

[Zama's June 2026 engineering disclosure](https://www.zama.org/post/private-deposits-into-public-defi-zamas-first-confidential-vault-design) acknowledges that single-user batches, subtraction attacks by other batch participants and immediate unshielded exits can reveal amounts. Adding encryption or batching alone does not establish practical confidentiality.

Arbitrum One production dependency: [Zama's current mainnet registry](https://github.com/zama-ai/protocol-registry/blob/main/mainnet.json) does not establish an Arbitrum One confidential host. An Arbitrum-based dedicated Gateway is not an Arbitrum One application deployment. No particular cryptographic substrate is selected or assumed available for this product.

Fhenix's [current CoFHE status](https://www.fhenix.io/) and [encrypted-lending guide, modified August 25, 2026](https://www.fhenix.io/blog/encrypted-lending-ethereum-fully-homomorphic-encryption-private-defi) still identify Sepolia deployments and mainnet as forthcoming. CoFHE therefore is not a verified Arbitrum One production dependency for this candidate. This does not prove every possible confidentiality architecture is impossible; it leaves an explicit implementation and recovery-availability requirement before selection.

The switching proposition must outweigh new contract risk, thinner initial financing liquidity, custody changes and fees. If firms only need wallet-origin unlinkability, existing products may be sufficient. No first-ever claim is justified.

## Revenue hypothesis

Borrowers pay origination and servicing fees. Lender principal and lender interest are separate from startup revenue.

[Term Finance's servicing-fee documentation](https://docs.term.finance/protocol/fees-and-penalties/servicing-fee) gives a typical annual range of 30-50 basis points, prorated and deducted from proceeds. At that benchmark, $20 million average outstanding debt produces $60,000-$100,000 annual gross revenue; $100 million produces $300,000-$500,000. These are arithmetic scenarios, not our accepted customer pricing or forecasts. Security review, proving, recovery incentives, monitoring, legal and servicing costs remain unsized.

Actual lender USDC, borrower collateral, operating runway and any first-loss reserve must be funded and accounted for separately.

Turnover matters if an additional origination fee is actually accepted. At a hypothetical 25 bps per origination plus 50 bps annual servicing, annual gross take is about 3.54% for 30-day average terms, 1.51% for 90-day terms and 1.01% for 180-day terms. On $20M average debt, those scenarios produce about $708,000, $303,000 and $201,000 respectively.

The shorter-term numbers hide a pricing problem. On a $500,000, 30-day loan at 8% APR, gross lender interest is about $3,288 while Blindbook fees under that model are about $1,455, or roughly 44% of the gross interest economics. At a more defensible 10 bps origination plus 25 bps servicing, $1M annual gross requires about $68.2M average debt for 30-day terms, $152.5M for 90-day terms or $220.9M for 180-day terms. These are sensitivity calculations, not accepted pricing, evidence of a privacy premium or forecasts. Do not count refinanced notional as retained income; only the actually charged fee is revenue.

## Validation gates

These are launch-validation work, not a requirement to perform uncommissioned outreach before making a research recommendation.

1. Identify firms already using contract collateral, with recurring financing requirements and a specific costly disclosure problem beyond wallet attribution. Separate any need for non-callable term funding from the need for privacy.
2. Compare quotes at identical collateral, LTV, term and recovery rights against public or origin-private financing. Obtain at least two conditional borrower commitments to concrete terms and fees, plus an independent lender's conditional allocation under the same recovery policy. Borrower risk teams must explicitly accept the escrow model; compliments or privacy interest do not qualify.
3. Demonstrate secondary-operator recovery of the latest private state after multiple updates, including actual collateral sale and lender payment.
4. Test practical privacy against the intended draw and spending flow, sparse aggregate changes and liquidation reconstruction.
5. Show that the all-in borrower price remains competitive after proving, relay, recovery, legal and servicing costs.
6. Obtain specialist legal review of the credential, lending, operator and distribution structure before accepting public capital.

No customer outreach, paid commitment, mainnet implementation, security audit or product-market validation is claimed by this document.
