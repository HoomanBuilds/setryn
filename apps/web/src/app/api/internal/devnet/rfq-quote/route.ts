import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  stringToHex,
  type Hex,
} from "viem";
import {
  makerQuoteTypedData,
  orderStateAbi,
  privateRfqBookAbi,
  publicOrderTypedData,
  riskBindingAbi,
  serializePublicOrder,
  type OnchainMakerQuote,
  type OnchainPublicOrder,
} from "@/lib/internal-gateway/protocol";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZERO_ID = `0x${"0".repeat(64)}` as Hex;
const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
const MAKER_POLICY_CONTEXT = keccak256(stringToHex("SETRYN_DEVNET_MAKER_PRIVATE_RFQ_V1"));

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
] as const;

interface RfqQuoteBody {
  rfqId?: unknown;
  packagePrice?: unknown;
  capacityLots?: unknown;
  feeCap?: unknown;
  ttlSeconds?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RfqQuoteBody;
    if (typeof body.rfqId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.rfqId)) {
      return Response.json({ error: "Invalid RFQ identifier" }, { status: 400 });
    }
    const rfqId = body.rfqId as Hex;
    const requestedPrice = body.packagePrice === undefined ? 612 : Number(body.packagePrice);
    const requestedLots = body.capacityLots === undefined ? null : Number(body.capacityLots);
    const requestedFeeCap = body.feeCap === undefined ? null : Number(body.feeCap);
    const ttlSeconds = body.ttlSeconds === undefined ? 120 : Number(body.ttlSeconds);
    if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) throw new Error("INVALID_PACKAGE_PRICE");
    if (requestedLots !== null && (!Number.isInteger(requestedLots) || requestedLots <= 0)) {
      throw new Error("INVALID_CAPACITY");
    }
    if (requestedFeeCap !== null && (!Number.isFinite(requestedFeeCap) || requestedFeeCap < 0)) {
      throw new Error("INVALID_FEE_CAP");
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 120) throw new Error("INVALID_TTL");
    const bootstrap = await fetch(new URL("/api/internal/devnet/liquidity", request.url), { method: "POST" });
    if (!bootstrap.ok) throw new Error("DEVNET_MAKER_UNAVAILABLE");

    const setryn = await readLocalRuntime();
    const maker = getAddress(setryn.operator);
    const publicClient = createPublicClient({ transport: http(setryn.rpcUrl) });
    const walletClient = createWalletClient({ account: maker, transport: http(setryn.rpcUrl) });
    const [rfq, makerAccountId, block] = await Promise.all([
      publicClient.readContract({
        address: setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "getRfq",
        args: [rfqId],
      }),
      publicClient.readContract({
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "deriveAccountId",
        args: [maker, ACCOUNT_SALT],
      }),
      publicClient.getBlock(),
    ]);
    if (rfq.status !== 2 || rfq.request.deadline <= block.timestamp) throw new Error("RFQ_NOT_COLLECTING");

    const makerSide: 1 | 2 = rfq.request.sidePolicy === 1 ? 2 : 1;
    const priceTicks = BigInt(Math.round(requestedPrice * 10));
    const lots = requestedLots === null ? rfq.request.lots : BigInt(requestedLots);
    const maxFeeMinor = requestedFeeCap === null
      ? rfq.request.maxFeeMinor
      : BigInt(Math.round(requestedFeeCap * 1_000_000));
    if (lots > rfq.request.lots || maxFeeMinor > rfq.request.maxFeeMinor) throw new Error("QUOTE_ABOVE_REQUEST_LIMIT");
    if (lots < rfq.request.lots && (!rfq.request.allowPartialFills || rfq.request.remainderPolicy !== 2)) {
      throw new Error("PARTIAL_QUOTE_NOT_ALLOWED");
    }
    const quoteDeadline = rfq.request.deadline < block.timestamp + BigInt(ttlSeconds)
      ? rfq.request.deadline
      : block.timestamp + BigInt(ttlSeconds);
    const capacityExpiry = quoteDeadline + BigInt(60);
    const orderNonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const makerOrder: OnchainPublicOrder = {
      signer: maker,
      accountId: makerAccountId,
      policyId: PUBLIC_SERIES_POLICY,
      policyContextHash: MAKER_POLICY_CONTEXT,
      actionId: setryn.enterActionId,
      targetKind: 1,
      seriesId: setryn.seriesId,
      packageId: ZERO_ID,
      targetVersion: 1,
      side: makerSide,
      lots,
      priceTicks,
      timeInForce: 4,
      deadline: quoteDeadline,
      executionModeId: setryn.privateRfqExecutionModeId,
      feeScheduleId: setryn.feeScheduleId,
      feeScheduleVersion: 1,
      maxFeeMinor,
      recipient: maker,
      permittedExecutor: setryn.atomicClearingEngine,
      nonce: orderNonce,
      salt: keccak256(stringToHex(`${rfqId}:${orderNonce}:maker-order`)),
      allowPartialFills: rfq.request.allowPartialFills,
      minimumFillLots: rfq.request.minimumFillLots,
      remainderPolicy: rfq.request.remainderPolicy as 1 | 2,
      postOnly: false,
      reduceOnly: false,
    };
    const makerOrderSignature = await walletClient.signTypedData({
      account: maker,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.orderState },
      types: publicOrderTypedData,
      primaryType: "PublicOrder",
      message: makerOrder,
    });
    const makerOrderHash = await publicClient.readContract({
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "hashOrder",
      args: [makerOrder],
    });
    const reservation = await fetch(new URL("/api/internal/orders/reserve-risk", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: serializePublicOrder(makerOrder), signature: makerOrderSignature, orderHash: makerOrderHash }),
    });
    const reservationBody = (await reservation.json()) as { admissionId?: Hex };
    if (!reservation.ok || !reservationBody.admissionId) throw new Error("MAKER_RISK_RESERVATION_FAILED");
    const bindingHash = await walletClient.writeContract({
      account: maker,
      chain: null,
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "bindOrderRisk",
      args: [makerOrder, reservationBody.admissionId],
    });
    await publicClient.waitForTransactionReceipt({ hash: bindingHash });
    const registrationHash = await walletClient.writeContract({
      account: maker,
      chain: null,
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "registerSignedOrder",
      args: [makerOrder, makerOrderSignature],
    });
    await publicClient.waitForTransactionReceipt({ hash: registrationHash });

    const liabilityPerLot = BigInt(
      makerSide === 1 ? setryn.maxLongDebitMinorPerLot : setryn.maxShortDebitMinorPerLot,
    );
    const quoteNonce = orderNonce + BigInt(1);
    const quote: OnchainMakerQuote = {
      rfqId,
      maker,
      makerAccountId,
      takerAccountId: rfq.request.takerAccountId,
      makerOrderHash,
      targetKind: 1,
      seriesId: setryn.seriesId,
      packageId: ZERO_ID,
      targetVersion: 1,
      hasPackageLegCommitment: false,
      packageLegsHash: ZERO_ID,
      sidePolicy: rfq.request.sidePolicy as 1 | 2 | 3,
      lots,
      allowPartialFills: rfq.request.allowPartialFills,
      minimumFillLots: rfq.request.minimumFillLots,
      remainderPolicy: rfq.request.remainderPolicy as 1 | 2,
      bidPriceTicks: rfq.request.sidePolicy === 2 ? priceTicks : BigInt(0),
      askPriceTicks: rfq.request.sidePolicy === 1 ? priceTicks : BigInt(0),
      feeScheduleId: setryn.feeScheduleId,
      feeScheduleVersion: 1,
      maxFeeMinor,
      riskDomainId: setryn.riskDomainId,
      riskDomainVersion: 1,
      collateralAssetId: setryn.settlementAssetId,
      collateralBindingVersion: 1,
      maximumLiability: lots * liabilityPerLot,
      privacyModeId: setryn.privateRfqPrivacyModeId,
      executionModeId: setryn.privateRfqExecutionModeId,
      disclosurePolicyHash: setryn.privateRfqDisclosurePolicyHash,
      eligibleMakerSetHash: setryn.privateRfqEligibleMakerSetHash,
      deadline: quoteDeadline,
      capacityExpiry,
      permittedExecutor: setryn.atomicClearingEngine,
      nonce: quoteNonce,
      salt: keccak256(stringToHex(`${rfqId}:${quoteNonce}:maker-quote`)),
    };
    const quoteSignature = await walletClient.signTypedData({
      account: maker,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook },
      types: makerQuoteTypedData,
      primaryType: "MakerQuote",
      message: quote,
    });
    const quoteId = await publicClient.readContract({
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "hashQuote",
      args: [quote],
    });
    const submitHash = await walletClient.writeContract({
      account: maker,
      chain: null,
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "submitQuote",
      args: [quote, [], quoteSignature],
    });
    await publicClient.waitForTransactionReceipt({ hash: submitHash });
    const reserveHash = await walletClient.writeContract({
      account: maker,
      chain: null,
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "reserveQuoteCapacity",
      args: [quoteId],
    });
    await publicClient.waitForTransactionReceipt({ hash: reserveHash });

    return Response.json({
      quoteId,
      packagePrice: Number(priceTicks) / 10,
      feeCap: Number(maxFeeMinor) / 1_000_000,
      capacityLots: Number(lots),
      expiresAt: new Date(Number(quoteDeadline) * 1000).toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RFQ_QUOTE_FAILED";
    return Response.json({ error: message }, { status: 422 });
  }
}
