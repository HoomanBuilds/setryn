#!/usr/bin/env node
// Projects the selected network's listed markets into the static catalog the web app imports synchronously
// (src/lib/terminal/catalog.generated.json). Metadata only: identity, expiry and schedule, payoff bounds, lot and tick
// grid, and the reference each family was listed against. Every live number (book, fills, marks, references) comes from
// the market-data feed at runtime. See docs/plans/network-runtime-real-data.md, section 3.
//
//   SETRYN_NETWORK=<local|arbitrum-sepolia|arbitrum-one> node scripts/sync-market-catalog.mjs
//
// Source, in order: deployments/<network>/runtime.json when it is schema 11 (SETRYN_RUNTIME_PATH overrides the path),
// else the schema 2 listing deployments/<network>/markets.json. The listing also supplies each family's reference
// price at listing when the runtime is the source.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(webRoot, "..", "..");
const NETWORKS = new Set(["local", "arbitrum-sepolia", "arbitrum-one"]);
const CHAIN_IDS = { local: 31337, "arbitrum-sepolia": 421614, "arbitrum-one": 42161 };
const STRATEGY_KINDS = new Set(["DATED_YIELD_CARRY", "FUNDING_CARRY", "DATED_BASIS", "DELIVERABLE_FORWARD"]);
const SCHEDULE_FIELDS = [
  "tradingStartsAt",
  "lastTradingAt",
  "fixingWindowOpen",
  "fixingWindowClose",
  "exerciseOpensAt",
  "exerciseCutoffAt",
  "finalResolutionAt",
  "settlementDeadline",
];
const OUTPUT = resolve(webRoot, "src/lib/terminal/catalog.generated.json");

function fail(message) {
  console.error(`sync-market-catalog: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function decimal(value, field, key) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) fail(`${key}: ${field} is not a decimal (${JSON.stringify(value)})`);
  return number;
}

function positiveInteger(value, field, key) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number <= 0) fail(`${key}: ${field} is not a positive integer (${JSON.stringify(value)})`);
  return number;
}

function e8(value) {
  return typeof value === "string" || typeof value === "number" ? Number(BigInt(value)) / 1e8 : Number.NaN;
}

/** Family reference at listing, keyed by underlying, from a schema 2 listing. */
function listingReferences(listing) {
  const references = new Map();
  for (const family of listing?.families ?? []) {
    const price = family.referencePrice !== undefined ? Number(family.referencePrice) : e8(family.referencePriceE8);
    references.set(family.underlying, {
      referencePrice: Number.isFinite(price) && price > 0 ? price : null,
      referenceAt: Number.isSafeInteger(family.referenceAt) ? family.referenceAt : null,
      referenceFeed: typeof family.referenceFeed === "string" ? family.referenceFeed : null,
    });
  }
  return references;
}

function projectMarket(raw, defaults, references) {
  const key = raw.marketKey;
  if (typeof key !== "string" || key.length === 0) fail("a market has no marketKey");
  const underlying = raw.underlying ?? defaults.underlying;
  const strategyKind = raw.strategyKind ?? defaults.strategyKind;
  if (typeof underlying !== "string") fail(`${key}: no underlying`);
  if (!STRATEGY_KINDS.has(strategyKind)) fail(`${key}: unknown strategyKind ${JSON.stringify(strategyKind)}`);
  const floor = decimal(raw.floor ?? raw.priceOffset ?? e8(raw.floorE8), "floor", key);
  const cap = decimal(raw.cap ?? e8(raw.capE8), "cap", key);
  if (!(cap > floor)) fail(`${key}: cap ${cap} is not above floor ${floor}`);
  const tickPrice = decimal(raw.tickPrice, "tickPrice", key);
  const priceScale = positiveInteger(raw.priceScale, "priceScale", key);
  const reference = references.get(underlying) ?? { referencePrice: null, referenceAt: null, referenceFeed: null };
  const market = {
    id: key,
    displayName: typeof raw.displayName === "string" ? raw.displayName : key,
    underlying,
    feedKey: raw.feedKey ?? defaults.feedKey ?? null,
    strategyKind,
    expiryAt: positiveInteger(raw.expiryAt, "expiryAt", key),
  };
  for (const field of SCHEDULE_FIELDS) {
    if (raw[field] !== undefined && raw[field] !== null) market[field] = positiveInteger(raw[field], field, key);
  }
  return {
    ...market,
    floor,
    cap,
    lotSize: decimal(raw.lotSize, "lotSize", key),
    tickPrice,
    priceDecimals: Number.isSafeInteger(raw.priceDecimals) ? raw.priceDecimals : Math.round(Math.log10(priceScale)),
    priceScale,
    tickSizeMinor: positiveInteger(raw.tickSizeMinor, "tickSizeMinor", key),
    maxOrderLots: positiveInteger(raw.maxOrderLots, "maxOrderLots", key),
    referenceFeed: raw.referenceFeed ?? defaults.referenceFeed ?? reference.referenceFeed,
    referencePrice: reference.referencePrice,
    referenceAt: reference.referenceAt,
  };
}

const network = process.env.SETRYN_NETWORK ?? process.env.NEXT_PUBLIC_SETRYN_NETWORK ?? "local";
if (!NETWORKS.has(network)) fail(`unknown SETRYN_NETWORK ${JSON.stringify(network)}`);
const deploymentDir = resolve(repositoryRoot, "deployments", network);
const runtimePath = process.env.SETRYN_RUNTIME_PATH
  ? resolve(process.env.SETRYN_RUNTIME_PATH)
  : resolve(deploymentDir, "runtime.json");
const listingPath = resolve(deploymentDir, "markets.json");

const runtime = existsSync(runtimePath) ? readJson(runtimePath) : null;
const listing = existsSync(listingPath) ? readJson(listingPath) : null;
if (listing && listing.schemaVersion !== 2) fail(`${listingPath} is schema ${listing.schemaVersion}, expected 2`);
const references = listingReferences(listing);

let catalog;
if (runtime && runtime.schemaVersion >= 11) {
  if (!Array.isArray(runtime.markets) || runtime.markets.length === 0) fail(`${runtimePath} lists no markets`);
  catalog = {
    schemaVersion: 1,
    network: runtime.network ?? network,
    source: "runtime",
    chainId: Number.isSafeInteger(runtime.chainId) ? runtime.chainId : CHAIN_IDS[network],
    listedAt: runtime.listedAt ?? listing?.listedAt ?? null,
    fixingAdapterKind: runtime.fixingAdapterKind ?? null,
    markets: runtime.markets.map((market) => projectMarket(market, {}, references)),
  };
} else if (listing) {
  if (!Array.isArray(listing.markets) || listing.markets.length === 0) fail(`${listingPath} lists no markets`);
  catalog = {
    schemaVersion: 1,
    network: listing.network ?? network,
    source: "listing",
    chainId: CHAIN_IDS[network],
    listedAt: listing.listedAt ?? null,
    fixingAdapterKind: null,
    markets: listing.markets.map((market) => {
      const family = listing.families?.[market.family];
      if (!family) fail(`${market.marketKey}: unknown family ${market.family}`);
      return projectMarket(market, family, references);
    }),
  };
} else if (existsSync(OUTPUT)) {
  // A hosted build (for example Vercel) checks out only committed files: deployments/local/ is git-ignored, and a
  // network's runtime exists only after its deployment is committed. Keep the committed catalog rather than fail.
  console.warn(
    `sync-market-catalog: no schema 11 runtime at ${runtimePath} and no listing at ${listingPath}; keeping the committed catalog`,
  );
  process.exit(0);
} else {
  fail(`no schema 11 runtime at ${runtimePath}, no listing at ${listingPath}, and no committed catalog`);
}

const keys = new Set();
for (const market of catalog.markets) {
  if (keys.has(market.id)) fail(`duplicate market ${market.id}`);
  keys.add(market.id);
}

const text = `${JSON.stringify(catalog, null, 2)}\n`;
const previous = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : null;
if (previous !== text) writeFileSync(OUTPUT, text);
console.log(
  `sync-market-catalog: ${catalog.markets.length} markets from ${catalog.source === "runtime" ? runtimePath : listingPath} (${catalog.network})${
    previous === text ? ", unchanged" : ""
  }`,
);
