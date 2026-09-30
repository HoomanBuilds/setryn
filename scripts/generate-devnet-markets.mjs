#!/usr/bin/env node
// Projects the terminal market catalog (apps/web/src/lib/terminal/markets.ts) into the integer table the devnet
// bootstrap registers onchain: one series per catalog market, priced on the catalog's own tick grid and contract
// multiplier, with a capped payoff band around the market's forward reference. The catalog stays the one source of
// truth, so the onchain books, the preview feed, and the ticket all read the same market definitions.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
if (outputIndex === -1 || !args[outputIndex + 1]) {
  process.stderr.write("usage: generate-devnet-markets.mjs --output <path>\n");
  process.exit(1);
}
const output = resolve(args[outputIndex + 1]);

const PRIMARY_MARKET_KEY = "BTC-YC-24DEC26";
const MAX_ORDER_LOTS = 10;
const MINOR_PER_UNIT = 1_000_000;
const FIXING_DECIMALS = 8;

/** Underlying families the benchmarks fix on. Crypto=1, Fx=3, Commodity=4 in the protocol's AssetClass enum. */
const FAMILIES = {
  BTC: { symbol: "BTC", feedKey: "Crypto.BTC/USD", assetClass: 1 },
  ETH: { symbol: "ETH", feedKey: "Crypto.ETH/USD", assetClass: 1 },
  ARB: { symbol: "ARB", feedKey: "Crypto.ARB/USD", assetClass: 1 },
  "EUR/USD": { symbol: "EUR", feedKey: "FX.EUR/USD", assetClass: 3 },
  "XAU/USD": { symbol: "XAU", feedKey: "Metal.XAU/USD", assetClass: 4 },
};

function exactInteger(value, label) {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded <= 0 || Math.abs(value - rounded) > Math.max(1e-6, Math.abs(value) * 1e-12)) {
    throw new Error(`${label} is not a positive integer (${value})`);
  }
  return rounded;
}

const catalog = await import(pathToFileURL(resolve(repositoryRoot, "apps/web/src/lib/terminal/markets.ts")).href);
const markets = catalog.MARKETS;
if (!Array.isArray(markets) || markets.length === 0) throw new Error("market catalog is empty");
if (markets[0].id !== PRIMARY_MARKET_KEY) throw new Error(`the primary market must lead the catalog (${PRIMARY_MARKET_KEY})`);
if (new Set(markets.map((market) => market.id)).size !== markets.length) throw new Error("duplicate catalog market id");

const familyKeys = [];
const table = markets.map((market) => {
  const family = FAMILIES[market.underlying];
  if (!family) throw new Error(`${market.id} has no benchmark family for underlying ${market.underlying}`);
  if (!familyKeys.includes(market.underlying)) familyKeys.push(market.underlying);
  const forward = market.legs.find((leg) => leg.family === "FORWARD");
  if (!forward || !(forward.mark > 0)) throw new Error(`${market.id} has no forward reference leg`);
  // One onchain tick is one unit of the catalog's last price decimal, so every catalog tick lands on the grid.
  const priceScale = 10 ** market.priceDecimals;
  const tickGrid = market.tickSize * priceScale;
  if (Math.abs(tickGrid - Math.round(tickGrid)) > 1e-9) throw new Error(`${market.id} tick size is off its decimal grid`);
  return {
    marketKey: market.id,
    family: familyKeys.indexOf(market.underlying),
    priceDecimals: market.priceDecimals,
    priceScale,
    // Consideration per lot is price x contract multiplier, so one tick is the multiplier over the price scale.
    tickSizeMinor: exactInteger((market.contractMultiplier * MINOR_PER_UNIT) / priceScale, `${market.id} tick size`),
    // The capped forward fixes on the family benchmark around this maturity's forward mark ...
    strike: exactInteger(forward.mark * 10 ** FIXING_DECIMALS, `${market.id} strike`),
    // ... and pays at most the catalog's collateral per lot either way, reached at a ten percent move.
    bandMinor: exactInteger(market.collateralPerLot * MINOR_PER_UNIT, `${market.id} payoff band`),
    maxOrderLots: MAX_ORDER_LOTS,
  };
});

const document = {
  schemaVersion: 1,
  source: "apps/web/src/lib/terminal/markets.ts",
  fixingDecimals: FIXING_DECIMALS,
  familyCount: familyKeys.length,
  marketCount: table.length,
  families: familyKeys.map((key) => FAMILIES[key]),
  markets: table,
};
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`Wrote ${table.length} devnet markets across ${familyKeys.length} benchmark families to ${output}\n`);
