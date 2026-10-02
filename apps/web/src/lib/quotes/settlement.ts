import type { Address, Hex } from "viem";
import { parsePublicOrder, serializePublicOrder, type OnchainPublicOrder, type SerializedPublicOrder } from "@/lib/internal-gateway/protocol";
import { parseRiskAuthorization, serializeRiskAuthorization, type SerializedRiskAuthorization } from "./firm-quote";
import type { OrderRiskAuthorization, TakerSettlementTerms } from "./protocol";

/*
 * One quote settlement as QuoteSettlementRouter.settle takes it, and its JSON form for the optional relayer. The browser
 * builds it, the relayer parses it strictly before simulating, and both hand the same arguments to the router.
 */

export interface QuoteSettlementArgs {
  quote: {
    order: OnchainPublicOrder;
    orderSignature: Hex;
    risk: OrderRiskAuthorization;
    riskSignature: Hex;
    terms: { capacityId: Hex };
  };
  taker: {
    order: OnchainPublicOrder;
    orderSignature: Hex;
    risk: OrderRiskAuthorization;
    riskSignature: Hex;
    terms: TakerSettlementTerms;
  };
  fillLots: bigint;
  relayerFeeMinor: bigint;
  payoffTerms: Hex;
}

export interface SerializedQuoteSettlement {
  quote: {
    order: SerializedPublicOrder;
    orderSignature: Hex;
    risk: SerializedRiskAuthorization;
    riskSignature: Hex;
    terms: { capacityId: Hex };
  };
  taker: {
    order: SerializedPublicOrder;
    orderSignature: Hex;
    risk: SerializedRiskAuthorization;
    riskSignature: Hex;
    terms: { quoteOrderHash: Hex; relayer: Address; relayerAccountId: Hex; maxRelayerFeeMinor: string };
  };
  fillLots: string;
  relayerFeeMinor: string;
  payoffTerms: Hex;
}

export function serializeQuoteSettlement(settlement: QuoteSettlementArgs): SerializedQuoteSettlement {
  return {
    quote: {
      ...settlement.quote,
      order: serializePublicOrder(settlement.quote.order),
      risk: serializeRiskAuthorization(settlement.quote.risk),
    },
    taker: {
      ...settlement.taker,
      order: serializePublicOrder(settlement.taker.order),
      risk: serializeRiskAuthorization(settlement.taker.risk),
      terms: { ...settlement.taker.terms, maxRelayerFeeMinor: settlement.taker.terms.maxRelayerFeeMinor.toString() },
    },
    fillLots: settlement.fillLots.toString(),
    relayerFeeMinor: settlement.relayerFeeMinor.toString(),
    payoffTerms: settlement.payoffTerms,
  };
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** ECDSA signatures are 65 bytes; smart-contract wallets (ERC-1271) may sign with any non-empty payload. */
const SIGNATURE = /^0x(?:[0-9a-fA-F]{2}){1,2048}$/;
const BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;
const UNSIGNED = /^[0-9]+$/;

function field<T>(value: unknown, pattern: RegExp, error: string): T {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(error);
  return value as T;
}

/** Parses a relayed settlement strictly: every field present, every hex well formed, every amount a plain integer. */
export function parseQuoteSettlement(candidate: unknown): QuoteSettlementArgs {
  if (!candidate || typeof candidate !== "object") throw new Error("INVALID_SETTLEMENT");
  const value = candidate as Record<string, Record<string, unknown> | unknown>;
  const quote = value.quote as Record<string, unknown> | undefined;
  const taker = value.taker as Record<string, unknown> | undefined;
  if (!quote || !taker || typeof quote !== "object" || typeof taker !== "object") throw new Error("INVALID_SETTLEMENT");
  const quoteTerms = quote.terms as Record<string, unknown> | undefined;
  const takerTerms = taker.terms as Record<string, unknown> | undefined;
  if (!quoteTerms || !takerTerms) throw new Error("INVALID_SETTLEMENT");
  return {
    quote: {
      order: parsePublicOrder(quote.order),
      orderSignature: field<Hex>(quote.orderSignature, SIGNATURE, "INVALID_SIGNATURE"),
      risk: parseRiskAuthorization(quote.risk),
      riskSignature: field<Hex>(quote.riskSignature, SIGNATURE, "INVALID_SIGNATURE"),
      terms: { capacityId: field<Hex>(quoteTerms.capacityId, HEX32, "INVALID_SETTLEMENT") },
    },
    taker: {
      order: parsePublicOrder(taker.order),
      orderSignature: field<Hex>(taker.orderSignature, SIGNATURE, "INVALID_SIGNATURE"),
      risk: parseRiskAuthorization(taker.risk),
      riskSignature: field<Hex>(taker.riskSignature, SIGNATURE, "INVALID_SIGNATURE"),
      terms: {
        quoteOrderHash: field<Hex>(takerTerms.quoteOrderHash, HEX32, "INVALID_SETTLEMENT"),
        relayer: field<Address>(takerTerms.relayer, ADDRESS, "INVALID_SETTLEMENT"),
        relayerAccountId: field<Hex>(takerTerms.relayerAccountId, HEX32, "INVALID_SETTLEMENT"),
        maxRelayerFeeMinor: BigInt(field<string>(takerTerms.maxRelayerFeeMinor, UNSIGNED, "INVALID_SETTLEMENT")),
      },
    },
    fillLots: BigInt(field<string>(value.fillLots, UNSIGNED, "INVALID_SETTLEMENT")),
    relayerFeeMinor: BigInt(field<string>(value.relayerFeeMinor, UNSIGNED, "INVALID_SETTLEMENT")),
    payoffTerms: field<Hex>(value.payoffTerms, BYTES, "INVALID_SETTLEMENT"),
  };
}
