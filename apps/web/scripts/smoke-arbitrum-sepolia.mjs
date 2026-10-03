import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatEther,
  formatUnits,
  hashTypedData,
  http,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ORIGIN = process.env.SETRYN_PUBLIC_ORIGIN?.replace(/\/$/, "") ?? "https://setryn.vercel.app";
const MARKET_KEY = process.env.SETRYN_SMOKE_MARKET ?? "ETH-FC-24DEC26";
const DEPOSIT_MINOR = 5_000n * 1_000_000n;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
const TAKER_TERMS_TYPEHASH = keccak256(
  stringToHex(
    "SetrynTakerSettlementTermsV1(bytes32 quoteOrderHash,address relayer,bytes32 relayerAccountId,uint128 maxRelayerFeeMinor,bytes32 closePositionId)",
  ),
);

const privateKey = process.env.SETRYN_TEST_TAKER_PRIVATE_KEY;
const rpcUrl = process.env.SETRYN_RPC_URL ?? process.env.ARBITRUM_SEPOLIA_RPC_URL;
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "")) throw new Error("SETRYN_TEST_TAKER_PRIVATE_KEY is required");
if (!rpcUrl) throw new Error("ARBITRUM_SEPOLIA_RPC_URL is required");

const account = privateKeyToAccount(privateKey);
const chain = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 1_000 });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

const vaultAbi = [
  {
    type: "function",
    name: "deriveAccountId",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "accountId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "deriveCollateralId",
    stateMutability: "view",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
    ],
    outputs: [{ name: "collateralId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "accountExists",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "bytes32" }],
    outputs: [{ name: "exists", type: "bool" }],
  },
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ name: "accountId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "collateralId", type: "bytes32" },
    ],
    outputs: [
      { name: "total", type: "uint128" },
      { name: "locked", type: "uint128" },
      { name: "available", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
      { name: "accountId", type: "bytes32" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isLockOperator",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    type: "function",
    name: "setLockOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
];

const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
];

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
const publicOrderTypes = { PublicOrder: publicOrderComponents };
const riskTypes = {
  SetrynOrderRiskAuthorizationV1: [
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
  ],
};

function domain(runtime, verifyingContract) {
  return { name: "Setryn", version: "1", chainId: runtime.chainId, verifyingContract };
}

function takerTermsHash(terms) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "uint128" }, { type: "bytes32" }],
      [
        TAKER_TERMS_TYPEHASH,
        terms.quoteOrderHash,
        terms.relayer,
        terms.relayerAccountId,
        terms.maxRelayerFeeMinor,
        terms.closePositionId,
      ],
    ),
  );
}

function serializable(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializable(entry)]));
  return value;
}

async function json(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function write(label, address, abi, functionName, args) {
  const hash = await walletClient.writeContract({ account, chain, address, abi, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

async function prepareAccount(runtime) {
  const accountId = await publicClient.readContract({
    address: runtime.collateralVault,
    abi: vaultAbi,
    functionName: "deriveAccountId",
    args: [account.address, ACCOUNT_SALT],
  });
  const collateralId = await publicClient.readContract({
    address: runtime.collateralVault,
    abi: vaultAbi,
    functionName: "deriveCollateralId",
    args: [runtime.settlementAssetId, 1],
  });
  const exists = await publicClient.readContract({
    address: runtime.collateralVault,
    abi: vaultAbi,
    functionName: "accountExists",
    args: [accountId],
  });
  if (!exists) await write("create account", runtime.collateralVault, vaultAbi, "createAccount", [ACCOUNT_SALT]);

  const current = await publicClient.readContract({
    address: runtime.collateralVault,
    abi: vaultAbi,
    functionName: "balanceOf",
    args: [accountId, collateralId],
  });
  const shortfall = current[2] >= DEPOSIT_MINOR ? 0n : DEPOSIT_MINOR - current[2];
  if (shortfall > 0n) {
    let walletBalance = await publicClient.readContract({
      address: runtime.settlementToken,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (walletBalance < shortfall) {
      const funded = await json(`${ORIGIN}/api/internal/operator/fund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: account.address, asset: "USDC" }),
      });
      console.log(`test collateral funded: ${funded.transactionHash}`);
      walletBalance = await publicClient.readContract({
        address: runtime.settlementToken,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [account.address],
      });
    }
    if (walletBalance < shortfall) throw new Error("Faucet did not provide enough test collateral");
    const allowance = await publicClient.readContract({
      address: runtime.settlementToken,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account.address, runtime.collateralVault],
    });
    if (allowance < shortfall) await write("approve vault", runtime.settlementToken, tokenAbi, "approve", [runtime.collateralVault, shortfall]);
    await write("deposit collateral", runtime.collateralVault, vaultAbi, "deposit", [runtime.settlementAssetId, 1, accountId, shortfall]);
  }

  for (const operator of [runtime.atomicClearingEngine, runtime.positionEngine]) {
    const approved = await publicClient.readContract({
      address: runtime.collateralVault,
      abi: vaultAbi,
      functionName: "isLockOperator",
      args: [accountId, operator],
    });
    if (!approved) await write(`approve lock operator ${operator}`, runtime.collateralVault, vaultAbi, "setLockOperator", [accountId, operator, true]);
  }
  const ready = await publicClient.readContract({
    address: runtime.collateralVault,
    abi: vaultAbi,
    functionName: "balanceOf",
    args: [accountId, collateralId],
  });
  console.log(`vault available: ${formatUnits(ready[2], 6)} tUSDC`);
  return accountId;
}

async function freshAsk() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const book = await json(`${ORIGIN}/api/quotes`);
    const state = book.markets?.[MARKET_KEY];
    if (state?.status === "FIRM" && state.ask && state.ask.expiresAt - Date.now() / 1_000 >= 8) return state.ask;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`No executable maker ask for ${MARKET_KEY}`);
}

async function settle(runtime, market, accountId) {
  const quote = await freshAsk();
  const lots = 1n;
  const priceTicks = BigInt(quote.priceTicks);
  const deadline = BigInt(quote.expiresAt);
  const nonce = BigInt(`0x${randomBytes(24).toString("hex")}`);
  const notionalMinor = lots * (priceTicks < 0n ? -priceTicks : priceTicks) * BigInt(market.tickSizeMinor);
  const feeRate = BigInt(runtime.takerFeeRatePpm ?? 1_000);
  const maxFeeMinor = (notionalMinor * feeRate + 999_999n) / 1_000_000n || 1n;
  const order = {
    signer: account.address,
    accountId,
    policyId: PUBLIC_SERIES_POLICY,
    policyContextHash: keccak256(stringToHex(`${MARKET_KEY}:FIRM_QUOTE:LONG:FOK:Package atomic`)),
    actionId: runtime.enterActionId,
    targetKind: 1,
    seriesId: market.seriesId,
    packageId: ZERO_HASH,
    targetVersion: quote.order.targetVersion,
    side: 1,
    lots,
    priceTicks,
    timeInForce: 4,
    deadline,
    executionModeId: runtime.executionModeId,
    feeScheduleId: runtime.feeScheduleId,
    feeScheduleVersion: quote.order.feeScheduleVersion,
    maxFeeMinor,
    recipient: account.address,
    permittedExecutor: runtime.atomicClearingEngine,
    nonce,
    salt: keccak256(randomBytes(32)),
    allowPartialFills: false,
    minimumFillLots: lots,
    remainderPolicy: 2,
    postOnly: false,
    reduceOnly: false,
  };
  const orderDomain = domain(runtime, runtime.orderState);
  const orderHash = hashTypedData({ domain: orderDomain, types: publicOrderTypes, primaryType: "PublicOrder", message: order });
  const orderSignature = await account.signTypedData({ domain: orderDomain, types: publicOrderTypes, primaryType: "PublicOrder", message: order });
  const terms = {
    quoteOrderHash: quote.id,
    relayer: ZERO_ADDRESS,
    relayerAccountId: ZERO_HASH,
    maxRelayerFeeMinor: 0n,
    closePositionId: ZERO_HASH,
  };
  const risk = {
    orderHash,
    accountId,
    riskDomainId: runtime.riskDomainId,
    riskDomainVersion: 1,
    maxOpenInterestBaseUnits: lots,
    maxTerminalLiabilityBaseUnits: lots * BigInt(market.maxLongDebitMinorPerLot),
    maxAdmissionDeadline: deadline + 60n,
    binder: runtime.quoteSettlementRouter,
    binderTerms: takerTermsHash(terms),
    nonce,
    deadline,
  };
  const riskSignature = await account.signTypedData({
    domain: domain(runtime, runtime.riskAdmissionBindingRegistry),
    types: riskTypes,
    primaryType: "SetrynOrderRiskAuthorizationV1",
    message: risk,
  });
  const settlement = {
    quote: {
      order: quote.order,
      orderSignature: quote.orderSignature,
      risk: quote.risk,
      riskSignature: quote.riskSignature,
      terms: { capacityId: quote.capacityId, allowsOffsetUnwind: quote.allowsOffsetUnwind },
    },
    taker: { order: serializable(order), orderSignature, risk: serializable(risk), riskSignature, terms: serializable(terms) },
    fillLots: "1",
    relayerFeeMinor: "0",
    payoffTerms: market.payoffTerms,
  };
  const relayed = await json(`${ORIGIN}/api/quotes/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settlement),
  });
  console.log(`settlement submitted: ${relayed.transactionHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: relayed.transactionHash });
  if (receipt.status !== "success") throw new Error(`Settlement reverted: ${relayed.transactionHash}`);
  const routerLog = receipt.logs.find((log) => log.address.toLowerCase() === runtime.quoteSettlementRouter.toLowerCase() && log.topics.length === 4);
  console.log(`settlement confirmed: block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
  return { transactionHash: relayed.transactionHash, fillId: routerLog?.topics[1] ?? null, quoteId: quote.id, price: quote.price };
}

const runtime = await json(`${ORIGIN}/api/internal/runtime`);
if (runtime.chainId !== 421614 || runtime.network !== "arbitrum-sepolia") throw new Error("Refusing to run outside Arbitrum Sepolia");
if (!runtime.settlementTokenMintable) throw new Error("Smoke test requires the mintable Sepolia settlement token");
if ((await publicClient.getChainId()) !== runtime.chainId) throw new Error("RPC chain does not match the live runtime");
const nativeBalance = await publicClient.getBalance({ address: account.address });
if (nativeBalance === 0n) throw new Error("Test taker has no Arbitrum Sepolia ETH");
console.log(`taker: ${account.address}`);
console.log(`native balance: ${formatEther(nativeBalance)} ETH`);
const market = runtime.markets.find((candidate) => candidate.marketKey === MARKET_KEY);
if (!market) throw new Error(`Unknown live market: ${MARKET_KEY}`);
const accountId = await prepareAccount(runtime);
const result = await settle(runtime, market, accountId);
console.log(JSON.stringify({ market: MARKET_KEY, accountId, ...result }));
