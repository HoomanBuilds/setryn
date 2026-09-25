import type { MakerCockpitSnapshot } from "./types";

const simulated = (source: string, ageMs: number) => ({
  observedAt: "2026-09-25T07:11:08.000Z",
  ageMs,
  source,
  origin: "SIMULATED" as const,
});

export const makerCockpitSnapshot: MakerCockpitSnapshot = {
  environment: "ARBITRUM_SEPOLIA",
  snapshot: simulated("Setryn preview-feed/1", 2100),
  session: {
    id: "MM-ARBSEP-042",
    state: "QUOTING",
    quoteCount: 184,
    hitRate: 27.6,
    realizedPnlUsd: 1842.16,
    expectedPnlUsd: 216.42,
  },
  series: [
    {
      id: "btc-yc-24dec26",
      displayName: "BTC Yield Carry",
      template: "Dated cash-and-carry",
      underlying: "BTC",
      settlementAsset: "USDC",
      expiry: "24 Dec 2026",
      quoteConvention: "Annualized net basis",
      quoteCurrency: "USDC",
      quoteUnit: "bp",
      venueScope: "Arbitrum Sepolia",
      status: "QUALIFIED",
    },
    {
      id: "eth-funding-26sep26",
      displayName: "ETH Funding Carry",
      template: "Funding capture",
      underlying: "ETH",
      settlementAsset: "USDC",
      expiry: "26 Sep 2026",
      quoteConvention: "Expected annualized return",
      quoteCurrency: "USDC",
      quoteUnit: "bp",
      venueScope: "Arbitrum Sepolia",
      status: "QUALIFIED",
    },
    {
      id: "arb-basis-27mar27",
      displayName: "ARB Basis",
      template: "Dated cash-and-carry",
      underlying: "ARB",
      settlementAsset: "USDC",
      expiry: "27 Mar 2027",
      quoteConvention: "Annualized net basis",
      quoteCurrency: "USDC",
      quoteUnit: "bp",
      venueScope: "Arbitrum Sepolia",
      status: "CONDITIONAL",
    },
  ],
  quoteLevels: {
    "btc-yc-24dec26": [
      { sizeLabel: "$10k", notionalUsd: 10000, bid: 608.2, ask: 615.1, spreadBps: 6.9, firmCapacityUsd: 10000, indicativeCapacityUsd: 40000, expirySeconds: 19, expectedHedgeCostBps: 1.3, fillProbability: 68, toxicityScore: 18, expectedEdgeBps: 4.8, capacityOrigin: simulated("Maker inventory model", 2100) },
      { sizeLabel: "$25k", notionalUsd: 25000, bid: 606.7, ask: 616.8, spreadBps: 10.1, firmCapacityUsd: 25000, indicativeCapacityUsd: 75000, expirySeconds: 16, expectedHedgeCostBps: 2.1, fillProbability: 51, toxicityScore: 25, expectedEdgeBps: 6.4, capacityOrigin: simulated("Maker inventory model", 2100) },
      { sizeLabel: "$50k", notionalUsd: 50000, bid: 603.5, ask: 620.4, spreadBps: 16.9, firmCapacityUsd: 50000, indicativeCapacityUsd: 120000, expirySeconds: 13, expectedHedgeCostBps: 4.2, fillProbability: 34, toxicityScore: 33, expectedEdgeBps: 8.2, capacityOrigin: simulated("Maker inventory model", 2100) },
      { sizeLabel: "$100k", notionalUsd: 100000, bid: 597.8, ask: 626.6, spreadBps: 28.8, firmCapacityUsd: 75000, indicativeCapacityUsd: 200000, expirySeconds: 11, expectedHedgeCostBps: 7.5, fillProbability: 19, toxicityScore: 44, expectedEdgeBps: 11.1, capacityOrigin: simulated("Maker inventory model", 2100) },
    ],
    "eth-funding-26sep26": [
      { sizeLabel: "$10k", notionalUsd: 10000, bid: 431.8, ask: 439.2, spreadBps: 7.4, firmCapacityUsd: 10000, indicativeCapacityUsd: 35000, expirySeconds: 18, expectedHedgeCostBps: 1.7, fillProbability: 61, toxicityScore: 22, expectedEdgeBps: 5.7, capacityOrigin: simulated("Maker inventory model", 2100) },
      { sizeLabel: "$25k", notionalUsd: 25000, bid: 429.6, ask: 441.9, spreadBps: 12.3, firmCapacityUsd: 25000, indicativeCapacityUsd: 65000, expirySeconds: 15, expectedHedgeCostBps: 2.8, fillProbability: 48, toxicityScore: 29, expectedEdgeBps: 7.2, capacityOrigin: simulated("Maker inventory model", 2100) },
      { sizeLabel: "$50k", notionalUsd: 50000, bid: 425.1, ask: 446.8, spreadBps: 21.7, firmCapacityUsd: 35000, indicativeCapacityUsd: 110000, expirySeconds: 12, expectedHedgeCostBps: 5.1, fillProbability: 30, toxicityScore: 36, expectedEdgeBps: 9.4, capacityOrigin: simulated("Maker inventory model", 2100) },
    ],
    "arb-basis-27mar27": [
      { sizeLabel: "$5k", notionalUsd: 5000, bid: 281.7, ask: 297.1, spreadBps: 15.4, firmCapacityUsd: 5000, indicativeCapacityUsd: 15000, expirySeconds: 14, expectedHedgeCostBps: 3.6, fillProbability: 46, toxicityScore: 39, expectedEdgeBps: 8.1, capacityOrigin: simulated("Maker inventory model", 2100) },
      { sizeLabel: "$10k", notionalUsd: 10000, bid: 277.4, ask: 301.8, spreadBps: 24.4, firmCapacityUsd: 5000, indicativeCapacityUsd: 30000, expirySeconds: 10, expectedHedgeCostBps: 7.8, fillProbability: 26, toxicityScore: 51, expectedEdgeBps: 10.2, capacityOrigin: simulated("Maker inventory model", 2100) },
    ],
  },
  marketRisk: [
    { seriesId: "btc-yc-24dec26", grossNotionalUsd: 128400, netDeltaUsd: -8400, expectedHedgeCostBps: 3.8, stressLossUsd: 1280, quoteLimitUsd: 250000, utilization: 51.4, state: "WITHIN_LIMIT" },
    { seriesId: "eth-funding-26sep26", grossNotionalUsd: 76600, netDeltaUsd: 3100, expectedHedgeCostBps: 4.2, stressLossUsd: 970, quoteLimitUsd: 175000, utilization: 43.8, state: "WITHIN_LIMIT" },
    { seriesId: "arb-basis-27mar27", grossNotionalUsd: 31200, netDeltaUsd: -6800, expectedHedgeCostBps: 8.1, stressLossUsd: 1410, quoteLimitUsd: 50000, utilization: 62.4, state: "WATCH" },
  ],
  inventory: [
    { id: "inv-btc", seriesId: "btc-yc-24dec26", label: "BTC Carry Dec 26", netPackageQuantity: 1.84, deltaUsd: -8400, vegaUsd: 0, fundingExposureUsd: 362, hedgeVenue: "Simulated perp adapter", hedgeStatus: "COVERED", closeCostBps: 3.8, freshness: simulated("Inventory projection", 2100) },
    { id: "inv-eth", seriesId: "eth-funding-26sep26", label: "ETH Funding Sep 26", netPackageQuantity: -2.16, deltaUsd: 3100, vegaUsd: 0, fundingExposureUsd: -218, hedgeVenue: "Simulated perp adapter", hedgeStatus: "COVERED", closeCostBps: 4.2, freshness: simulated("Inventory projection", 2100) },
    { id: "inv-arb", seriesId: "arb-basis-27mar27", label: "ARB Basis Mar 27", netPackageQuantity: 6.42, deltaUsd: -6800, vegaUsd: 0, fundingExposureUsd: 94, hedgeVenue: "Simulated perp adapter", hedgeStatus: "PENDING", closeCostBps: 8.1, freshness: simulated("Inventory projection", 2100) },
  ],
  rfqs: [
    { id: "rfq-8421", seriesId: "btc-yc-24dec26", side: "BUY", sizeLabel: "$50k", requestedNotionalUsd: 50000, requestedAt: "07:11:01", expiresInSeconds: 18, counterpartyScope: "Blind qualified", eligibility: "ELIGIBLE", modeledHedgeCostBps: 4.1, modeledEdgeBps: 8.2, source: simulated("RFQ relay fixture", 2100) },
    { id: "rfq-8420", seriesId: "eth-funding-26sep26", side: "SELL", sizeLabel: "$25k", requestedNotionalUsd: 25000, requestedAt: "07:10:58", expiresInSeconds: 12, counterpartyScope: "Blind qualified", eligibility: "ELIGIBLE", modeledHedgeCostBps: 2.7, modeledEdgeBps: 7.1, source: simulated("RFQ relay fixture", 2100) },
    { id: "rfq-8419", seriesId: "arb-basis-27mar27", side: "BUY", sizeLabel: "$25k", requestedNotionalUsd: 25000, requestedAt: "07:10:54", expiresInSeconds: 8, counterpartyScope: "Directed desk tier B", eligibility: "CAPACITY_LIMITED", modeledHedgeCostBps: 9.2, modeledEdgeBps: 5.4, source: simulated("RFQ relay fixture", 2100) },
  ],
  capital: [
    { label: "Available", amountUsd: 472800, description: "Eligible for new firm reservations", state: "AVAILABLE" },
    { label: "Firm reservations", amountUsd: 161200, description: "Quote capacity already committed", state: "RESERVED" },
    { label: "Withdrawal delay", amountUsd: 84500, description: "Not eligible until release window", state: "WITHDRAWAL_DELAY" },
    { label: "Recovery reserve", amountUsd: 50000, description: "Bounded recovery allocation", state: "RECOVERY" },
  ],
  health: [
    { id: "oracle", label: "Preview market feed", state: "HEALTHY", latencyMs: 92, lastUpdate: "2.1s ago", source: "Setryn preview-feed/1" },
    { id: "quote", label: "Quote policy engine", state: "HEALTHY", latencyMs: 28, lastUpdate: "0.8s ago", source: "Maker policy fixture" },
    { id: "hedge", label: "Hedge adapter", state: "DEGRADED", latencyMs: 248, lastUpdate: "4.2s ago", source: "Simulated perp adapter" },
    { id: "receipt", label: "Receipt projector", state: "HEALTHY", latencyMs: 64, lastUpdate: "1.4s ago", source: "Indexer projection fixture" },
  ],
  killSwitches: [
    { id: "all", label: "All quoting", description: "Stops new quote creation across every series", active: false, protectedNotionalUsd: 485000 },
    { id: "btc", label: "BTC Yield Carry", description: "Stops new BTC series quotes only", active: false, protectedNotionalUsd: 250000 },
    { id: "arb", label: "ARB Basis", description: "Stops new ARB series quotes only", active: false, protectedNotionalUsd: 50000 },
  ],
};
