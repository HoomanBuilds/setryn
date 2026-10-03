import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  formatUnits,
  hashTypedData,
  http,
  keccak256,
  maxUint256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PUBLIC_ORIGIN = (process.env.SETRYN_PUBLIC_ORIGIN ?? "https://setryn.vercel.app").replace(/\/$/, "");
const RESERVATION_ORIGIN = (process.env.SETRYN_RESERVATION_ORIGIN ?? "http://127.0.0.1:3011").replace(/\/$/, "");
const LEVEL_COUNT = Number(process.env.SETRYN_SEED_LEVELS ?? "4");
const TARGET_AVAILABLE_MINOR = BigInt(process.env.SETRYN_SEED_AVAILABLE_USDC ?? "1500000") * 1_000_000n;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ZERO_HASH = `0x${"0".repeat(64)}`;
const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
const BOOK_ID_TYPEHASH = keccak256(
  stringToHex(
    "SetrynDirectBookV1(uint256 chainId,address book,address orderState,uint8 targetKind,bytes32 targetId,uint32 targetVersion,bytes32 executionModeId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 packageLegsHash)",
  ),
);
const LEVEL_ID_TYPEHASH = keccak256(stringToHex("SetrynDirectPriceLevelV1(bytes32 bookId,uint8 side,int128 priceTicks)"));
const traderKeys = (process.env.SETRYN_SEED_TRADER_PRIVATE_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
const relayerKey = process.env.SETRYN_SEED_RELAYER_PRIVATE_KEY?.trim();

if (!Number.isInteger(LEVEL_COUNT) || LEVEL_COUNT < 1 || LEVEL_COUNT > 8) throw new Error("SETRYN_SEED_LEVELS must be from 1 to 8");
if (traderKeys.length < 2 || traderKeys.some((key) => !/^0x[0-9a-fA-F]{64}$/.test(key))) {
  throw new Error("SETRYN_SEED_TRADER_PRIVATE_KEYS must contain at least two comma-separated private keys");
}
if (!/^0x[0-9a-fA-F]{64}$/.test(relayerKey ?? "")) throw new Error("SETRYN_SEED_RELAYER_PRIVATE_KEY is required");

const publicOrderComponents = [
  { name: "signer", type: "address" },
  { name: "accountId", type: "bytes32" },
  { name: "policyId", type: "bytes32" },
  { name: "policyContextHash", type: "bytes32" },
  { name: "actionId", type: "bytes32" },
  { name: "targetKind", type: "uint8" },
  { name: "seriesId", type: "bytes32" },
  { name: "packageId", type: "bytes32" },
  { name: "targetVersion", type: "uint32" },
  { name: "side", type: "uint8" },
  { name: "lots", type: "uint128" },
  { name: "priceTicks", type: "int128" },
  { name: "timeInForce", type: "uint8" },
  { name: "deadline", type: "uint64" },
  { name: "executionModeId", type: "bytes32" },
  { name: "feeScheduleId", type: "bytes32" },
  { name: "feeScheduleVersion", type: "uint32" },
  { name: "maxFeeMinor", type: "uint128" },
  { name: "recipient", type: "address" },
  { name: "permittedExecutor", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "salt", type: "bytes32" },
  { name: "allowPartialFills", type: "bool" },
  { name: "minimumFillLots", type: "uint128" },
  { name: "remainderPolicy", type: "uint8" },
  { name: "postOnly", type: "bool" },
  { name: "reduceOnly", type: "bool" },
];
const riskAuthorizationComponents = [
  { name: "orderHash", type: "bytes32" },
  { name: "accountId", type: "bytes32" },
  { name: "riskDomainId", type: "bytes32" },
  { name: "riskDomainVersion", type: "uint32" },
  { name: "maxOpenInterestBaseUnits", type: "uint128" },
  { name: "maxTerminalLiabilityBaseUnits", type: "uint128" },
  { name: "maxAdmissionDeadline", type: "uint64" },
  { name: "binder", type: "address" },
  { name: "binderTerms", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint64" },
];
const publicOrderTypes = { PublicOrder: publicOrderComponents };
const riskAuthorizationTypes = { SetrynOrderRiskAuthorizationV1: riskAuthorizationComponents };
const vaultAbi = [
  { type: "function", name: "deriveAccountId", stateMutability: "view", inputs: [{ name: "creator", type: "address" }, { name: "salt", type: "bytes32" }], outputs: [{ name: "accountId", type: "bytes32" }] },
  { type: "function", name: "deriveCollateralId", stateMutability: "view", inputs: [{ name: "assetId", type: "bytes32" }, { name: "bindingVersion", type: "uint32" }], outputs: [{ name: "collateralId", type: "bytes32" }] },
  { type: "function", name: "accountExists", stateMutability: "view", inputs: [{ name: "accountId", type: "bytes32" }], outputs: [{ name: "exists", type: "bool" }] },
  { type: "function", name: "createAccount", stateMutability: "nonpayable", inputs: [{ name: "salt", type: "bytes32" }], outputs: [{ name: "accountId", type: "bytes32" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "accountId", type: "bytes32" }, { name: "collateralId", type: "bytes32" }], outputs: [{ name: "total", type: "uint128" }, { name: "locked", type: "uint128" }, { name: "available", type: "uint128" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assetId", type: "bytes32" }, { name: "bindingVersion", type: "uint32" }, { name: "accountId", type: "bytes32" }, { name: "amount", type: "uint128" }], outputs: [] },
  { type: "function", name: "isLockOperator", stateMutability: "view", inputs: [{ name: "accountId", type: "bytes32" }, { name: "operator", type: "address" }], outputs: [{ name: "approved", type: "bool" }] },
  { type: "function", name: "setLockOperator", stateMutability: "nonpayable", inputs: [{ name: "accountId", type: "bytes32" }, { name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
];
const tokenAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "remaining", type: "uint256" }] },
  { type: "function", name: "mintTo", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "approved", type: "bool" }] },
];
const orderStateAbi = [
  { type: "function", name: "registerSignedOrder", stateMutability: "nonpayable", inputs: [{ name: "order", type: "tuple", components: publicOrderComponents }, { name: "signature", type: "bytes" }], outputs: [{ name: "orderHash", type: "bytes32" }] },
  { type: "function", name: "getOrder", stateMutability: "view", inputs: [{ name: "orderHash", type: "bytes32" }], outputs: [{ name: "record", type: "tuple", components: [{ name: "order", type: "tuple", components: publicOrderComponents }, { name: "filledLots", type: "uint128" }, { name: "status", type: "uint8" }, { name: "registeredAt", type: "uint64" }] }] },
];
const riskBindingAbi = [
  { type: "function", name: "bindOrderRiskWithAuthorization", stateMutability: "nonpayable", inputs: [{ name: "order", type: "tuple", components: publicOrderComponents }, { name: "admissionId", type: "bytes32" }, { name: "authorization", type: "tuple", components: riskAuthorizationComponents }, { name: "signature", type: "bytes" }], outputs: [{ name: "orderHash", type: "bytes32" }] },
  { type: "function", name: "admissionForOrder", stateMutability: "view", inputs: [{ name: "orderHash", type: "bytes32" }], outputs: [{ name: "admissionId", type: "bytes32" }] },
];
const riskEngineAbi = [
  { type: "function", name: "expireAdmission", stateMutability: "nonpayable", inputs: [{ name: "admissionId", type: "bytes32" }], outputs: [] },
  {
    type: "event",
    name: "RiskAdmissionReserved",
    inputs: [
      { name: "admissionId", type: "bytes32", indexed: true },
      { name: "accountId", type: "bytes32", indexed: true },
      { name: "riskDomainId", type: "bytes32", indexed: true },
      { name: "riskDomainVersion", type: "uint32", indexed: false },
      { name: "requestHash", type: "bytes32", indexed: false },
      { name: "resultHash", type: "bytes32", indexed: false },
      { name: "openInterestBaseUnits", type: "uint128", indexed: false },
      { name: "terminalLiabilityBaseUnits", type: "uint128", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
    ],
  },
];
const publicOrderBookAbi = [
  { type: "function", name: "placeSeriesOrder", stateMutability: "nonpayable", inputs: [{ name: "orderHash", type: "bytes32" }, { name: "hint", type: "tuple", components: [{ name: "previousLevelId", type: "bytes32" }, { name: "nextLevelId", type: "bytes32" }] }], outputs: [{ name: "bookId", type: "bytes32" }] },
  { type: "function", name: "syncOrder", stateMutability: "nonpayable", inputs: [{ name: "orderHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "bestLevel", stateMutability: "view", inputs: [{ name: "bookId", type: "bytes32" }, { name: "side", type: "uint8" }], outputs: [{ name: "levelId", type: "bytes32" }] },
  { type: "function", name: "getPriceLevel", stateMutability: "view", inputs: [{ name: "levelId", type: "bytes32" }], outputs: [{ name: "level", type: "tuple", components: [{ name: "bookId", type: "bytes32" }, { name: "levelId", type: "bytes32" }, { name: "previousLevelId", type: "bytes32" }, { name: "nextLevelId", type: "bytes32" }, { name: "headOrderHash", type: "bytes32" }, { name: "tailOrderHash", type: "bytes32" }, { name: "priceTicks", type: "int128" }, { name: "totalLots", type: "uint256" }, { name: "orderCount", type: "uint64" }, { name: "side", type: "uint8" }, { name: "active", type: "bool" }] }] },
  { type: "function", name: "getBookOrder", stateMutability: "view", inputs: [{ name: "orderHash", type: "bytes32" }], outputs: [{ name: "order", type: "tuple", components: [{ name: "bookId", type: "bytes32" }, { name: "orderHash", type: "bytes32" }, { name: "levelId", type: "bytes32" }, { name: "previousOrderHash", type: "bytes32" }, { name: "nextOrderHash", type: "bytes32" }, { name: "sequence", type: "uint64" }, { name: "remainingLots", type: "uint128" }, { name: "priceTicks", type: "int128" }, { name: "side", type: "uint8" }, { name: "status", type: "uint8" }] }] },
];
const multicallAbi = [
  { type: "function", name: "aggregate3", stateMutability: "payable", inputs: [{ name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" }] }], outputs: [{ name: "returnData", type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }] },
];

function domain(runtime, verifyingContract) {
  return { name: "Setryn", version: "1", chainId: runtime.chainId, verifyingContract };
}

function serialize(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)]));
  return value;
}

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

function bookId(runtime, market) {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint8" },
      { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint32" },
      { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" },
    ],
    [BOOK_ID_TYPEHASH, BigInt(runtime.chainId), runtime.publicOrderBook, runtime.orderState, 1, market.seriesId,
      market.seriesVersion ?? 1, runtime.executionModeId, runtime.settlementAssetId, 1, runtime.feeScheduleId,
      market.feeScheduleVersion ?? runtime.feeScheduleVersion ?? 1, ZERO_HASH],
  ));
}

function levelId(id, side, priceTicks) {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "int128" }], [LEVEL_ID_TYPEHASH, id, side, priceTicks]));
}

function isBefore(side, left, right) {
  return side === 1 ? left > right : left < right;
}

function insertHint(chain, id, side, priceTicks) {
  let previousLevelId = ZERO_HASH;
  for (let index = 0; index < chain.length; index += 1) {
    const level = chain[index];
    if (level.priceTicks === priceTicks) return { previousLevelId: ZERO_HASH, nextLevelId: ZERO_HASH };
    if (!isBefore(side, level.priceTicks, priceTicks)) {
      const incoming = { id: levelId(id, side, priceTicks), priceTicks };
      chain.splice(index, 0, incoming);
      return { previousLevelId, nextLevelId: level.id };
    }
    previousLevelId = level.id;
  }
  chain.push({ id: levelId(id, side, priceTicks), priceTicks });
  return { previousLevelId, nextLevelId: ZERO_HASH };
}

async function readLevelChain(publicClient, runtime, id, side) {
  let current = await publicClient.readContract({ address: runtime.publicOrderBook, abi: publicOrderBookAbi, functionName: "bestLevel", args: [id, side] }).catch(() => ZERO_HASH);
  const levels = [];
  while (current !== ZERO_HASH && levels.length < 64) {
    const level = await publicClient.readContract({ address: runtime.publicOrderBook, abi: publicOrderBookAbi, functionName: "getPriceLevel", args: [current] });
    if (!level.active) break;
    levels.push({ id: current, priceTicks: level.priceTicks });
    current = level.nextLevelId;
  }
  return levels;
}

async function expiredBookOrders(publicClient, runtime, now) {
  const expired = [];
  for (const market of runtime.markets) {
    const id = bookId(runtime, market);
    for (const side of [1, 2]) {
      let levelIdCursor = await publicClient.readContract({ address: runtime.publicOrderBook, abi: publicOrderBookAbi, functionName: "bestLevel", args: [id, side] }).catch(() => ZERO_HASH);
      while (levelIdCursor !== ZERO_HASH) {
        const level = await publicClient.readContract({ address: runtime.publicOrderBook, abi: publicOrderBookAbi, functionName: "getPriceLevel", args: [levelIdCursor] });
        let orderHash = level.headOrderHash;
        while (orderHash !== ZERO_HASH) {
          const [bookOrder, record] = await Promise.all([
            publicClient.readContract({ address: runtime.publicOrderBook, abi: publicOrderBookAbi, functionName: "getBookOrder", args: [orderHash] }),
            publicClient.readContract({ address: runtime.orderState, abi: orderStateAbi, functionName: "getOrder", args: [orderHash] }),
          ]);
          if (bookOrder.status === 1 && record.order.deadline < now) expired.push(orderHash);
          orderHash = bookOrder.nextOrderHash;
        }
        levelIdCursor = level.nextLevelId;
      }
    }
  }
  return expired;
}

async function cleanupExpiredDepth(publicClient, runtime, wallets) {
  const block = await publicClient.getBlock({ blockTag: "pending" });
  const expired = await expiredBookOrders(publicClient, runtime, block.timestamp);
  if (expired.length === 0) return 0;
  const admissions = await Promise.all(expired.map((orderHash) =>
    publicClient.readContract({
      address: runtime.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "admissionForOrder",
      args: [orderHash],
    }).catch(() => ZERO_HASH),
  ));
  const chunks = [];
  for (let start = 0; start < expired.length; start += 20) {
    chunks.push(expired.slice(start, start + 20).map((orderHash, offset) => ({ orderHash, admissionId: admissions[start + offset] })));
  }
  await Promise.all(chunks.map(async (entries, index) => {
    const wallet = wallets[index % wallets.length];
    const calls = entries.flatMap(({ orderHash, admissionId }) => [
      {
        target: runtime.publicOrderBook,
        allowFailure: false,
        callData: encodeFunctionData({ abi: publicOrderBookAbi, functionName: "syncOrder", args: [orderHash] }),
      },
      ...(admissionId === ZERO_HASH ? [] : [{
        target: runtime.portfolioRiskEngine,
        allowFailure: true,
        callData: encodeFunctionData({ abi: riskEngineAbi, functionName: "expireAdmission", args: [admissionId] }),
      }]),
    ]);
    const request = { address: MULTICALL3, abi: multicallAbi, functionName: "aggregate3", args: [calls] };
    const gas = await publicClient.estimateContractGas({ account: wallet.account, ...request });
    const hash = await wallet.writeContract({ ...request, gas: (gas * 115n) / 100n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Expired-order cleanup reverted: ${hash}`);
  }));
  console.log(`expired public orders removed: ${expired.length}`);
  return expired.length;
}

async function sweepExpiredAdmissions(publicClient, runtime, wallets) {
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  const now = (await publicClient.getBlock({ blockNumber: latest })).timestamp;
  const candidates = new Set();
  const step = 25_000n;
  for (let from = BigInt(runtime.deploymentBlock); from <= latest; from += step) {
    const to = from + step - 1n > latest ? latest : from + step - 1n;
    const events = await publicClient.getContractEvents({
      address: runtime.portfolioRiskEngine,
      abi: riskEngineAbi,
      eventName: "RiskAdmissionReserved",
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    for (const event of events) {
      if (event.args.deadline < now) candidates.add(event.args.admissionId);
    }
  }
  const admissions = [...candidates];
  const chunks = [];
  for (let start = 0; start < admissions.length; start += 30) chunks.push(admissions.slice(start, start + 30));
  const queues = wallets.map(() => Promise.resolve());
  const scheduled = chunks.map((ids, index) => {
    const walletIndex = index % wallets.length;
    const wallet = wallets[walletIndex];
    const run = queues[walletIndex].then(async () => {
      const calls = ids.map((admissionId) => ({
        target: runtime.portfolioRiskEngine,
        allowFailure: true,
        callData: encodeFunctionData({ abi: riskEngineAbi, functionName: "expireAdmission", args: [admissionId] }),
      }));
      const request = { address: MULTICALL3, abi: multicallAbi, functionName: "aggregate3", args: [calls] };
      const gas = await publicClient.estimateContractGas({ account: wallet.account, ...request });
      const hash = await wallet.writeContract({ ...request, gas: (gas * 115n) / 100n });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Expired-admission sweep reverted: ${hash}`);
    });
    queues[walletIndex] = run.catch(() => undefined);
    return run;
  });
  await Promise.all(scheduled);
  if (admissions.length > 0) console.log(`expired risk admissions checked: ${admissions.length}`);
  return admissions.length;
}

async function write(publicClient, walletClient, label, request) {
  const { request: simulated } = await publicClient.simulateContract({ account: walletClient.account, ...request });
  const hash = await walletClient.writeContract(simulated);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  return receipt;
}

async function prepareTrader(publicClient, walletClient, runtime, collateralId) {
  const address = walletClient.account.address;
  const accountId = await publicClient.readContract({ address: runtime.collateralVault, abi: vaultAbi, functionName: "deriveAccountId", args: [address, ACCOUNT_SALT] });
  const exists = await publicClient.readContract({ address: runtime.collateralVault, abi: vaultAbi, functionName: "accountExists", args: [accountId] });
  if (!exists) await write(publicClient, walletClient, "create account", { address: runtime.collateralVault, abi: vaultAbi, functionName: "createAccount", args: [ACCOUNT_SALT] });
  let balance = await publicClient.readContract({ address: runtime.collateralVault, abi: vaultAbi, functionName: "balanceOf", args: [accountId, collateralId] });
  const shortfall = balance[2] >= TARGET_AVAILABLE_MINOR ? 0n : TARGET_AVAILABLE_MINOR - balance[2];
  if (shortfall > 0n) {
    const walletBalance = await publicClient.readContract({ address: runtime.settlementToken, abi: tokenAbi, functionName: "balanceOf", args: [address] });
    if (walletBalance < shortfall) {
      await write(publicClient, walletClient, "mint test collateral", { address: runtime.settlementToken, abi: tokenAbi, functionName: "mintTo", args: [address, shortfall - walletBalance] });
    }
    const allowance = await publicClient.readContract({ address: runtime.settlementToken, abi: tokenAbi, functionName: "allowance", args: [address, runtime.collateralVault] });
    if (allowance < shortfall) await write(publicClient, walletClient, "approve vault", { address: runtime.settlementToken, abi: tokenAbi, functionName: "approve", args: [runtime.collateralVault, maxUint256] });
    await write(publicClient, walletClient, "deposit collateral", { address: runtime.collateralVault, abi: vaultAbi, functionName: "deposit", args: [runtime.settlementAssetId, 1, accountId, shortfall] });
  }
  for (const operator of [runtime.atomicClearingEngine, runtime.positionEngine]) {
    const approved = await publicClient.readContract({ address: runtime.collateralVault, abi: vaultAbi, functionName: "isLockOperator", args: [accountId, operator] });
    if (!approved) await write(publicClient, walletClient, "approve lock operator", { address: runtime.collateralVault, abi: vaultAbi, functionName: "setLockOperator", args: [accountId, operator, true] });
  }
  balance = await publicClient.readContract({ address: runtime.collateralVault, abi: vaultAbi, functionName: "balanceOf", args: [accountId, collateralId] });
  return { address, accountId, available: balance[2] };
}

function orderFeeMinor(runtime, market, lots, priceTicks) {
  const consideration = lots * (priceTicks < 0n ? -priceTicks : priceTicks) * BigInt(market.tickSizeMinor);
  const rate = BigInt(Math.max(runtime.makerFeeRatePpm ?? 500, runtime.takerFeeRatePpm ?? 1000));
  const fee = (consideration * rate + 999_999n) / 1_000_000n;
  return (fee > 0n ? fee : 1n) * 2n;
}

async function buildOrder(runtime, market, quoteState, trader, side, level, deadline) {
  const percentages = [0.0015, 0.0035, 0.0065, 0.01, 0.015, 0.022, 0.03, 0.04];
  const sizes = [3n, 5n, 7n, 9n, 12n, 15n, 18n, 22n];
  const touch = side === 1 ? quoteState.bid : quoteState.ask;
  if (!touch) throw new Error(`No firm ${side === 1 ? "bid" : "ask"} for ${market.marketKey}`);
  const distanceTicks = BigInt(Math.max(2, Math.round(Math.abs(touch.price) * percentages[level] * market.priceScale)));
  const touchTicks = BigInt(touch.priceTicks);
  const priceTicks = side === 1 ? touchTicks - distanceTicks : touchTicks + distanceTicks;
  const lots = sizes[level];
  const nonce = BigInt(`0x${randomBytes(24).toString("hex")}`);
  const order = {
    signer: trader.address,
    accountId: trader.accountId,
    policyId: PUBLIC_SERIES_POLICY,
    policyContextHash: keccak256(stringToHex(`${market.marketKey}:SEEDED_PUBLIC_DEPTH:${side}:${level}`)),
    actionId: runtime.enterActionId,
    targetKind: 1,
    seriesId: market.seriesId,
    packageId: ZERO_HASH,
    targetVersion: market.seriesVersion ?? 1,
    side,
    lots,
    priceTicks,
    timeInForce: 1,
    deadline,
    executionModeId: runtime.executionModeId,
    feeScheduleId: runtime.feeScheduleId,
    feeScheduleVersion: market.feeScheduleVersion ?? runtime.feeScheduleVersion ?? 1,
    maxFeeMinor: orderFeeMinor(runtime, market, lots, priceTicks),
    recipient: trader.address,
    permittedExecutor: runtime.atomicClearingEngine,
    nonce,
    salt: keccak256(randomBytes(32)),
    allowPartialFills: true,
    minimumFillLots: 1n,
    remainderPolicy: 1,
    postOnly: true,
    reduceOnly: false,
  };
  const orderDomain = domain(runtime, runtime.orderState);
  const orderHash = hashTypedData({ domain: orderDomain, types: publicOrderTypes, primaryType: "PublicOrder", message: order });
  const orderSignature = await trader.account.signTypedData({ domain: orderDomain, types: publicOrderTypes, primaryType: "PublicOrder", message: order });
  const risk = {
    orderHash,
    accountId: trader.accountId,
    riskDomainId: runtime.riskDomainId,
    riskDomainVersion: 1,
    maxOpenInterestBaseUnits: lots,
    maxTerminalLiabilityBaseUnits: lots * BigInt(side === 1 ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot),
    maxAdmissionDeadline: deadline,
    binder: MULTICALL3,
    binderTerms: keccak256(stringToHex(`${market.marketKey}:DEPTH_BATCH:${deadline}`)),
    nonce,
    deadline,
  };
  const riskDomain = domain(runtime, runtime.riskAdmissionBindingRegistry);
  const riskSignature = await trader.account.signTypedData({ domain: riskDomain, types: riskAuthorizationTypes, primaryType: "SetrynOrderRiskAuthorizationV1", message: risk });
  return { order, orderHash, orderSignature, risk, riskSignature, side, level, lots, priceTicks, trader: trader.address };
}

async function reserve(order) {
  return json(`${RESERVATION_ORIGIN}/api/internal/orders/reserve-risk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order: serialize(order.order), signature: order.orderSignature, orderHash: order.orderHash }),
  });
}

async function freshQuoteState(marketKey) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const quoteBook = await json(`${PUBLIC_ORIGIN}/api/quotes`);
    const state = quoteBook.markets?.[marketKey];
    if (state?.status === "FIRM" && state.bid && state.ask && state.bid.expiresAt - Date.now() / 1_000 >= 12 && state.ask.expiresAt - Date.now() / 1_000 >= 12) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`No two-sided firm quote for ${marketKey}`);
}

const runtime = await json(`${PUBLIC_ORIGIN}/api/internal/runtime`);
if (runtime.chainId !== 421614 || runtime.network !== "arbitrum-sepolia") throw new Error("Refusing to run outside Arbitrum Sepolia");
if (!runtime.settlementTokenMintable) throw new Error("The live runtime is not using Setryn test collateral");
const rpcUrl = process.env.SETRYN_RPC_URL ?? process.env.ARBITRUM_SEPOLIA_RPC_URL;
if (!rpcUrl) throw new Error("SETRYN_RPC_URL or ARBITRUM_SEPOLIA_RPC_URL is required");
const chain = defineChain({ id: runtime.chainId, name: "Arbitrum Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } }, testnet: true });
const transport = http(rpcUrl, { timeout: 20_000, retryCount: 3, retryDelay: 500 });
const publicClient = createPublicClient({ chain, transport, pollingInterval: 500 });
if ((await publicClient.getChainId()) !== 421614) throw new Error("RPC chain mismatch");
if ((await publicClient.getCode({ address: MULTICALL3 })) === undefined) throw new Error("Multicall3 is not deployed");
const traderAccounts = traderKeys.map((key) => privateKeyToAccount(key));
const traderWallets = traderAccounts.map((account) => createWalletClient({ account, chain, transport }));
const relayerAccount = privateKeyToAccount(relayerKey);
const batchWallets = traderWallets;
const collateralId = await publicClient.readContract({ address: runtime.collateralVault, abi: vaultAbi, functionName: "deriveCollateralId", args: [runtime.settlementAssetId, 1] });
console.log(`network: ${runtime.network}; markets: ${runtime.markets.length}; levels per side: ${LEVEL_COUNT}`);
console.log(`batch relayer: ${relayerAccount.address}; balance: ${formatEther(await publicClient.getBalance({ address: relayerAccount.address }))} ETH`);

const prepared = await Promise.all(traderWallets.map((wallet) => prepareTrader(publicClient, wallet, runtime, collateralId)));
const traders = prepared.map((entry, index) => ({ ...entry, account: traderAccounts[index], wallet: traderWallets[index] }));
for (const trader of traders) console.log(`trader ${trader.address}: ${formatUnits(trader.available, 6)} tUSDC available`);
await sweepExpiredAdmissions(publicClient, runtime, batchWallets);
await cleanupExpiredDepth(publicClient, runtime, batchWallets);

async function seedMarket(market, marketIndex, batchWallet) {
  const quoteState = await freshQuoteState(market.marketKey);
  const block = await publicClient.getBlock({ blockTag: "pending" });
  const deadline = block.timestamp + 295n;
  const drafts = [];
  for (const side of [1, 2]) {
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      const trader = traders[(marketIndex * LEVEL_COUNT * 2 + (side - 1) * LEVEL_COUNT + level) % traders.length];
      drafts.push(await buildOrder(runtime, market, quoteState, trader, side, level, deadline));
    }
  }
  const reservations = await Promise.all(drafts.map(reserve));
  const id = bookId(runtime, market);
  const [bids, asks] = await Promise.all([readLevelChain(publicClient, runtime, id, 1), readLevelChain(publicClient, runtime, id, 2)]);
  const calls = [];
  for (const [index, draft] of drafts.entries()) {
    const authorizationCall = encodeFunctionData({ abi: riskBindingAbi, functionName: "bindOrderRiskWithAuthorization", args: [draft.order, reservations[index].admissionId, draft.risk, draft.riskSignature] });
    const registrationCall = encodeFunctionData({ abi: orderStateAbi, functionName: "registerSignedOrder", args: [draft.order, draft.orderSignature] });
    const hint = insertHint(draft.side === 1 ? bids : asks, id, draft.side, draft.priceTicks);
    const placementCall = encodeFunctionData({ abi: publicOrderBookAbi, functionName: "placeSeriesOrder", args: [draft.orderHash, hint] });
    calls.push(
      { target: runtime.riskAdmissionBindingRegistry, allowFailure: false, callData: authorizationCall },
      { target: runtime.orderState, allowFailure: false, callData: registrationCall },
      { target: runtime.publicOrderBook, allowFailure: false, callData: placementCall },
    );
  }
  const request = { address: MULTICALL3, abi: multicallAbi, functionName: "aggregate3", args: [calls] };
  const gas = await publicClient.estimateContractGas({ account: batchWallet.account, ...request });
  const hash = await batchWallet.writeContract({ ...request, gas: (gas * 115n) / 100n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${market.marketKey} depth batch reverted: ${hash}`);
  console.log(`${market.marketKey}: ${drafts.length} orders placed in ${hash}; gas ${receipt.gasUsed}`);
  return { market: market.marketKey, transactionHash: hash, orders: drafts.length, gasUsed: receipt.gasUsed.toString() };
}

const batches = [];
const queues = batchWallets.map(() => Promise.resolve());
const scheduled = runtime.markets.map((market, marketIndex) => {
  const walletIndex = marketIndex % batchWallets.length;
  const run = queues[walletIndex].then(() => seedMarket(market, marketIndex, batchWallets[walletIndex]));
  queues[walletIndex] = run.catch(() => undefined);
  return run;
});
for (const batch of await Promise.all(scheduled)) {
  batches.push(batch);
}

console.log(JSON.stringify({ placed: batches.reduce((total, batch) => total + batch.orders, 0), markets: batches.length, batches }));
