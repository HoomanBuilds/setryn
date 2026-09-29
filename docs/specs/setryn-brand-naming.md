# Setryn Brand and Product Naming

Date: 2026-09-21
Status: Locked project naming specification

## Canonical name

The product is **Setryn**, pronounced `SET-rin`.

Setryn is the permanent project and public product name. `Private Dated Risk Exchange` remains the category description, not a proper name. Do not introduce a replacement codename in contracts, packages, interfaces, deployments, documentation, or hackathon materials without an explicit naming decision.

The name is derived from the product's two foundational concepts: settlement and tenor. It is intentionally not tied to one asset class, derivative type, privacy mechanism, blockchain, or customer segment.

## Primary positioning

**Setryn is the private dated-risk exchange on Arbitrum.**

Setryn lets people, businesses, treasuries, protocols, traders, and market makers lock or shape a future price, rate, index, or exchange-rate outcome through native fixed-expiry markets, private price discovery, portfolio clearing, and verifiable settlement.

Primary tagline:

> Risk has a date. Trade it.

## Product architecture

- `Setryn` is the public brand and complete application.
- `Setryn Protocol` is the onchain instrument, collateral, clearing, fixing, and settlement layer.
- `Setryn Protect` is the goal-first exposure and outcome workflow.
- `Setryn Trade` is the professional market and strategy workspace.
- `Setryn Markets` is acceptable when referring collectively to standardized books, RFQs, and auctions.
- `Setryn Clear` is the fixing, settlement, reconciliation, and receipt surface.
- `Setryn Labs` is reserved as a possible company or development-organization name and should not replace the product name in user-facing copy.

These labels organize one product. They must not be presented as disconnected applications or independent protocols.

## Writing rules

1. Write `Setryn`, never `SETRYN`, except in a deliberate wordmark.
2. Use `Setryn` alone in the primary logo and application header.
3. Do not append `Finance`, `Exchange`, `DEX`, `AI`, `Arbitrum`, or `Protocol` to the primary brand.
4. Use `Setryn Protocol` only when distinguishing protocol contracts and interfaces from the first-party application.
5. Describe the category as `private dated-risk exchange`, `fixed-expiry multi-asset exchange`, or `dated-risk protocol` according to context.
6. Do not call Setryn a perpetual DEX, hedge application, RFQ service, router, or package-order service. Each describes only a narrow capability or the wrong product.
7. Product actions should name the economic outcome, such as `Lock EUR/USD for 30 Sep`, rather than use vague labels such as `Use Setryn`.

## Repository naming

Use `setryn` as the lowercase package, directory, deployment, database, and service prefix. Examples:

- `@setryn/protocol-sdk`
- `@setryn/market-data`
- `setryn-web`
- `setryn-indexer`
- `setryn-sepolia`

Smart contract names should describe protocol responsibility rather than repeat the brand on every type. Prefer names such as `InstrumentRegistry`, `ClearingHouse`, `MarginVault`, and `SettlementEngine`. Deployment manifests, package namespaces, and explorer labels provide the Setryn context.

## Clearance status

The name is locked for this repository and product program. Preliminary web research found no meaningful crypto, exchange, or fintech collision. This is not legal trademark clearance and does not prove domain, social-handle, package-registry, or company-name availability. Complete formal clearance before public incorporation, token issuance, or a paid brand launch.
