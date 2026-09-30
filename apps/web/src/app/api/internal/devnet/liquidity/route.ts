import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  orderStateAbi,
  publicOrderBookAbi,
  publicOrderTypedData,
  riskBindingAbi,
  riskEngineAbi,
  serializePublicOrder,
  type OnchainPublicOrder,
} from "@/lib/internal-gateway/protocol";
import type { SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import { deriveSeriesBookId, priceToTicks } from "@/lib/internal-gateway/runtime-markets";
import { withDevnetMakerLock } from "@/lib/internal-gateway/devnet-maker-lock";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";
import { MARKETS } from "@/lib/terminal/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZERO_ID = `0x${"0".repeat(64)}` as Hex;
const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
const MAKER_POLICY_CONTEXT = keccak256(stringToHex("SETRYN_DEVNET_MAKER_PUBLIC_SERIES_V1"));

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
] as const;

const tokenAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
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
] as const;

const riskExpiryAbi = [
  {
    type: "function",
    name: "expireAdmission",
    stateMutability: "nonpayable",
    inputs: [{ name: "admissionId", type: "bytes32" }],
    outputs: [],
  },
] as const;

type LocalRuntime = Awaited<ReturnType<typeof readLocalRuntime>>;

/** Maker collateral: enough to rest both sides of every market at once, with room for the positions it fills. */
const MAKER_FUNDING = parseUnits("5000000", 6);
const MAKER_LOTS = 10;

/**
 * The maker's two-sided quote for one market: the top of book the preview feed shows for it, on the market's onchain
 * tick grid. The terminal renders the same catalog market, so the resting book, the marks, and the routes agree.
 */
function makerQuotes(market: SetrynRuntimeMarket): { side: 1 | 2; priceTicks: bigint }[] {
  const preview = MARKETS.find((candidate) => candidate.id === market.marketKey);
  if (!preview) throw new Error(`MARKET_NOT_IN_CATALOG:${market.marketKey}`);
  const bid = priceToTicks(market, preview.bestBid);
  const ask = priceToTicks(market, preview.bestAsk);
  if (bid >= ask) throw new Error(`MARKET_QUOTE_CROSSED:${market.marketKey}`);
  return [
    { side: 1, priceTicks: bid },
    { side: 2, priceTicks: ask },
  ];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { marketId?: unknown };
    const setryn = await readLocalRuntime();
    const markets = typeof body.marketId === "string"
      ? setryn.markets.filter((market) => market.marketKey === body.marketId)
      : setryn.markets;
    if (markets.length === 0) return Response.json({ error: "MARKET_NOT_ONCHAIN_ENABLED" }, { status: 404 });
    const maker = getAddress(setryn.operator);
    const publicClient = createPublicClient({ transport: http(setryn.rpcUrl), pollingInterval: 250 });
    const walletClient = createWalletClient({ account: maker, transport: http(setryn.rpcUrl) });
    const accountId = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "deriveAccountId",
      args: [maker, ACCOUNT_SALT],
    });
    const exists = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "accountExists",
      args: [accountId],
    });
    if (!exists) {
      const createHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "createAccount",
        args: [ACCOUNT_SALT],
      });
      await publicClient.waitForTransactionReceipt({ hash: createHash });
      const mintHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "mint",
        args: [MAKER_FUNDING],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintHash });
      const approvalHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "approve",
        args: [setryn.collateralVault, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      const depositHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "deposit",
        args: [setryn.settlementAssetId, 1, accountId, MAKER_FUNDING],
      });
      await publicClient.waitForTransactionReceipt({ hash: depositHash });
    }
    for (const operator of [setryn.atomicClearingEngine, setryn.positionEngine]) {
      const lockApproved = await publicClient.readContract({
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "isLockOperator",
        args: [accountId, operator],
      });
      if (!lockApproved) {
        const lockHash = await walletClient.writeContract({
          account: maker,
          chain: null,
          address: setryn.collateralVault,
          abi: vaultAbi,
          functionName: "setLockOperator",
          args: [accountId, operator, true],
        });
        await publicClient.waitForTransactionReceipt({ hash: lockHash });
      }
    }

    const context = { setryn, maker, accountId, publicClient, walletClient, requestUrl: request.url };
    const created: { marketId: string; orderHash: Hex }[] = [];
    // One maker account signs every quote, so markets are quoted in turn under the maker lock. Each market holds the
    // lock on its own, so a single-market refresh from a taker's order waits for at most one market ahead of it.
    // A market that cannot be quoted is reported without holding back the others.
    const failed: { marketId: string; error: string }[] = [];
    for (const market of markets) {
      try {
        const hashes = await withDevnetMakerLock(() => quoteMarket(context, market));
        for (const orderHash of hashes) created.push({ marketId: market.marketKey, orderHash });
      } catch (error) {
        failed.push({ marketId: market.marketKey, error: error instanceof Error ? error.message.split("\n")[0] : "QUOTE_FAILED" });
      }
    }
    // Every requested market failing is a failed refresh; a partial one still returns what it placed.
    const status = failed.length === markets.length ? 422 : 200;
    return Response.json(
      { maker, accountId, created, failed, ...(status === 422 ? { error: failed[0]?.error ?? "DEVNET_LIQUIDITY_FAILED" } : {}) },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "DEVNET_LIQUIDITY_FAILED";
    return Response.json({ error: message }, { status: 422 });
  }
}

interface QuoteContext {
  setryn: LocalRuntime;
  maker: Address;
  accountId: Hex;
  publicClient: PublicClient;
  walletClient: WalletClient;
  requestUrl: string;
}

/** Keeps one live maker order at the top of each side of a market's book, replacing expired ones. */
async function quoteMarket(context: QuoteContext, market: SetrynRuntimeMarket): Promise<Hex[]> {
  const { setryn, maker, accountId, publicClient, walletClient } = context;
  const bookId = deriveSeriesBookId(setryn, market.seriesId);
  const block = await publicClient.getBlock({ blockTag: "pending" });
  const created: Hex[] = [];
  for (const quote of makerQuotes(market)) {
    let bestLevel = await publicClient.readContract({
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "bestLevel",
      args: [bookId, quote.side],
    }).catch(() => ZERO_ID);
    for (let attempt = 0; bestLevel !== ZERO_ID && attempt < 8; attempt += 1) {
      const level = await publicClient.readContract({
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "getPriceLevel",
        args: [bestLevel],
      });
      const record = await publicClient.readContract({
        address: setryn.orderState,
        abi: orderStateAbi,
        functionName: "getOrder",
        args: [level.headOrderHash],
      });
      if ((record.status === 1 || record.status === 2) && record.order.deadline > block.timestamp) break;
      // The pending block can run ahead of the book's own eligibility clock; an order it still holds eligible stays.
      const prunable = await publicClient
        .simulateContract({
          account: maker,
          address: setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "pruneBest",
          args: [bookId, quote.side, [level.headOrderHash]],
        })
        .then(() => true)
        .catch(() => false);
      if (!prunable) break;
      const pruneHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "pruneBest",
        args: [bookId, quote.side, [level.headOrderHash]],
      });
      await publicClient.waitForTransactionReceipt({ hash: pruneHash });
      if (record.order.signer.toLowerCase() === maker.toLowerCase()) await expireMakerAdmission(context, level.headOrderHash);
      bestLevel = await publicClient.readContract({
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "bestLevel",
        args: [bookId, quote.side],
      });
    }
    if (bestLevel !== ZERO_ID) continue;
    // Random low bits keep concurrent refreshes in one block from signing the same order twice.
    const nonce = block.timestamp * BigInt(2 ** 32) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const order: OnchainPublicOrder = {
      signer: maker,
      accountId,
      policyId: PUBLIC_SERIES_POLICY,
      policyContextHash: MAKER_POLICY_CONTEXT,
      recipient: maker,
      targetKind: 1,
      seriesId: market.seriesId,
      targetVersion: 1,
      packageId: ZERO_ID,
      side: quote.side,
      lots: BigInt(Math.min(MAKER_LOTS, market.maxOrderLots)),
      priceTicks: quote.priceTicks,
      timeInForce: 1,
      remainderPolicy: 1,
      // The risk reservation admits deadlines up to five minutes out; a longer-lived quote churns the book less.
      deadline: block.timestamp + BigInt(290),
      feeScheduleId: setryn.feeScheduleId,
      feeScheduleVersion: 1,
      maxFeeMinor: parseUnits("100", 6),
      executionModeId: setryn.executionModeId,
      actionId: setryn.enterActionId,
      permittedExecutor: setryn.atomicClearingEngine,
      nonce,
      salt: keccak256(encodeAbiParameters(
        [{ name: "seriesId", type: "bytes32" }, { name: "nonce", type: "uint256" }],
        [market.seriesId, nonce],
      )),
      allowPartialFills: true,
      minimumFillLots: BigInt(1),
      postOnly: true,
      reduceOnly: false,
    };
    const signature = await walletClient.signTypedData({
      account: maker,
      domain: {
        name: "Setryn",
        version: "1",
        chainId: setryn.chainId,
        verifyingContract: setryn.orderState,
      },
      types: publicOrderTypedData,
      primaryType: "PublicOrder",
      message: order,
    });
    const orderHash = await publicClient.readContract({
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "hashOrder",
      args: [order],
    });
    const reservation = await fetch(new URL("/api/internal/orders/reserve-risk", context.requestUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: serializePublicOrder(order), signature, orderHash }),
    });
    const reservationBody = (await reservation.json()) as { admissionId?: Hex };
    if (!reservation.ok || !reservationBody.admissionId) throw new Error("MAKER_RISK_RESERVATION_FAILED");
    const bindingHash = await walletClient.writeContract({
      account: maker,
      chain: null,
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "bindOrderRisk",
      args: [order, reservationBody.admissionId],
    });
    await publicClient.waitForTransactionReceipt({ hash: bindingHash });
    const registrationHash = await walletClient.writeContract({
      account: maker,
      chain: null,
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "registerSignedOrder",
      args: [order, signature],
    });
    await publicClient.waitForTransactionReceipt({ hash: registrationHash });
    const placementHash = await walletClient.writeContract({
      account: maker,
      chain: null,
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "placeSeriesOrder",
      args: [orderHash, { previousLevelId: ZERO_ID, nextLevelId: ZERO_ID }],
    });
    await publicClient.waitForTransactionReceipt({ hash: placementHash });
    created.push(orderHash);
  }
  return created;
}

/** An expired maker quote no longer holds risk: its admission is released through the permissionless expiry. */
async function expireMakerAdmission(context: QuoteContext, orderHash: Hex): Promise<void> {
  const { setryn, maker, publicClient, walletClient } = context;
  const admissionId = await publicClient.readContract({
    address: setryn.riskAdmissionBindingRegistry,
    abi: riskBindingAbi,
    functionName: "admissionForOrder",
    args: [orderHash],
  });
  if (admissionId === ZERO_ID) return;
  const admission = await publicClient.readContract({
    address: setryn.portfolioRiskEngine,
    abi: riskEngineAbi,
    functionName: "getAdmission",
    args: [admissionId],
  });
  if (admission.status !== 1) return;
  try {
    await publicClient.simulateContract({
      account: maker,
      address: setryn.portfolioRiskEngine,
      abi: riskExpiryAbi,
      functionName: "expireAdmission",
      args: [admissionId],
    });
  } catch {
    return;
  }
  const expiryHash = await walletClient.writeContract({
    account: maker,
    chain: null,
    address: setryn.portfolioRiskEngine,
    abi: riskExpiryAbi,
    functionName: "expireAdmission",
    args: [admissionId],
  });
  await publicClient.waitForTransactionReceipt({ hash: expiryHash });
}
