import { keccak256, stringToHex, type Hex } from "viem";
import { ensureMakerAccount, MAKER_RFQ_POLICY_CONTEXT, PUBLIC_SERIES_POLICY } from "@/lib/internal-gateway/designated-maker";
import { marketTradingVersions, readActiveFeeSchedule } from "@/lib/internal-gateway/fee-schedule";
import { makerPricingResponse, makerQuote } from "@/lib/internal-gateway/maker-pricing";
import { withMakerLock } from "@/lib/internal-gateway/maker-lock";
import { makerSigner, signerUnavailableResponse } from "@/lib/internal-gateway/operator-signer";
import {
  makerQuoteTypedData,
  orderStateAbi,
  privateRfqBookAbi,
  publicOrderTypedData,
  riskBindingAbi,
  type OnchainMakerQuote,
  type OnchainPublicOrder,
} from "@/lib/internal-gateway/protocol";
import { reserveOrderRisk } from "@/lib/internal-gateway/risk-admission";
import { priceToTicks, runtimeMarketBySeries, ticksToPrice } from "@/lib/internal-gateway/runtime-markets";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const ZERO_ID = `0x${"0".repeat(64)}` as Hex;

interface RfqQuoteBody {
  rfqId?: unknown;
  packagePrice?: unknown;
  capacityLots?: unknown;
  feeCap?: unknown;
  ttlSeconds?: unknown;
}

/** A refusal with its own status, returned as `{ error }`. */
class QuoteRefusal extends Error {
  constructor(
    readonly status: number,
    code: string,
  ) {
    super(code);
  }
}

/**
 * The designated maker answers a collecting RFQ with a firm, capacity-backed quote: a risk-bound backing order, the
 * signed quote, and its reserved capacity. The price is the maker's own side of the reference-priced quote
 * (lib/internal-gateway/maker-pricing.ts); a caller may ask for a price only at or beyond that side, never better for
 * the taker, so the route cannot be used to make the house maker trade off-market.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RfqQuoteBody;
    if (typeof body.rfqId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.rfqId)) {
      return Response.json({ error: "Invalid RFQ identifier" }, { status: 400, headers: NO_STORE });
    }
    const rfqId = body.rfqId as Hex;
    const requestedPrice = body.packagePrice === undefined ? null : Number(body.packagePrice);
    const requestedLots = body.capacityLots === undefined ? null : Number(body.capacityLots);
    const requestedFeeCap = body.feeCap === undefined ? null : Number(body.feeCap);
    const ttlSeconds = body.ttlSeconds === undefined ? 120 : Number(body.ttlSeconds);
    if (requestedPrice !== null && (!Number.isFinite(requestedPrice) || requestedPrice <= 0)) throw new QuoteRefusal(422, "INVALID_PACKAGE_PRICE");
    if (requestedLots !== null && (!Number.isInteger(requestedLots) || requestedLots <= 0)) throw new QuoteRefusal(422, "INVALID_CAPACITY");
    if (requestedFeeCap !== null && (!Number.isFinite(requestedFeeCap) || requestedFeeCap < 0)) throw new QuoteRefusal(422, "INVALID_FEE_CAP");
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 120) throw new QuoteRefusal(422, "INVALID_TTL");

    const setryn = await readRuntime();
    const maker = await makerSigner(setryn);
    const { publicClient, walletClient } = maker;
    const [rfq, block] = await Promise.all([
      publicClient.readContract({ address: setryn.privateRfqBook, abi: privateRfqBookAbi, functionName: "getRfq", args: [rfqId] }),
      publicClient.getBlock({ blockTag: "pending" }),
    ]);
    if (rfq.status !== 2 || rfq.request.deadline <= block.timestamp) throw new QuoteRefusal(422, "RFQ_NOT_COLLECTING");
    // The quote and its maker order sign the request's series and fee schedule versions, which must still be the ones
    // the market trades: clearing charges only under an open fee version, so a retired version could never settle.
    const fees = await readActiveFeeSchedule(setryn, { client: publicClient, maxAgeMs: 0 });
    const versions = marketTradingVersions(fees, rfq.request.seriesId);
    if (
      rfq.request.feeScheduleId.toLowerCase() !== setryn.feeScheduleId.toLowerCase() ||
      (fees.source === "CHAIN" &&
        (!versions.tradable ||
          rfq.request.feeScheduleVersion !== versions.feeScheduleVersion ||
          rfq.request.targetVersion !== versions.seriesVersion))
    ) {
      throw new QuoteRefusal(422, "FEE_SCHEDULE_CHANGED");
    }
    const feeScheduleVersion = rfq.request.feeScheduleVersion;
    const targetVersion = rfq.request.targetVersion;
    // The request's series names the market, so the quote carries that market's grid, liability, and payoff.
    const market = runtimeMarketBySeries(setryn, rfq.request.seriesId);
    if (!market) throw new QuoteRefusal(422, "MARKET_NOT_ONCHAIN_ENABLED");
    const fair = await makerQuote(market);
    const makerSide: 1 | 2 = rfq.request.sidePolicy === 1 ? 2 : 1;
    const ownTicks = makerSide === 2 ? fair.askTicks : fair.bidTicks;
    let priceTicks = ownTicks;
    if (requestedPrice !== null) {
      priceTicks = priceToTicks(market, requestedPrice);
      // Selling, the maker asks at least its ask; buying, it bids at most its bid.
      if (makerSide === 2 ? priceTicks < ownTicks : priceTicks > ownTicks) throw new QuoteRefusal(409, "QUOTE_OUTSIDE_MAKER_PRICE");
    }
    const makerAccountId = await withMakerLock(() => ensureMakerAccount(maker));

    // The maker's reservation and binding must not interleave with another maker reservation.
    return await withMakerLock(async () => {
      const lots = requestedLots === null ? rfq.request.lots : BigInt(requestedLots);
      const maxFeeMinor = requestedFeeCap === null ? rfq.request.maxFeeMinor : BigInt(Math.round(requestedFeeCap * 1_000_000));
      if (lots > rfq.request.lots || maxFeeMinor > rfq.request.maxFeeMinor) throw new QuoteRefusal(422, "QUOTE_ABOVE_REQUEST_LIMIT");
      if (lots < rfq.request.lots && (!rfq.request.allowPartialFills || rfq.request.remainderPolicy !== 2)) {
        throw new QuoteRefusal(422, "PARTIAL_QUOTE_NOT_ALLOWED");
      }
      const quoteDeadline = rfq.request.deadline < block.timestamp + BigInt(ttlSeconds) ? rfq.request.deadline : block.timestamp + BigInt(ttlSeconds);
      const capacityExpiry = quoteDeadline + BigInt(60);
      const orderNonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
      const makerOrder: OnchainPublicOrder = {
        signer: maker.address,
        accountId: makerAccountId,
        policyId: PUBLIC_SERIES_POLICY,
        policyContextHash: MAKER_RFQ_POLICY_CONTEXT,
        actionId: setryn.enterActionId,
        targetKind: 1,
        seriesId: market.seriesId,
        packageId: ZERO_ID,
        targetVersion,
        side: makerSide,
        lots,
        priceTicks,
        timeInForce: 4,
        deadline: quoteDeadline,
        executionModeId: setryn.privateRfqExecutionModeId,
        feeScheduleId: setryn.feeScheduleId,
        feeScheduleVersion,
        maxFeeMinor,
        recipient: maker.address,
        permittedExecutor: setryn.atomicClearingEngine,
        nonce: orderNonce,
        salt: keccak256(stringToHex(`${rfqId}:${orderNonce}:maker-order`)),
        allowPartialFills: false,
        minimumFillLots: lots,
        remainderPolicy: 2 as const,
        postOnly: false,
        reduceOnly: false,
      };
      const makerOrderSignature = await walletClient.signTypedData({
        domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.orderState },
        types: publicOrderTypedData,
        primaryType: "PublicOrder",
        message: makerOrder,
      });
      const makerOrderHash = await publicClient.readContract({ address: setryn.orderState, abi: orderStateAbi, functionName: "hashOrder", args: [makerOrder] });
      const { admissionId } = await reserveOrderRisk(setryn, makerOrder, makerOrderSignature, makerOrderHash).catch((error: unknown) => {
        console.error("[rfq-quote] risk reservation", error instanceof Error ? error.message.split("\n")[0] : error);
        throw new QuoteRefusal(422, "MAKER_RISK_RESERVATION_FAILED");
      });
      const bindingHash = await walletClient.writeContract({
        chain: null,
        address: setryn.riskAdmissionBindingRegistry,
        abi: riskBindingAbi,
        functionName: "bindOrderRisk",
        args: [makerOrder, admissionId],
      });
      await publicClient.waitForTransactionReceipt({ hash: bindingHash });
      const registrationHash = await walletClient.writeContract({
        chain: null,
        address: setryn.orderState,
        abi: orderStateAbi,
        functionName: "registerSignedOrder",
        args: [makerOrder, makerOrderSignature],
      });
      await publicClient.waitForTransactionReceipt({ hash: registrationHash });

      const liabilityPerLot = BigInt(makerSide === 1 ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot);
      const quoteNonce = orderNonce + BigInt(1);
      const quote: OnchainMakerQuote = {
        rfqId,
        maker: maker.address,
        makerAccountId,
        takerAccountId: rfq.request.takerAccountId,
        makerOrderHash,
        targetKind: 1,
        seriesId: market.seriesId,
        packageId: ZERO_ID,
        targetVersion,
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
        feeScheduleVersion,
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
        domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook },
        types: makerQuoteTypedData,
        primaryType: "MakerQuote",
        message: quote,
      });
      const quoteId = await publicClient.readContract({ address: setryn.privateRfqBook, abi: privateRfqBookAbi, functionName: "hashQuote", args: [quote] });
      const submitHash = await walletClient.writeContract({
        chain: null,
        address: setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "submitQuote",
        args: [quote, [], quoteSignature],
      });
      await publicClient.waitForTransactionReceipt({ hash: submitHash });
      const reserveHash = await walletClient.writeContract({
        chain: null,
        address: setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "reserveQuoteCapacity",
        args: [quoteId],
      });
      await publicClient.waitForTransactionReceipt({ hash: reserveHash });

      return Response.json(
        {
          quoteId,
          maker: maker.address,
          packagePrice: ticksToPrice(market, priceTicks),
          feeCap: Number(maxFeeMinor) / 1_000_000,
          capacityLots: Number(lots),
          expiresAt: new Date(Number(quoteDeadline) * 1000).toISOString(),
          reference: { underlying: fair.reference.underlying, price: fair.reference.price, updatedAt: fair.reference.updatedAt },
        },
        { headers: NO_STORE },
      );
    });
  } catch (error) {
    if (error instanceof QuoteRefusal) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    const refused = signerUnavailableResponse(error) ?? makerPricingResponse(error);
    if (refused) return refused;
    const message = error instanceof Error ? error.message.split("\n")[0] : "RFQ_QUOTE_FAILED";
    return Response.json({ error: message }, { status: 422, headers: NO_STORE });
  }
}
