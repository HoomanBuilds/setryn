#!/usr/bin/env node
// Builds the market listing a network bootstrap registers (deployments/<network>/markets.json, schema 2): one dated
// range forward per family and quarterly expiry, struck around the live Chainlink reference on Arbitrum One. Reads are
// eth_call only; nothing is signed or sent. See docs/plans/network-runtime-real-data.md for the product model.
//
//   node scripts/generate-network-markets.mjs --network <local|arbitrum-sepolia|arbitrum-one> [--output <path>]
//     [--listed-at <unix seconds>] [--expiries 3]
//
// SETRYN_REFERENCE_RPC_URL overrides the Arbitrum One RPC used for the reference reads.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NETWORKS = new Set(["local", "arbitrum-sepolia", "arbitrum-one"]);
const REFERENCE_CHAIN_ID = 42161;
const FIXING_DECIMALS = 8;
const E8 = 10n ** 8n;
const MINOR_PER_UNIT = 10n ** 6n;
const MIN_DAYS_TO_EXPIRY = 14;
const EXPIRY_HOUR_UTC = 8;
const MAX_ORDER_LOTS = 100;

/**
 * Families, their Chainlink aggregators on Arbitrum One (verified 2026-10-01), and contract parameters. Prices are
 * decimal strings so lot, tick, floor, and cap stay exact.
 */
const FAMILIES = [
  {
    symbol: "BTC", underlying: "BTC", keyPrefix: "BTC", kindCode: "YC", feedKey: "Crypto.BTC/USD", assetClass: 1,
    referenceFeed: "0x6ce185860a4963106506C203335A2910413708e9", strategyKind: "DATED_YIELD_CARRY",
    lotSize: "0.01", tickPrice: "1", priceDecimals: 0, floorBps: 5_000n, capBps: 15_000n, roundTo: "1000",
  },
  {
    symbol: "ETH", underlying: "ETH", keyPrefix: "ETH", kindCode: "FC", feedKey: "Crypto.ETH/USD", assetClass: 1,
    referenceFeed: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612", strategyKind: "FUNDING_CARRY",
    lotSize: "0.1", tickPrice: "0.1", priceDecimals: 1, floorBps: 5_000n, capBps: 15_000n, roundTo: "10",
  },
  {
    symbol: "ARB", underlying: "ARB", keyPrefix: "ARB", kindCode: "BS", feedKey: "Crypto.ARB/USD", assetClass: 1,
    referenceFeed: "0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6", strategyKind: "DATED_BASIS",
    lotSize: "1000", tickPrice: "0.0001", priceDecimals: 4, floorBps: 5_000n, capBps: 15_000n, roundTo: "0.01",
  },
  {
    symbol: "EUR", underlying: "EUR/USD", keyPrefix: "EURUSD", kindCode: "FW", feedKey: "FX.EUR/USD", assetClass: 3,
    referenceFeed: "0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84", strategyKind: "DELIVERABLE_FORWARD",
    lotSize: "10000", tickPrice: "0.00001", priceDecimals: 5, floorBps: 8_000n, capBps: 12_000n, roundTo: "0.01",
  },
  {
    symbol: "XAU", underlying: "XAU/USD", keyPrefix: "XAUUSD", kindCode: "FW", feedKey: "Metal.XAU/USD", assetClass: 4,
    referenceFeed: "0x1F954Dc24a49708C26E0C1777f16750B5C6d5a2c", strategyKind: "DELIVERABLE_FORWARD",
    lotSize: "1", tickPrice: "0.1", priceDecimals: 1, floorBps: 7_000n, capBps: 13_000n, roundTo: "10",
  },
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function argument(name, fallback) {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

/** A decimal string as an integer scaled by 10^decimals; refuses values that need more precision. */
function scaled(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`not a decimal: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`${value} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** An integer scaled by 10^decimals back to a trimmed decimal string. */
function decimal(value, decimals) {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = magnitude / base;
  const fraction = (magnitude % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function roundToUnit(valueE8, unitE8) {
  return ((valueE8 + unitE8 / 2n) / unitE8) * unitE8;
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
  return body.result;
}

/** latestRoundData() on a Chainlink aggregator proxy: the answer (8 decimals for every feed listed) and its time. */
async function latestRound(url, feed) {
  const [decimalsHex, roundHex] = await Promise.all([
    rpc(url, "eth_call", [{ to: feed, data: "0x313ce567" }, "latest"]),
    rpc(url, "eth_call", [{ to: feed, data: "0xfeaf968c" }, "latest"]),
  ]);
  if (BigInt(decimalsHex) !== BigInt(FIXING_DECIMALS)) throw new Error(`${feed} does not report ${FIXING_DECIMALS} decimals`);
  const words = roundHex.slice(2).match(/.{64}/g);
  if (!words || words.length !== 5) throw new Error(`${feed} returned a malformed round`);
  const answer = BigInt.asIntN(256, BigInt(`0x${words[1]}`));
  const updatedAt = Number(BigInt(`0x${words[3]}`));
  if (answer <= 0n) throw new Error(`${feed} returned a non-positive answer`);
  return { answerE8: answer, updatedAt };
}

/** The last Friday of a month at 08:00 UTC; a Christmas Day expiry moves to the 24th. */
function quarterlyExpiry(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const back = (lastDay.getUTCDay() - 5 + 7) % 7;
  let day = lastDay.getUTCDate() - back;
  if (monthIndex === 11 && day === 25) day = 24;
  return Math.floor(Date.UTC(year, monthIndex, day, EXPIRY_HOUR_UTC) / 1000);
}

function nextQuarterlies(listedAt, count) {
  const expiries = [];
  const start = new Date(listedAt * 1000);
  for (let year = start.getUTCFullYear(); expiries.length < count; year += 1) {
    for (const monthIndex of [2, 5, 8, 11]) {
      const expiry = quarterlyExpiry(year, monthIndex);
      if (expiry - listedAt >= MIN_DAYS_TO_EXPIRY * 86_400 && expiries.length < count) expiries.push(expiry);
    }
  }
  return expiries;
}

function expiryCode(expiry) {
  const date = new Date(expiry * 1000);
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${day}${MONTHS[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(2)}`;
}

function expiryLabel(expiry) {
  const date = new Date(expiry * 1000);
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
}

const network = argument("network");
if (!NETWORKS.has(network)) {
  process.stderr.write("usage: generate-network-markets.mjs --network <local|arbitrum-sepolia|arbitrum-one> [--output <path>]\n");
  process.exit(1);
}
const output = resolve(argument("output", resolve(repositoryRoot, "deployments", network, "markets.json")));
const referenceRpcUrl = process.env.SETRYN_REFERENCE_RPC_URL ?? "https://arb1.arbitrum.io/rpc";
const listedAt = Number(argument("listed-at", String(Math.floor(Date.now() / 3_600_000) * 3_600)));
const expiryCount = Number(argument("expiries", "3"));
if (!Number.isSafeInteger(listedAt) || listedAt <= 0) throw new Error("--listed-at must be unix seconds");

const chainId = Number(BigInt(await rpc(referenceRpcUrl, "eth_chainId", [])));
if (chainId !== REFERENCE_CHAIN_ID) throw new Error(`reference RPC is chain ${chainId}, expected Arbitrum One (${REFERENCE_CHAIN_ID})`);

const expiries = nextQuarterlies(listedAt, expiryCount);
const families = [];
const markets = [];
for (const [index, family] of FAMILIES.entries()) {
  const { answerE8, updatedAt } = await latestRound(referenceRpcUrl, family.referenceFeed);
  const unitE8 = scaled(family.roundTo, FIXING_DECIMALS);
  const floorE8 = roundToUnit((answerE8 * family.floorBps) / 10_000n, unitE8);
  const capE8 = roundToUnit((answerE8 * family.capBps) / 10_000n, unitE8);
  if (!(floorE8 > 0n && floorE8 < answerE8 && answerE8 < capE8)) throw new Error(`${family.symbol} floor and cap do not bracket the reference`);
  const tickE8 = scaled(family.tickPrice, FIXING_DECIMALS);
  if (floorE8 % tickE8 !== 0n || capE8 % tickE8 !== 0n) throw new Error(`${family.symbol} floor or cap is off the tick grid`);
  // Consideration per tick per lot: lot x tick price in USDC minor units; the payoff pays lot x (fixing - floor).
  const lotE8 = scaled(family.lotSize, FIXING_DECIMALS);
  const tickSizeMinor = (lotE8 * tickE8 * MINOR_PER_UNIT) / (E8 * E8);
  if ((lotE8 * tickE8 * MINOR_PER_UNIT) % (E8 * E8) !== 0n || tickSizeMinor <= 0n) throw new Error(`${family.symbol} tick size is not whole minor units`);
  const priceScale = E8 / tickE8;
  if (E8 % tickE8 !== 0n) throw new Error(`${family.symbol} tick price does not divide one unit`);
  const payoffNumerator = (lotE8 * MINOR_PER_UNIT) / E8;
  if ((lotE8 * MINOR_PER_UNIT) % E8 !== 0n) throw new Error(`${family.symbol} lot size is not whole minor units`);
  const bandMinor = (lotE8 * (capE8 - floorE8) * MINOR_PER_UNIT) / (E8 * E8);

  families.push({
    symbol: family.symbol,
    underlying: family.underlying,
    feedKey: family.feedKey,
    assetClass: family.assetClass,
    referenceFeed: family.referenceFeed,
    referencePriceE8: answerE8.toString(),
    referencePrice: decimal(answerE8, FIXING_DECIMALS),
    referenceAt: updatedAt,
    strategyKind: family.strategyKind,
  });
  for (const expiry of expiries) {
    markets.push({
      marketKey: `${family.keyPrefix}-${family.kindCode}-${expiryCode(expiry)}`,
      family: index,
      displayName: `${family.underlying} Dated Forward · ${expiryLabel(expiry)}`,
      expiryAt: expiry,
      floorE8: floorE8.toString(),
      capE8: capE8.toString(),
      floor: decimal(floorE8, FIXING_DECIMALS),
      cap: decimal(capE8, FIXING_DECIMALS),
      lotSize: family.lotSize,
      tickPrice: family.tickPrice,
      priceDecimals: family.priceDecimals,
      priceScale: Number(priceScale),
      tickSizeMinor: Number(tickSizeMinor),
      payoffMultiplierNumerator: payoffNumerator.toString(),
      payoffMultiplierDenominator: E8.toString(),
      bandMinor: bandMinor.toString(),
      maxOrderLots: MAX_ORDER_LOTS,
    });
  }
}

const document = {
  schemaVersion: 2,
  network,
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  listedAt,
  fixingDecimals: FIXING_DECIMALS,
  reference: { source: "chainlink", chainId: REFERENCE_CHAIN_ID },
  families,
  markets,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${markets.length} markets for ${network} -> ${output}\n`);
for (const family of families) process.stdout.write(`  ${family.underlying.padEnd(8)} ${family.referencePrice}\n`);
