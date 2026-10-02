import { encodeAbiParameters, hashTypedData, keccak256, stringToHex, type Address, type Hex, type PublicClient } from "viem";
import { ensureMakerAccount } from "@/lib/internal-gateway/designated-maker";
import { withMakerLock } from "@/lib/internal-gateway/maker-lock";
import type { RoleSigner } from "@/lib/internal-gateway/operator-signer";
import type { SetrynRuntime, SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import {
  CAPACITY_ACTIVE,
  quoteCapacityTypes,
  quoteSettlementRouterAbi,
  setrynDomain,
  streamCapacityManagerAbi,
  type QuoteCapacityTerms,
} from "./protocol";

/*
 * The designated maker's onchain quote capacity, one per series: collateral locked once through
 * QuoteSettlementRouter.openQuoteCapacity and drawn down by settled quotes. Capacity terms are a pure function of the
 * maker, the series and a time epoch, so the engine finds its capacity ids by hashing instead of scanning logs, and a
 * restarted server derives exactly the same ones. Each capacity lives two epochs; the next epoch's capacity is opened
 * the first time it is needed, so its lifetimes overlap and quoting never waits on a renewal. Opening is the maker's
 * only recurring transaction: one per series every epoch, and none for a series nobody views.
 */

/** A capacity epoch; each capacity is opened for two of them. */
export const CAPACITY_EPOCH_SECONDS = 3 * 86_400;
/** Lots of the larger per-lot liability one series' capacity backs before it must be reopened. */
export const CAPACITY_LOTS = BigInt(40);
/** The most net lots the maker may accumulate against one capacity, either way. */
const MAXIMUM_INVENTORY_LOTS = BigInt(400);
const CAPACITY_ID_TAG = keccak256(stringToHex("SETRYN_QUOTE_CAPACITY_ID_V1"));
/** A failed open is not retried for this long, so a broken setup never turns into a transaction loop. */
const OPEN_RETRY_MS = 120_000;

export interface CapacityView {
  id: Hex;
  terms: QuoteCapacityTerms;
  /** Whether the router has opened it and it can still be drawn: active and not past its expiry. */
  live: boolean;
  remainingLiability: bigint;
  expiry: bigint;
  /** Liability drawn per lot settled against it. */
  liabilityPerLot: bigint;
}

/** The liability one lot of `market` draws from a capacity: the larger of its long and short bounds. */
export function capacityLiabilityPerLot(market: SetrynRuntimeMarket): bigint {
  return BigInt(Math.max(market.maxLongDebitMinorPerLot, market.maxShortDebitMinorPerLot));
}

/**
 * The maker's capacity terms for one series version and epoch. The version is the one the market trades now (fee
 * repricing re-versions series), so a re-versioned series gets fresh capacity rather than quotes the router refuses.
 */
export function capacityTermsFor(
  market: SetrynRuntimeMarket,
  seriesVersion: number,
  maker: Address,
  makerAccountId: Hex,
  epoch: number,
): QuoteCapacityTerms {
  const liabilityPerLot = capacityLiabilityPerLot(market);
  return {
    maker,
    makerAccountId,
    seriesId: market.seriesId,
    seriesVersion,
    maximumLiability: liabilityPerLot * CAPACITY_LOTS,
    liabilityPerLot,
    maximumAbsoluteInventoryLots: MAXIMUM_INVENTORY_LOTS,
    expiry: BigInt((epoch + 2) * CAPACITY_EPOCH_SECONDS),
    nonce: BigInt(
      keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }, { type: "uint64" }], [market.seriesId, seriesVersion, BigInt(epoch)])),
    ),
  };
}

/** QuoteSettlementRouter.deriveCapacityId, computed locally from the same EIP-712 digest the maker signs. */
export function capacityId(setryn: SetrynRuntime, terms: QuoteCapacityTerms): Hex {
  const digest = hashTypedData({
    domain: setrynDomain(setryn.chainId, setryn.quoteSettlementRouter as Address),
    types: quoteCapacityTypes,
    primaryType: "SetrynQuoteCapacityV1",
    message: terms,
  });
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [CAPACITY_ID_TAG, digest]));
}

/** Reads one capacity; an id the router never opened reads as not live. */
export async function readCapacity(client: PublicClient, setryn: SetrynRuntime, terms: QuoteCapacityTerms): Promise<CapacityView> {
  const id = capacityId(setryn, terms);
  const state = await client
    .readContract({
      address: setryn.streamCapacityManager as Address,
      abi: streamCapacityManagerAbi,
      functionName: "getStreamCapacity",
      args: [id],
    })
    .catch(() => null);
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const live = state !== null && state.capacity.status === CAPACITY_ACTIVE && state.capacity.expiry > nowSeconds;
  return {
    id,
    terms,
    live,
    remainingLiability: state?.capacity.remainingLiability ?? BigInt(0),
    expiry: state?.capacity.expiry ?? terms.expiry,
    liabilityPerLot: terms.liabilityPerLot,
  };
}

/** The current epoch's capacity and the previous one's, newest first; quotes draw on the first that can back them. */
export async function readSeriesCapacities(
  client: PublicClient,
  setryn: SetrynRuntime,
  market: SetrynRuntimeMarket,
  seriesVersion: number,
  maker: Address,
  makerAccountId: Hex,
  nowSeconds: number,
): Promise<CapacityView[]> {
  const epoch = Math.floor(nowSeconds / CAPACITY_EPOCH_SECONDS);
  return Promise.all(
    [epoch, epoch - 1].map((candidate) =>
      readCapacity(client, setryn, capacityTermsFor(market, seriesVersion, maker, makerAccountId, candidate)),
    ),
  );
}

const OPENING_KEY = Symbol.for("setryn.quote-capacity.opening");

interface OpeningState {
  running: Map<Hex, Promise<void>>;
  failedAt: Map<Hex, number>;
}

function opening(): OpeningState {
  const holder = globalThis as unknown as Record<symbol, OpeningState | undefined>;
  holder[OPENING_KEY] ??= { running: new Map(), failedAt: new Map() };
  return holder[OPENING_KEY];
}

/**
 * Opens a capacity in the background from the maker's signature, once per id per process, under the maker lock. The
 * maker account is created, funded with test collateral where the token is mintable, and its lock operators approved
 * the first time; after that this is one transaction. Returns whether an open is in flight.
 */
export function openCapacityInBackground(maker: RoleSigner, terms: QuoteCapacityTerms): boolean {
  const state = opening();
  const id = capacityId(maker.setryn, terms);
  if (state.running.has(id)) return true;
  const failedAt = state.failedAt.get(id);
  if (failedAt !== undefined && Date.now() - failedAt < OPEN_RETRY_MS) return false;
  const run = withMakerLock(async () => {
    const { setryn, walletClient, publicClient } = maker;
    if ((await readCapacity(publicClient, setryn, terms)).live) return;
    await ensureMakerAccount(maker);
    const signature = await walletClient.signTypedData({
      account: walletClient.account,
      domain: setrynDomain(setryn.chainId, setryn.quoteSettlementRouter as Address),
      types: quoteCapacityTypes,
      primaryType: "SetrynQuoteCapacityV1",
      message: terms,
    });
    const hash = await walletClient.writeContract({
      chain: null,
      address: setryn.quoteSettlementRouter as Address,
      abi: quoteSettlementRouterAbi,
      functionName: "openQuoteCapacity",
      args: [terms, signature],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("QUOTE_CAPACITY_OPEN_FAILED");
  })
    .then(() => {
      state.failedAt.delete(id);
    })
    .catch((error: unknown) => {
      state.failedAt.set(id, Date.now());
      console.error("[quote-capacity] open", error instanceof Error ? error.message.split("\n")[0] : error);
    })
    .finally(() => {
      state.running.delete(id);
    });
  state.running.set(id, run);
  return true;
}
