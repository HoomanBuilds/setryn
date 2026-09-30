#!/usr/bin/env node
// Reprices the local devnet's protocol fee schedule and moves every devnet market and series onto the new version.
//
//   node scripts/update-devnet-fees.mjs --maker-bps 0 --taker-bps 10
//
// It runs contracts/script/UpdateFeeSchedule.s.sol as the runtime operator against the local devnet only (chain 31337,
// loopback RPC), then reads the result back from the chain and rewrites deployments/local/runtime.json. Stdout carries
// exactly one JSON line, on success and on failure; forge output goes to stderr.
//
// Why markets and series move too: a market pins an exact fee schedule version and a series pins an exact market
// version, and every new-risk gate requires that exact version to be active. Retiring fee version n closes everything
// pinned to it, so the script registers successor market and series versions pinned to n+1. Orders must then sign the
// new `feeScheduleVersion` and each market's new `seriesVersion` as their `targetVersion`. Positions opened under the
// old versions keep settling.
//
// Idempotent: when the active version already charges the requested rates and every runtime market and series is on
// it, nothing is sent; the runtime is resynced from the chain and the result reports `changed: false`.
//
// Exit codes: 0 success (changed or unchanged), 1 unexpected error, 2 usage, 3 refused environment (non-loopback RPC, chain other than
// 31337, missing or foreign runtime), 4 another update holds the lock, 5 the onchain update failed (forge reverted or
// the chain did not end on the new version), 6 inconsistent chain state that needs a devnet reset, 7 the chain was
// updated but runtime.json could not be rewritten (rerun with the same rates to resync).
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractsRoot = resolve(repositoryRoot, "contracts");
const localDeployments = resolve(repositoryRoot, "deployments/local");
const LOCAL_CHAIN_ID = 31337;
const PPM_PER_BPS = 100;
const PPM_DENOMINATOR = 1_000_000;

const SELECTOR = {
  activeVersion: "0x3b28ffc4", // activeVersion(bytes32), shared by the fee, market, and series registries
  previewFeeAction: "0x24bad40e", // previewFeeAction(bytes32,uint32,bytes32,uint128,uint128)
  getMarket: "0x4c6c19b6", // getMarket(bytes32,uint32)
  getSeries: "0xbf249103", // getSeries(bytes32,uint32)
};
const FEE_ACTION = {
  maker: "0xa1437c48bb6d6e46e0aac648537ccb0e64e380a813cd98611c35cc00af3fa9bc", // SetrynFeeActionV1:MakerFill
  taker: "0x82448a879676b592aa9e35934cc5d732ec8e92dca3f2639d0b9bdc3e8e43f972", // SetrynFeeActionV1:TakerFill
};
// MarketVersion and SeriesVersion are fully static tuples, so their fields sit at fixed words of the return data.
const MARKET_FEE_SCHEDULE_ID_WORD = 14;
const MARKET_FEE_SCHEDULE_VERSION_WORD = 15;
const SERIES_MARKET_ID_WORD = 2;
const SERIES_MARKET_VERSION_WORD = 3;

class Failure extends Error {
  constructor(exitCode, code, message) {
    super(message);
    this.exitCode = exitCode;
    this.code = code;
  }
}

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function usage(message) {
  throw new Failure(
    2,
    "USAGE",
    `${message}. Usage: update-devnet-fees.mjs --maker-bps <bps> --taker-bps <bps> [--max-charge-bps <bps>] [--rpc-url <loopback url>] [--runtime <deployments/local/...json>] [--dry-run]`,
  );
}

function parseArgs(argv) {
  const options = { rpcUrl: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545", runtime: resolve(localDeployments, "runtime.json"), dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    index += 1;
    if (flag === "--maker-bps") options.makerPpm = bpsToPpm(value, flag);
    else if (flag === "--taker-bps") options.takerPpm = bpsToPpm(value, flag);
    else if (flag === "--max-charge-bps") options.maxChargePpm = bpsToPpm(value, flag);
    else if (flag === "--rpc-url") options.rpcUrl = value;
    else if (flag === "--runtime") options.runtime = resolve(value);
    else usage(`unknown argument ${flag}`);
  }
  if (options.makerPpm === undefined || options.takerPpm === undefined) usage("--maker-bps and --taker-bps are required");
  return options;
}

/** Basis points with at most two decimals (1 ppm = 0.01 bp), converted to exact integer ppm. */
function bpsToPpm(raw, flag) {
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) usage(`${flag} must be a non-negative number of basis points with at most two decimals`);
  const [whole, fraction = ""] = raw.split(".");
  const ppm = Number(whole) * PPM_PER_BPS + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(ppm) || ppm > PPM_DENOMINATOR) usage(`${flag} is above 10000 bps`);
  return ppm;
}

function requireLoopbackRpc(rpcUrl) {
  let parsed;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Failure(3, "RPC_REFUSED", `RPC URL ${rpcUrl} is not a URL`);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "http:" || !loopback || parsed.username || parsed.password) {
    throw new Failure(3, "RPC_REFUSED", "Only an http loopback RPC (the local devnet) is accepted");
  }
}

async function rpc(rpcUrl, method, params) {
  let response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (error) {
    throw new Failure(3, "RPC_UNREACHABLE", `Cannot reach ${rpcUrl}: ${error.message}`);
  }
  const body = await response.json();
  if (body.error) throw new Failure(5, "RPC_ERROR", `${method} failed: ${body.error.message}`);
  return body.result;
}

const word = (hex) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const uintWord = (value) => BigInt(value).toString(16).padStart(64, "0");

async function call(rpcUrl, to, selector, words) {
  const data = `${selector}${words.join("")}`;
  const result = await rpc(rpcUrl, "eth_call", [{ to, data }, "latest"]);
  if (typeof result !== "string" || result.length < 66) throw new Failure(5, "CALL_FAILED", `eth_call to ${to} returned no data`);
  return result;
}

const readWord = (result, index) => `0x${result.slice(2 + index * 64, 2 + (index + 1) * 64)}`;
const readUint = (result, index) => Number(BigInt(readWord(result, index)));

async function activeVersion(rpcUrl, registry, id) {
  return readUint(await call(rpcUrl, registry, SELECTOR.activeVersion, [word(id)]), 0);
}

/** The charge rate the version's rule for one fill action carries, read through FundedFeeEngine.previewFeeAction. */
async function chargeRatePpm(rpcUrl, runtime, version, actionId) {
  const result = await call(rpcUrl, runtime.fundedFeeEngine, SELECTOR.previewFeeAction, [
    word(runtime.feeScheduleId),
    uintWord(version),
    word(actionId),
    uintWord(1_000_000),
    uintWord(0),
  ]);
  return readUint(result, 2);
}

/** Onchain truth for the fee schedule and every runtime market, plus whether the markets and series follow it. */
async function readChainState(rpcUrl, runtime) {
  const feeScheduleVersion = await activeVersion(rpcUrl, runtime.feeScheduleRegistry, runtime.feeScheduleId);
  if (feeScheduleVersion === 0) throw new Failure(6, "NO_ACTIVE_FEE_SCHEDULE", "The fee schedule has no active version; reset the devnet");
  const [makerFeeRatePpm, takerFeeRatePpm] = await Promise.all([
    chargeRatePpm(rpcUrl, runtime, feeScheduleVersion, FEE_ACTION.maker),
    chargeRatePpm(rpcUrl, runtime, feeScheduleVersion, FEE_ACTION.taker),
  ]);
  const markets = [];
  let consistent = true;
  for (const market of runtime.markets) {
    const marketVersion = await activeVersion(rpcUrl, runtime.marketRegistry, market.marketId);
    const seriesVersion = await activeVersion(rpcUrl, runtime.seriesRegistry, market.seriesId);
    if (marketVersion === 0 || seriesVersion === 0) {
      consistent = false;
    } else {
      const marketRecord = await call(rpcUrl, runtime.marketRegistry, SELECTOR.getMarket, [word(market.marketId), uintWord(marketVersion)]);
      const seriesRecord = await call(rpcUrl, runtime.seriesRegistry, SELECTOR.getSeries, [word(market.seriesId), uintWord(seriesVersion)]);
      consistent &&=
        readWord(marketRecord, MARKET_FEE_SCHEDULE_ID_WORD).toLowerCase() === `0x${word(runtime.feeScheduleId)}` &&
        readUint(marketRecord, MARKET_FEE_SCHEDULE_VERSION_WORD) === feeScheduleVersion &&
        readWord(seriesRecord, SERIES_MARKET_ID_WORD).toLowerCase() === `0x${word(market.marketId)}` &&
        readUint(seriesRecord, SERIES_MARKET_VERSION_WORD) === marketVersion;
    }
    markets.push({ marketKey: market.marketKey, marketId: market.marketId, marketVersion, seriesId: market.seriesId, seriesVersion });
  }
  return { feeScheduleVersion, makerFeeRatePpm, takerFeeRatePpm, markets, consistent };
}

function loadRuntime(path) {
  const relative = path.startsWith(`${localDeployments}${sep}`);
  if (!relative) throw new Failure(3, "RUNTIME_REFUSED", "The runtime must live under deployments/local, which forge may read");
  if (!existsSync(path)) throw new Failure(3, "RUNTIME_MISSING", `${path} does not exist; run scripts/local-deploy-reset.sh first`);
  const runtime = JSON.parse(readFileSync(path, "utf8"));
  const address = /^0x[0-9a-fA-F]{40}$/;
  const hash = /^0x[0-9a-fA-F]{64}$/;
  if (runtime.chainId !== LOCAL_CHAIN_ID) throw new Failure(3, "CHAIN_REFUSED", `Runtime chain ${runtime.chainId} is not the local devnet`);
  for (const field of ["feeScheduleRegistry", "fundedFeeEngine", "marketRegistry", "seriesRegistry", "operator"]) {
    if (!address.test(runtime[field] ?? "")) throw new Failure(3, "RUNTIME_INVALID", `Runtime ${field} is missing`);
  }
  if (!hash.test(runtime.feeScheduleId ?? "")) throw new Failure(3, "RUNTIME_INVALID", "Runtime feeScheduleId is missing");
  if (!Array.isArray(runtime.markets) || runtime.markets.length === 0) throw new Failure(3, "RUNTIME_INVALID", "Runtime has no markets");
  for (const market of runtime.markets) {
    for (const field of ["marketId", "seriesId", "benchmarkId"]) {
      if (!hash.test(market[field] ?? "")) throw new Failure(3, "RUNTIME_INVALID", `Runtime market ${market.marketKey} lacks ${field}`);
    }
  }
  return runtime;
}

function sortKeys(value) {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

function writeRuntime(path, runtime, state) {
  const next = { ...runtime };
  next.feeScheduleVersion = state.feeScheduleVersion;
  next.makerFeeRatePpm = state.makerFeeRatePpm;
  next.takerFeeRatePpm = state.takerFeeRatePpm;
  next.markets = runtime.markets.map((market, index) =>
    sortKeys({ ...market, marketVersion: state.markets[index].marketVersion, seriesVersion: state.markets[index].seriesVersion }),
  );
  next.marketVersion = state.markets[0].marketVersion;
  next.seriesVersion = state.markets[0].seriesVersion;
  const temporary = `${path}.update.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(sortKeys(next), null, 2)}\n`);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new Failure(7, "RUNTIME_WRITE_FAILED", `The chain is updated but ${path} was not rewritten (${error.message}); rerun with the same rates`);
  }
}

function acquireLock() {
  const lockPath = resolve(localDeployments, ".update-devnet-fees.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = openSync(lockPath, "wx");
      writeFileSync(handle, `${process.pid}\n`);
      closeSync(handle);
      return () => rmSync(lockPath, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = Number(readFileSync(lockPath, "utf8").trim());
      let alive = false;
      try {
        alive = Number.isSafeInteger(holder) && holder > 0 && process.kill(holder, 0);
      } catch {
        alive = false;
      }
      if (alive) throw new Failure(4, "BUSY", `Another fee update (pid ${holder}) is running`);
      rmSync(lockPath, { force: true });
    }
  }
  throw new Failure(4, "BUSY", "Could not take the fee update lock");
}

function runForge(options, runtime) {
  const foundryBin = resolve(homedir(), ".foundry/bin");
  const env = {
    ...process.env,
    PATH: `${foundryBin}:${process.env.PATH ?? ""}`,
    SETRYN_FEE_SCHEDULE_REGISTRY: runtime.feeScheduleRegistry,
    SETRYN_FUNDED_FEE_ENGINE: runtime.fundedFeeEngine,
    SETRYN_FEE_SCHEDULE_ID: runtime.feeScheduleId,
    SETRYN_MAKER_FEE_RATE_PPM: String(options.makerPpm),
    SETRYN_TAKER_FEE_RATE_PPM: String(options.takerPpm),
    SETRYN_FEE_MAX_CHARGE_RATE_PPM: String(options.maxChargePpm ?? 0),
    SETRYN_GOVERNANCE_OPERATOR: runtime.operator,
    SETRYN_RUNTIME: options.runtime,
  };
  const args = [
    "script",
    `${contractsRoot}/script/UpdateFeeSchedule.s.sol:UpdateFeeSchedule`,
    "--root",
    contractsRoot,
    "--rpc-url",
    options.rpcUrl,
    "--sender",
    runtime.operator,
    "--unlocked",
    "--non-interactive",
    "--slow",
  ];
  if (!options.dryRun) args.push("--broadcast");
  const child = spawnSync("forge", args, { env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  process.stderr.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  if (child.error) throw new Failure(5, "FORGE_UNAVAILABLE", `forge could not run: ${child.error.message}`);
  if (child.status !== 0) throw new Failure(5, "UPDATE_FAILED", "UpdateFeeSchedule reverted or failed to broadcast; see stderr");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  requireLoopbackRpc(options.rpcUrl);
  const runtime = loadRuntime(options.runtime);
  const chainId = Number(BigInt(await rpc(options.rpcUrl, "eth_chainId", [])));
  if (chainId !== LOCAL_CHAIN_ID) throw new Failure(3, "CHAIN_REFUSED", `Chain ${chainId} is not the local devnet (${LOCAL_CHAIN_ID})`);
  const code = await rpc(options.rpcUrl, "eth_getCode", [runtime.feeScheduleRegistry, "latest"]);
  if (code === "0x") throw new Failure(3, "RUNTIME_STALE", "The runtime's FeeScheduleRegistry has no code on this chain; reset the devnet");

  const release = acquireLock();
  try {
    const before = await readChainState(options.rpcUrl, runtime);
    const unchanged = before.makerFeeRatePpm === options.makerPpm && before.takerFeeRatePpm === options.takerPpm;
    if (!before.consistent) {
      throw new Failure(6, "INCONSISTENT_STATE", "Some runtime markets or series are not on the active fee version; reset the devnet");
    }
    if (!unchanged) runForge(options, runtime);
    if (options.dryRun) {
      emit({ ok: true, dryRun: true, changed: false, chainId, feeScheduleId: runtime.feeScheduleId, feeScheduleVersion: before.feeScheduleVersion, requestedMakerFeeRatePpm: options.makerPpm, requestedTakerFeeRatePpm: options.takerPpm });
      return;
    }
    const after = unchanged ? before : await readChainState(options.rpcUrl, runtime);
    if (
      !after.consistent ||
      after.makerFeeRatePpm !== options.makerPpm ||
      after.takerFeeRatePpm !== options.takerPpm ||
      (!unchanged && after.feeScheduleVersion <= before.feeScheduleVersion)
    ) {
      throw new Failure(5, "UPDATE_NOT_OBSERVED", "The chain does not show the requested fee version on every market; see stderr");
    }
    writeRuntime(options.runtime, runtime, after);
    emit({
      ok: true,
      changed: !unchanged,
      chainId,
      feeScheduleId: runtime.feeScheduleId,
      previousFeeScheduleVersion: before.feeScheduleVersion,
      feeScheduleVersion: after.feeScheduleVersion,
      makerFeeRatePpm: after.makerFeeRatePpm,
      takerFeeRatePpm: after.takerFeeRatePpm,
      markets: after.markets,
      runtime: options.runtime,
    });
  } finally {
    release();
  }
}

main().catch((error) => {
  const failure = error instanceof Failure ? error : new Failure(1, "UNEXPECTED", error?.message ?? String(error));
  emit({ ok: false, error: { code: failure.code, message: failure.message } });
  process.exit(failure.exitCode);
});
