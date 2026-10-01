import type { JsonObject } from "@setryn/internal-schemas";
import {
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  hashTypedData,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type { OracleRelayExecutionPort } from "../ports.ts";
import type { OperatorExecutionContext, OperatorExecutionResult, OracleRelayIntent } from "../types.ts";
import { transactionSummary, type OperatorChainClient, type OperatorTransaction } from "./chain.ts";
import { requireMarket, requireMarketById, requireMarketBySeries } from "./deployment.ts";
import { describeChainError, isContractRevert, jsonSafe, OperatorExecutionError } from "./errors.ts";
import { PayloadReader } from "./payload.ts";
import { abis, enumName, fixingStatus, fixingStatusNames } from "./protocol.ts";
import { assertIntentEnvironment, completed } from "./results.ts";
import { SeriesCatalog, type FixingSlot } from "./series.ts";

/**
 * Accepted `relayPayload` for an oracle-relay intent. Two shapes:
 *
 * 1. Explicit evidence for one series. `feedKey` is the benchmark feed name (for example "Crypto.BTC/USD") or its
 *    32-byte keccak, and must match the benchmark the series' fixing candidate names.
 * {
 *   seriesId?: bytes32, seriesVersion?: integer,          // default: the intent market's series (else the primary),
 *                                                         // every version of it that holds positions
 *   slot?: integer, candidateIndex?: integer,             // default 0, 0 (single-slot series)
 *   observations: [{
 *     value: integer,                                     // scaled to the benchmark's output decimals
 *     observedAt?: unix seconds,                          // default: the candidate's target time
 *     publishedAt?: unix seconds,                         // default: observedAt
 *     providerSequence?: integer,                         // default: observedAt
 *     confidenceBps?: integer, weight?: integer,          // default 0 and 1
 *     finalityReference?: bytes32, itemEvidenceHash?: bytes32, sequencerProofHash?: bytes32
 *   }],
 *   adapterEvidence?: hex,
 *   submissions?: [{ slot, candidateIndex, observations, adapterEvidence? }]   // multi-slot series only
 * }
 *
 * 2. Local devnet fixtures for every benchmark (`feedKey` is informational, for example "devnet-fixtures"):
 * {
 *   fixtures: {
 *     marketKeys?: string[],                              // default: every market of the deployment
 *     offsetsBps?: { [benchmarkId]: integer },            // default: a deterministic per-benchmark offset in [-80, 80]
 *     seriesVersion?: integer                             // default: every version holding positions
 *   }
 * }
 *    One value per benchmark, shared by every series that fixes on it so the devnet tape stays coherent: the forward
 *    reference (the payoff terms' primary strike) of the benchmark's first listed market, moved by the benchmark's
 *    offset and rescaled to the benchmark's output decimals. Each series whose fixing window has reached its target
 *    time gets the value as evidence; series already proposed or final with it are reported, not resubmitted.
 *
 * 3. Chainlink-signed fixings (schema 11 runtimes with a signed-observation fixing adapter; `feedKey` is informational,
 *    for example "chainlink-signed"):
 * {
 *   chainlinkSigned: {
 *     marketKeys?: string[],                              // default: every market of the deployment
 *     seriesVersion?: integer,                            // default: every version holding positions
 *     batchSequence?: integer                             // default 1; a higher sequence replaces an earlier proposal
 *   }
 * }
 *    For each series whose fixing window has reached its candidate target, reads the Chainlink round in force at the
 *    target on the reference chain (Arbitrum One, read-only, SETRYN_REFERENCE_RPC_URL) from the market's
 *    `referenceFeed`, builds the observation (observedAt = publishedAt = target, value = answer rescaled to the
 *    benchmark's decimals), signs the SetrynSignedObservationBatchV1 EIP-712 batch the SignedObservationFixingAdapter
 *    verifies with SETRYN_ORACLE_SIGNER_KEY (local default: the operator's anvil account), and submits it. Series not
 *    yet due, already proposed or final are reported, not resubmitted.
 *
 * The relay is permissionless FixingEngine.submitEvidence (or submitEvidenceVector); the benchmark's registered
 * adapter validates the batch inside the engine. Nothing is sent unless the benchmark adapter is one the engine accepts.
 */
export class ChainOracleRelayExecutionPort implements OracleRelayExecutionPort {
  readonly #client: OperatorChainClient;
  readonly #catalog: SeriesCatalog;
  readonly #results = new Map<string, OperatorExecutionResult>();

  constructor(client: OperatorChainClient, catalog = new SeriesCatalog(client)) {
    this.#client = client;
    this.#catalog = catalog;
  }

  async executeOracleRelay(intent: OracleRelayIntent, context: OperatorExecutionContext): Promise<OperatorExecutionResult> {
    assertIntentEnvironment(this.#client, intent.environment, context);
    const cached = this.#results.get(intent.idempotencyKey);
    if (cached) return { ...cached, details: { ...cached.details, replayed: true } };
    try {
      const payload = new PayloadReader(intent.relayPayload, "relayPayload");
      const result = payload.has("chainlinkSigned")
        ? await this.#relayChainlinkSigned(intent)
        : payload.has("fixtures") ? await this.#relayFixtures(intent, payload) : await this.#relay(intent, payload);
      this.#results.set(intent.idempotencyKey, result);
      return result;
    } catch (error) {
      throw describeChainError(error, `oracle relay ${intent.idempotencyKey}`);
    }
  }

  async #relay(intent: OracleRelayIntent, payload: PayloadReader): Promise<OperatorExecutionResult> {
    const { deployment } = this.#client;
    const intentMarket = intent.marketId !== undefined ? requireMarketById(deployment, intent.marketId) : null;
    const seriesId = payload.bytes32("seriesId", intentMarket?.seriesId ?? deployment.ids.seriesId);
    const market = requireMarketBySeries(deployment, seriesId);
    if (intentMarket && intentMarket.marketId !== market.marketId) {
      throw new OperatorExecutionError("invalid-payload", `series ${seriesId} trades as ${market.marketKey}, not market ${intent.marketId}`);
    }
    // A fee change re-versions the series while open positions keep their version, and FixingEngine keys fixings by
    // version, so the same evidence is relayed to every version that holds positions unless one is named.
    const requested = payload.has("seriesVersion") ? payload.integer("seriesVersion", { min: 1 }) : null;
    const versions = await this.#catalog.workVersions(seriesId, requested);
    const feedKey = /^0x[0-9a-fA-F]{64}$/.test(intent.feedKey) ? (intent.feedKey.toLowerCase() as Hex) : keccak256(stringToHex(intent.feedKey));
    const submissions = payload.has("submissions") ? payload.objects("submissions") : [payload];
    const outcomes = [];
    for (const seriesVersion of versions) {
      outcomes.push(await this.#relaySeries({ seriesId, seriesVersion, feedKey, feedLabel: intent.feedKey, submissions }));
    }
    if (outcomes.length === 1) return completed({ marketKey: market.marketKey, ...outcomes[0]!.details }, outcomes[0]!.transactions);
    return completed(
      { marketKey: market.marketKey, seriesId, seriesVersions: versions, versions: outcomes.map((outcome) => outcome.details) },
      outcomes.flatMap((outcome) => outcome.transactions),
    );
  }

  /** Local devnet only: one coherent fixture value per benchmark, relayed to every due series that fixes on it. */
  async #relayFixtures(intent: OracleRelayIntent, payload: PayloadReader): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    if (client.environment !== "local") {
      throw new OperatorExecutionError("policy-refused", "fixture fixings are only relayed on the local devnet");
    }
    const raw = intent.relayPayload.fixtures;
    if (!payload.has("fixtures") || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new OperatorExecutionError("invalid-payload", "relayPayload.fixtures must be an object");
    }
    const options = new PayloadReader(raw, "relayPayload.fixtures");
    const requestedVersion = options.has("seriesVersion") ? options.integer("seriesVersion", { min: 1 }) : null;
    const keys = options.has("marketKeys") ? stringList(raw, "marketKeys") : null;
    const markets = keys ? keys.map((key) => requireMarket(deployment, key)) : [...deployment.markets];
    if (intent.marketId !== undefined) {
      const only = requireMarketById(deployment, intent.marketId);
      if (!markets.some((market) => market.marketId === only.marketId)) {
        throw new OperatorExecutionError("invalid-payload", `intent market ${only.marketKey} is outside relayPayload.fixtures.marketKeys`);
      }
      markets.splice(0, markets.length, only);
    }
    const offsets = options.has("offsetsBps") ? raw.offsetsBps : null;

    const now = await client.chainNow();
    const references = new Map<Hex, { readonly strike: bigint; readonly valueDecimals: number; readonly marketKey: string }>();
    for (const market of deployment.markets) {
      if (!references.has(market.benchmarkId)) {
        references.set(market.benchmarkId, { strike: market.terms.primaryStrike, valueDecimals: market.terms.valueDecimals, marketKey: market.marketKey });
      }
    }

    const transactions: OperatorTransaction[] = [];
    const results: JsonObject[] = [];
    const benchmarks: Record<string, JsonObject> = {};
    let failures = 0;
    const work = (
      await Promise.all(markets.map(async (market) =>
        (await this.#catalog.workVersions(market.seriesId, requestedVersion)).map((seriesVersion) => ({ market, seriesVersion })),
      ))
    ).flat();
    for (const { market, seriesVersion } of work) {
      const slots = await this.#catalog.fixingSlots(market.seriesId, seriesVersion);
      const base = { marketKey: market.marketKey, seriesId: market.seriesId, seriesVersion, benchmarkId: market.benchmarkId };
      try {
        const submissions: PayloadReader[] = [];
        let value: bigint | null = null;
        let decimals = 0;
        let notDue: string | null = null;
        for (const fixingSlot of slots) {
          const candidate = fixingSlot.candidates[0];
          if (!candidate) throw new OperatorExecutionError("precondition", `slot ${fixingSlot.slot} has no fixing candidate`);
          const benchmark = await this.#benchmark(candidate.benchmarkId, candidate.benchmarkVersion);
          const reference = references.get(candidate.benchmarkId);
          if (!reference) throw new OperatorExecutionError("precondition", `no market references benchmark ${candidate.benchmarkId}`);
          const offsetBps = fixtureOffsetBps(candidate.benchmarkId, offsets);
          value = rescale(reference.strike, reference.valueDecimals, benchmark.definition.outputDecimals) * BigInt(10_000 + offsetBps) / 10_000n;
          decimals = benchmark.definition.outputDecimals;
          benchmarks[candidate.benchmarkId] = {
            referenceMarketKey: reference.marketKey,
            forwardReference: reference.strike.toString(),
            referenceDecimals: reference.valueDecimals,
            offsetBps,
            value: value.toString(),
            decimals,
          };
          const count = Math.max(1, candidate.minimumObservations);
          const lastObservedAt = candidate.targetAt + BigInt(count - 1);
          if (now < lastObservedAt || lastObservedAt >= candidate.windowEndsAt) {
            notDue = now < lastObservedAt ? `fixing target ${candidate.targetAt} not reached at chain time ${now}` : "fixing window closed before the target observations";
            break;
          }
          submissions.push(new PayloadReader({
            slot: fixingSlot.slot,
            candidateIndex: 0,
            observations: Array.from({ length: count }, (_unused, index) => ({
              value: value!.toString(),
              observedAt: (candidate.targetAt + BigInt(index)).toString(),
            })),
          }, `fixtures.${market.marketKey}.slot${fixingSlot.slot}`));
        }
        if (notDue) {
          results.push({ ...base, outcome: "not-due", reason: notDue });
          continue;
        }
        const outcome = await this.#relaySeries({ seriesId: market.seriesId, seriesVersion, feedKey: null, feedLabel: "devnet-fixtures", submissions });
        transactions.push(...outcome.transactions);
        results.push({
          ...base,
          outcome: outcome.details.previouslyRelayed === true ? "previously-relayed" : "proposed",
          value: value?.toString() ?? null,
          decimals,
          details: jsonSafe(outcome.details) as JsonObject,
        });
      } catch (error) {
        if (error instanceof OperatorExecutionError && error.retryable && !isContractRevert(error)) throw error;
        failures += 1;
        results.push({ ...base, outcome: "failed", reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (work.length > 0 && failures === work.length) {
      throw new OperatorExecutionError("precondition", `every fixture relay failed: ${results.map((result) => `${result.marketKey}: ${String(result.reason)}`).join("; ")}`, {
        details: { results },
      });
    }
    return completed({ mode: "devnet-fixtures", seriesVersion: requestedVersion, chainTime: now, benchmarks, results }, transactions);
  }

  /** Schema 11: the Chainlink round in force at each due candidate's target, signed as the oracle publisher. */
  async #relayChainlinkSigned(intent: OracleRelayIntent): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const network = deployment.network;
    if (!network || network.fixingAdapterKind !== "signed-observation") {
      throw new OperatorExecutionError("precondition", "chainlink-signed fixings need a schema 11 runtime with a signed-observation fixing adapter");
    }
    const raw = intent.relayPayload.chainlinkSigned;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new OperatorExecutionError("invalid-payload", "relayPayload.chainlinkSigned must be an object");
    }
    const options = new PayloadReader(raw, "relayPayload.chainlinkSigned");
    const requestedVersion = options.has("seriesVersion") ? options.integer("seriesVersion", { min: 1 }) : null;
    const batchSequence = options.bigint("batchSequence", { fallback: 1n, min: 1n, max: (1n << 64n) - 1n });
    const keys = options.has("marketKeys") ? stringList(raw, "marketKeys", "relayPayload.chainlinkSigned") : null;
    const markets = keys ? keys.map((key) => requireMarket(deployment, key)) : [...deployment.markets];
    if (intent.marketId !== undefined) {
      const only = requireMarketById(deployment, intent.marketId);
      if (!markets.some((market) => market.marketId === only.marketId)) {
        throw new OperatorExecutionError("invalid-payload", `intent market ${only.marketKey} is outside relayPayload.chainlinkSigned.marketKeys`);
      }
      markets.splice(0, markets.length, only);
    }
    const signer = client.oracleSignerAddress;
    if (!signer) throw new OperatorExecutionError("config-invalid", `SETRYN_ORACLE_SIGNER_KEY is required for chainlink-signed fixings on ${client.environment}`);
    if (!network.oracleSigners.includes(signer)) {
      throw new OperatorExecutionError("config-invalid", `oracle signer ${signer} is not one of the fixing adapter's publishers ${network.oracleSigners.join(", ")}`);
    }
    if (network.oracleThreshold > 1) {
      throw new OperatorExecutionError("precondition", `the fixing adapter needs ${network.oracleThreshold} publisher signatures; this relay signs with one`);
    }

    const now = await client.chainNow();
    const fixingEngine = deployment.addresses.fixingEngine;
    const transactions: OperatorTransaction[] = [];
    const results: JsonObject[] = [];
    let failures = 0;
    let attempted = 0;
    const work = (
      await Promise.all(markets.map(async (market) =>
        (await this.#catalog.workVersions(market.seriesId, requestedVersion)).map((seriesVersion) => ({ market, seriesVersion })),
      ))
    ).flat();
    for (const { market, seriesVersion } of work) {
      const base = { marketKey: market.marketKey, seriesId: market.seriesId, seriesVersion, benchmarkId: market.benchmarkId };
      try {
        const slots = await this.#catalog.fixingSlots(market.seriesId, seriesVersion);
        const submissions: PayloadReader[] = [];
        const observed: JsonObject[] = [];
        let skip: { outcome: string; reason: string } | null = null;
        for (const fixingSlot of slots) {
          const candidate = fixingSlot.candidates[0];
          if (!candidate) throw new OperatorExecutionError("precondition", `slot ${fixingSlot.slot} has no fixing candidate`);
          if (now < candidate.targetAt || candidate.targetAt >= candidate.windowEndsAt) {
            skip = {
              outcome: "not-due",
              reason: now < candidate.targetAt ? `fixing target ${candidate.targetAt} not reached at chain time ${now}` : "fixing window closed before the target",
            };
            break;
          }
          const status = await client.read("read fixing status", (reader) =>
            reader.readContract({ address: fixingEngine, abi: abis.fixingEngine, functionName: "fixingStatus", args: [market.seriesId, seriesVersion, fixingSlot.slot] }),
          );
          if (status === fixingStatus.proposed || status === fixingStatus.finalized) {
            skip = { outcome: "previously-relayed", reason: `slot ${fixingSlot.slot} is ${enumName(fixingStatusNames, status)}` };
            break;
          }
          if (candidate.minimumObservations > 1) {
            throw new OperatorExecutionError("precondition", `candidate needs ${candidate.minimumObservations} observations; the Chainlink relay attests one round`);
          }
          if (!market.referenceFeed) throw new OperatorExecutionError("config-invalid", `${market.marketKey} has no referenceFeed in the runtime`);
          attempted += 1;
          const benchmark = await this.#benchmark(candidate.benchmarkId, candidate.benchmarkVersion);
          const reference = await this.#reference(network.referenceChainId);
          const round = await reference.roundAt(market.referenceFeed, candidate.targetAt);
          if (round === null) {
            skip = { outcome: "not-due", reason: `reference chain has not reached the fixing target ${candidate.targetAt}` };
            break;
          }
          const staleness = candidate.targetAt - round.updatedAt;
          if (benchmark.definition.maxStalenessSeconds > 0 && staleness > BigInt(benchmark.definition.maxStalenessSeconds)) {
            throw new OperatorExecutionError(
              "precondition",
              `Chainlink round ${round.roundId} for ${market.referenceFeed} is ${staleness}s old at the target, beyond the benchmark's ${benchmark.definition.maxStalenessSeconds}s`,
            );
          }
          const value = rescale(round.answer, round.decimals, benchmark.definition.outputDecimals);
          const roundWords = encodeAbiParameters(
            [{ type: "uint256" }, { type: "address" }, { type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }],
            [BigInt(network.referenceChainId), market.referenceFeed, round.roundId, round.answer, round.startedAt, round.updatedAt],
          );
          submissions.push(new PayloadReader({
            slot: fixingSlot.slot,
            candidateIndex: 0,
            observations: [{
              value: value.toString(),
              observedAt: candidate.targetAt.toString(),
              publishedAt: candidate.targetAt.toString(),
              providerSequence: ((round.roundId & ((1n << 64n) - 1n)) || 1n).toString(),
              finalityReference: keccak256(encodePacked(["string", "bytes"], ["setryn.chainlink.round.v1", roundWords])),
              itemEvidenceHash: keccak256(encodePacked(["string", "bytes"], ["setryn.chainlink.answer.v1", roundWords])),
              sequencerProofHash: keccak256(encodePacked(["string", "uint256"], ["setryn.chainlink.reference-chain.v1", BigInt(network.referenceChainId)])),
            }],
          }, `chainlinkSigned.${market.marketKey}.slot${fixingSlot.slot}`));
          observed.push({
            slot: fixingSlot.slot,
            referenceFeed: market.referenceFeed,
            roundId: round.roundId.toString(),
            answer: round.answer.toString(),
            answerDecimals: round.decimals,
            updatedAt: round.updatedAt.toString(),
            targetAt: candidate.targetAt.toString(),
            value: value.toString(),
            decimals: benchmark.definition.outputDecimals,
          });
        }
        if (skip) {
          results.push({ ...base, ...skip });
          continue;
        }
        const outcome = await this.#relaySeries({
          seriesId: market.seriesId,
          seriesVersion,
          feedKey: null,
          feedLabel: "chainlink-signed",
          submissions,
          signing: { adapter: network.fixingAdapter, batchSequence },
        });
        transactions.push(...outcome.transactions);
        results.push({
          ...base,
          outcome: outcome.details.previouslyRelayed === true ? "previously-relayed" : "proposed",
          observations: observed,
          details: jsonSafe(outcome.details) as JsonObject,
        });
      } catch (error) {
        if (error instanceof OperatorExecutionError && error.retryable && !isContractRevert(error)) throw error;
        failures += 1;
        results.push({ ...base, outcome: "failed", reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (attempted > 0 && failures === attempted) {
      throw new OperatorExecutionError("precondition", `every chainlink-signed relay failed: ${results.filter((result) => result.outcome === "failed").map((result) => `${result.marketKey}: ${String(result.reason)}`).join("; ")}`, {
        details: { results },
      });
    }
    return completed({ mode: "chainlink-signed", signer, batchSequence, seriesVersion: requestedVersion, chainTime: now, results }, transactions);
  }

  #referenceReader: ChainlinkReference | null = null;

  async #reference(referenceChainId: number): Promise<ChainlinkReference> {
    if (!this.#referenceReader) this.#referenceReader = await ChainlinkReference.connect(this.#client.referenceRpcUrl, referenceChainId);
    return this.#referenceReader;
  }

  /** EIP-712 SetrynSignedObservationBatchV1 over the engine's validation context, as SignedObservationFixingAdapter verifies. */
  async #signBatch(request: {
    readonly adapter: Address;
    readonly batchSequence: bigint;
    readonly seriesId: Hex;
    readonly seriesVersion: number;
    readonly slot: number;
    readonly candidateIndex: number;
    readonly candidate: FixingSlot["candidates"][number];
    readonly benchmark: { readonly versionHash: Hex; readonly definition: { readonly feedKey: Hex; readonly requiredCapabilityHash: Hex } };
    readonly observations: readonly RelayObservation[];
  }): Promise<Hex> {
    const client = this.#client;
    const { deployment } = client;
    const observationsHash = hashObservations(request.observations);
    const message = {
      fixingEngine: deployment.addresses.fixingEngine,
      seriesId: request.seriesId,
      seriesVersion: request.seriesVersion,
      slot: request.slot,
      candidateIndex: request.candidateIndex,
      benchmarkId: request.candidate.benchmarkId,
      benchmarkVersion: request.candidate.benchmarkVersion,
      benchmarkVersionHash: request.benchmark.versionHash,
      feedKey: request.benchmark.definition.feedKey,
      capabilityHash: request.benchmark.definition.requiredCapabilityHash,
      selectionRuleId: request.candidate.selectionRuleId,
      selectionParametersHash: request.candidate.selectionParametersHash,
      observationsHash,
      batchSequence: request.batchSequence,
    } as const;
    const typed = {
      domain: { name: "Setryn", version: "1", chainId: client.expectedChainId, verifyingContract: request.adapter },
      types: signedObservationBatchTypes,
      primaryType: "SetrynSignedObservationBatchV1",
      message,
    } as const;
    // The adapter computes the digest from the engine's context; agreeing with it here means the signature verifies.
    const onchainDigest = await client.read("read signed batch digest", (reader) =>
      reader.readContract({
        address: request.adapter,
        abi: signedObservationAdapterAbi,
        functionName: "batchDigest",
        args: [{
          chainId: BigInt(client.expectedChainId),
          fixingEngine: message.fixingEngine,
          seriesId: message.seriesId,
          seriesVersion: message.seriesVersion,
          slot: message.slot,
          candidateIndex: message.candidateIndex,
          benchmarkId: message.benchmarkId,
          benchmarkVersion: message.benchmarkVersion,
          benchmarkVersionHash: message.benchmarkVersionHash,
          feedKey: message.feedKey,
          requiredCapabilityHash: message.capabilityHash,
          selectionRuleId: message.selectionRuleId,
          selectionParametersHash: message.selectionParametersHash,
          observationsHash,
          candidateDeadline: request.candidate.unavailableAfter,
        }, request.batchSequence],
      }),
    );
    const digest = hashTypedData(typed);
    if (onchainDigest.toLowerCase() !== digest.toLowerCase()) {
      throw new OperatorExecutionError("precondition", `signed batch digest ${digest} disagrees with the fixing adapter's ${onchainDigest}`);
    }
    const signature = await client.signTypedDataAsOracle("sign observation batch", typed);
    return encodeAbiParameters([{ type: "uint64" }, { type: "bytes[]" }], [request.batchSequence, [signature]]);
  }

  async #benchmark(benchmarkId: Hex, benchmarkVersion: number) {
    const { deployment } = this.#client;
    return this.#client.read("read benchmark", (reader) =>
      reader.readContract({
        address: deployment.addresses.benchmarkRegistry,
        abi: abis.benchmarkRegistry,
        functionName: "getBenchmark",
        args: [benchmarkId, benchmarkVersion],
      }),
    );
  }

  /** Validates and submits evidence for one series. `feedKey` null accepts each candidate's own registered feed. */
  async #relaySeries(request: {
    readonly seriesId: Hex;
    readonly seriesVersion: number;
    readonly feedKey: Hex | null;
    readonly feedLabel: string;
    readonly submissions: readonly PayloadReader[];
    /** Signs each submission's batch for a signed-observation adapter instead of taking `adapterEvidence`. */
    readonly signing?: { readonly adapter: Address; readonly batchSequence: bigint };
  }): Promise<{ readonly details: Record<string, unknown>; readonly transactions: OperatorTransaction[] }> {
    const client = this.#client;
    const { deployment } = client;
    const { seriesId, seriesVersion, submissions } = request;
    const fixingSlots = await this.#catalog.fixingSlots(seriesId, seriesVersion);
    if (fixingSlots.length > 1 && submissions.length !== fixingSlots.length) {
      throw new OperatorExecutionError("invalid-payload", `series has ${fixingSlots.length} fixing slots; relay every slot in submissions`);
    }

    const fixingEngine = deployment.addresses.fixingEngine;
    const engineInterface = await client.read("read fixing adapter interface", (reader) =>
      reader.readContract({ address: fixingEngine, abi: abis.fixingEngine, functionName: "FIXING_ADAPTER_INTERFACE_HASH" }),
    );
    const now = await client.chainNow();
    const prepared = [];
    for (const submission of submissions) {
      const slot = submission.integer("slot", { fallback: 0, min: 0, max: fixingSlots.length - 1 });
      const candidateIndex = submission.integer("candidateIndex", { fallback: 0, min: 0 });
      const candidate = candidateFor(fixingSlots, slot, candidateIndex);
      const benchmark = await this.#benchmark(candidate.benchmarkId, candidate.benchmarkVersion);
      const feedKey = request.feedKey ?? benchmark.definition.feedKey;
      if (feedKey !== benchmark.definition.feedKey) {
        throw new OperatorExecutionError("invalid-payload", `feed ${request.feedLabel} is not the feed of benchmark ${candidate.benchmarkId}`);
      }
      if (benchmark.definition.requiredInterfaceHash !== engineInterface) {
        throw new OperatorExecutionError(
          "precondition",
          `benchmark ${candidate.benchmarkId} v${candidate.benchmarkVersion} requires adapter interface ${benchmark.definition.requiredInterfaceHash}, `
            + `but FixingEngine only accepts ${engineInterface}; no fixing can be relayed for this series and it resolves through the `
            + "permissionless terminal fallback after final resolution",
          { details: { benchmarkId: candidate.benchmarkId, requiredInterfaceHash: benchmark.definition.requiredInterfaceHash, engineInterfaceHash: engineInterface } },
        );
      }
      const observations = submission.objects("observations").map((observation, index) => {
        const observedAt = observation.bigint("observedAt", { fallback: candidate.targetAt, min: 0n });
        const value = observation.bigint("value");
        const label = `setryn.operator.oracle:${feedKey}:${seriesId}:${slot}:${observedAt}:${value}`;
        return {
          value,
          weight: observation.bigint("weight", { fallback: 1n, min: 0n }),
          observedAt,
          publishedAt: observation.bigint("publishedAt", { fallback: observedAt, min: observedAt }),
          providerSequence: observation.bigint("providerSequence", { fallback: observedAt, min: 1n }),
          confidenceBps: observation.integer("confidenceBps", { fallback: 0, min: 0, max: benchmark.definition.maxConfidenceBps }),
          decimals: benchmark.definition.outputDecimals,
          finalityReference: observation.bytes32("finalityReference", keccak256(stringToHex(`${label}:finality`))),
          itemEvidenceHash: observation.bytes32("itemEvidenceHash", keccak256(stringToHex(`${label}:item:${index}`))),
          sequencer: {
            sequencerUp: true,
            inRecoveryGrace: false,
            recoveryGraceEndsAt: 0n,
            proofHash: observation.bytes32("sequencerProofHash", keccak256(stringToHex(`${label}:sequencer`))),
          },
        };
      });
      if (observations.length === 0) throw new OperatorExecutionError("invalid-payload", `slot ${slot} has no observations`);
      for (const observation of observations) {
        if (observation.observedAt < candidate.windowStartsAt || observation.observedAt >= candidate.windowEndsAt) {
          throw new OperatorExecutionError(
            "invalid-payload",
            `observation at ${observation.observedAt} is outside the fixing window [${candidate.windowStartsAt}, ${candidate.windowEndsAt})`,
          );
        }
        if (observation.publishedAt > now) {
          throw new OperatorExecutionError("precondition", `observation published at ${observation.publishedAt} is after chain time ${now}; relay later`, {
            retryable: true,
          });
        }
      }
      prepared.push({
        slot,
        candidateIndex,
        observations,
        adapterEvidence: request.signing
          ? await this.#signBatch({ ...request.signing, seriesId, seriesVersion, slot, candidateIndex, candidate, benchmark, observations })
          : submission.hex("adapterEvidence", stringToHex(`setryn.operator.oracle-relay.v1:${feedKey}:${slot}:${candidateIndex}`)),
      });
    }

    const existing = await this.#existingOutcome(seriesId, seriesVersion, prepared);
    if (existing) return { details: { seriesId, seriesVersion, previouslyRelayed: true, ...existing }, transactions: [] };

    const write = prepared.length === 1 && fixingSlots.length === 1
      ? await client.write("submit fixing evidence", {
        address: fixingEngine,
        abi: abis.fixingEngine,
        functionName: "submitEvidence",
        args: [seriesId, seriesVersion, fixingSlots.map(toAbiSlot), prepared[0]!.slot, prepared[0]!.candidateIndex, prepared[0]!.observations, prepared[0]!.adapterEvidence],
      })
      : await client.write("submit fixing evidence vector", {
        address: fixingEngine,
        abi: abis.fixingEngine,
        functionName: "submitEvidenceVector",
        args: [seriesId, seriesVersion, fixingSlots.map(toAbiSlot), prepared],
      });
    const proposals = parseEventLogs({ abi: abis.fixingEngine, eventName: "FixingEvidenceProposed", logs: write.receipt.logs, strict: true });
    return {
      details: {
        seriesId,
        seriesVersion,
        chainTime: now,
        proposals: proposals.map((event) => ({
          fixingKey: event.args.fixingKey,
          slot: event.args.slot,
          candidateIndex: event.args.candidateIndex,
          proposalHash: event.args.proposalHash,
          value: event.args.value,
          decimals: event.args.decimals,
        })),
      },
      transactions: [transactionSummary(write)],
    };
  }

  async #existingOutcome(
    seriesId: Hex,
    seriesVersion: number,
    prepared: readonly { readonly slot: number; readonly candidateIndex: number; readonly observations: readonly { readonly value: bigint; readonly observedAt: bigint }[] }[],
  ): Promise<Record<string, unknown> | null> {
    const fixingEngine = this.#client.deployment.addresses.fixingEngine;
    const outcomes: Record<string, unknown>[] = [];
    for (const submission of prepared) {
      const status = await this.#client.read("read fixing status", (reader) =>
        reader.readContract({ address: fixingEngine, abi: abis.fixingEngine, functionName: "fixingStatus", args: [seriesId, seriesVersion, submission.slot] }),
      );
      if (status === fixingStatus.finalized) {
        outcomes.push({ slot: submission.slot, status: enumName(fixingStatusNames, status) });
        continue;
      }
      if (status !== fixingStatus.proposed) return null;
      const proposal = await this.#client.read("read fixing proposal", (reader) =>
        reader.readContract({ address: fixingEngine, abi: abis.fixingEngine, functionName: "getProposal", args: [seriesId, seriesVersion, submission.slot] }),
      );
      const first = submission.observations[0]!;
      const same = proposal.candidateIndex === submission.candidateIndex
        && proposal.observationCount === submission.observations.length
        && proposal.firstObservedAt === first.observedAt
        && (submission.observations.length !== 1 || proposal.value === first.value);
      if (!same) return null;
      outcomes.push({ slot: submission.slot, status: enumName(fixingStatusNames, status), proposalHash: proposal.proposalHash });
    }
    return { outcomes };
  }
}

function candidateFor(slots: readonly FixingSlot[], slot: number, candidateIndex: number) {
  const fixingSlot = slots.find((candidate) => candidate.slot === slot);
  const candidate = fixingSlot?.candidates[candidateIndex];
  if (!candidate) throw new OperatorExecutionError("invalid-payload", `series has no fixing candidate ${candidateIndex} in slot ${slot}`);
  return candidate;
}

export function toAbiSlot(slot: FixingSlot) {
  return { slot: slot.slot, candidates: slot.candidates.map((candidate) => ({ ...candidate })) };
}

/** Deterministic per-benchmark fixture offset in [-80, 80] bps unless the payload pins one. */
function fixtureOffsetBps(benchmarkId: Hex, overrides: unknown): number {
  if (overrides !== null && overrides !== undefined) {
    if (typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new OperatorExecutionError("invalid-payload", "relayPayload.fixtures.offsetsBps must map benchmark ids to integers");
    }
    const entry = Object.entries(overrides as Record<string, unknown>).find(([key]) => key.toLowerCase() === benchmarkId);
    if (entry) {
      const value = entry[1];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= -10_000 || value >= 10_000) {
        throw new OperatorExecutionError("invalid-payload", `relayPayload.fixtures.offsetsBps.${benchmarkId} must be an integer in (-10000, 10000)`);
      }
      return value;
    }
  }
  const word = BigInt(keccak256(encodePacked(["string", "bytes32"], ["setryn.devnet.fixture-offset.v1", benchmarkId])));
  return Number(word % 161n) - 80;
}

function rescale(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (toDecimals === fromDecimals) return value;
  return toDecimals > fromDecimals ? value * 10n ** BigInt(toDecimals - fromDecimals) : value / 10n ** BigInt(fromDecimals - toDecimals);
}

function stringList(value: JsonObject, key: string, path = "relayPayload.fixtures"): string[] {
  const list = value[key];
  if (!Array.isArray(list) || list.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new OperatorExecutionError("invalid-payload", `${path}.${key} must be an array of market keys`);
  }
  return list as string[];
}

interface RelayObservation {
  readonly value: bigint;
  readonly weight: bigint;
  readonly observedAt: bigint;
  readonly publishedAt: bigint;
  readonly providerSequence: bigint;
  readonly confidenceBps: number;
  readonly decimals: number;
  readonly finalityReference: Hex;
  readonly itemEvidenceHash: Hex;
  readonly sequencer: { readonly sequencerUp: boolean; readonly inRecoveryGrace: boolean; readonly recoveryGraceEndsAt: bigint; readonly proofHash: Hex };
}

const sequencerEvidenceTypeHash = keccak256(stringToHex(
  "SetrynSequencerEvidenceV1(bool sequencerUp,bool inRecoveryGrace,uint64 recoveryGraceEndsAt,bytes32 proofHash)",
));
const observationTypeHash = keccak256(stringToHex(
  "SetrynHistoricalObservationV1(int256 value,uint128 weight,uint64 observedAt,uint64 publishedAt,uint64 providerSequence,uint16 confidenceBps,uint8 decimals,bytes32 finalityReference,bytes32 itemEvidenceHash,bytes32 sequencerEvidenceHash)",
));
const observationsTypeHash = keccak256(stringToHex("SetrynHistoricalObservationsV1(bytes32 observationHashesHash)"));

/** FixingEvidenceLib.hashObservations: the observations hash the engine puts in the adapter's validation context. */
function hashObservations(observations: readonly RelayObservation[]): Hex {
  const hashes = observations.map((observation) => {
    const sequencerHash = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bool" }, { type: "bool" }, { type: "uint64" }, { type: "bytes32" }],
      [sequencerEvidenceTypeHash, observation.sequencer.sequencerUp, observation.sequencer.inRecoveryGrace, observation.sequencer.recoveryGraceEndsAt, observation.sequencer.proofHash],
    ));
    return keccak256(encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "int256" }, { type: "uint128" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" },
        { type: "uint16" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      ],
      [
        observationTypeHash, observation.value, observation.weight, observation.observedAt, observation.publishedAt, observation.providerSequence,
        observation.confidenceBps, observation.decimals, observation.finalityReference, observation.itemEvidenceHash, sequencerHash,
      ],
    ));
  });
  const packed = hashes.length === 0 ? "0x" : encodePacked(hashes.map(() => "bytes32"), hashes);
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [observationsTypeHash, keccak256(packed)]));
}

/** SignedObservationFixingAdapter.BATCH_TYPESTRING under the Setryn EIP-712 domain (chain, adapter). */
const signedObservationBatchTypes = {
  SetrynSignedObservationBatchV1: [
    { name: "fixingEngine", type: "address" },
    { name: "seriesId", type: "bytes32" },
    { name: "seriesVersion", type: "uint32" },
    { name: "slot", type: "uint8" },
    { name: "candidateIndex", type: "uint8" },
    { name: "benchmarkId", type: "bytes32" },
    { name: "benchmarkVersion", type: "uint32" },
    { name: "benchmarkVersionHash", type: "bytes32" },
    { name: "feedKey", type: "bytes32" },
    { name: "capabilityHash", type: "bytes32" },
    { name: "selectionRuleId", type: "bytes32" },
    { name: "selectionParametersHash", type: "bytes32" },
    { name: "observationsHash", type: "bytes32" },
    { name: "batchSequence", type: "uint64" },
  ],
} as const;

const signedObservationAdapterAbi = [
  {
    type: "function",
    name: "batchDigest",
    stateMutability: "view",
    inputs: [
      {
        name: "context",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "fixingEngine", type: "address" },
          { name: "seriesId", type: "bytes32" },
          { name: "seriesVersion", type: "uint32" },
          { name: "slot", type: "uint8" },
          { name: "candidateIndex", type: "uint8" },
          { name: "benchmarkId", type: "bytes32" },
          { name: "benchmarkVersion", type: "uint32" },
          { name: "benchmarkVersionHash", type: "bytes32" },
          { name: "feedKey", type: "bytes32" },
          { name: "requiredCapabilityHash", type: "bytes32" },
          { name: "selectionRuleId", type: "bytes32" },
          { name: "selectionParametersHash", type: "bytes32" },
          { name: "observationsHash", type: "bytes32" },
          { name: "candidateDeadline", type: "uint64" },
        ],
      },
      { name: "batchSequence", type: "uint64" },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
] as const;

const chainlinkAggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

interface ChainlinkRound {
  readonly roundId: bigint;
  readonly answer: bigint;
  readonly startedAt: bigint;
  readonly updatedAt: bigint;
  readonly decimals: number;
}

/**
 * Read-only Chainlink access on the reference chain (Arbitrum One). Only eth_call and block reads are issued; the
 * client has no account, so nothing can be signed or sent through it.
 */
class ChainlinkReference {
  readonly #reader: PublicClient;
  readonly #decimals = new Map<Address, number>();

  private constructor(reader: PublicClient) {
    this.#reader = reader;
  }

  static async connect(rpcUrl: string, expectedChainId: number): Promise<ChainlinkReference> {
    const reader = createPublicClient({ transport: http(rpcUrl, { retryCount: 2 }) });
    let chainId: number;
    try {
      chainId = await reader.getChainId();
    } catch (error) {
      throw describeChainError(error, "reference chain-id check");
    }
    if (chainId !== expectedChainId) {
      throw new OperatorExecutionError("chain-mismatch", `SETRYN_REFERENCE_RPC_URL reports chain ${chainId}, expected ${expectedChainId}`);
    }
    return new ChainlinkReference(reader);
  }

  /**
   * The round in force at `target`: the latest round updated at or before it. Walks back from latestRoundData with a
   * doubling step, then bisects, within the aggregator's current phase. Null while the reference chain has not
   * reached `target`, since a later round could still land before it.
   */
  async roundAt(feed: Address, target: bigint): Promise<ChainlinkRound | null> {
    const decimals = await this.#feedDecimals(feed);
    const block = await this.#read("read reference block", () => this.#reader.getBlock({ blockTag: "latest" }));
    if (block.timestamp < target) return null;
    const [latestId, ...latestRest] = await this.#read("read latest Chainlink round", () =>
      this.#reader.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "latestRoundData" }),
    );
    const toRound = (roundId: bigint, rest: readonly [bigint, bigint, bigint, bigint]): ChainlinkRound => {
      if (rest[0] <= 0n) throw new OperatorExecutionError("precondition", `Chainlink round ${roundId} on ${feed} has a non-positive answer ${rest[0]}`);
      return { roundId, answer: rest[0], startedAt: rest[1], updatedAt: rest[2], decimals };
    };
    if (latestRest[2] <= target) return toRound(latestId, latestRest as [bigint, bigint, bigint, bigint]);

    const phase = latestId >> 64n;
    const aggregatorMask = (1n << 64n) - 1n;
    const updatedAt = async (aggregatorRound: bigint) => {
      const roundId = (phase << 64n) | aggregatorRound;
      const [, ...rest] = await this.#read(`read Chainlink round ${roundId}`, () =>
        this.#reader.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "getRoundData", args: [roundId] }),
      );
      return { roundId, rest: rest as [bigint, bigint, bigint, bigint] };
    };
    let high = latestId & aggregatorMask; // updated after the target
    let low = 0n;
    let found: { roundId: bigint; rest: [bigint, bigint, bigint, bigint] } | null = null;
    for (let step = 1n; ; step *= 2n) {
      if (high <= 1n) {
        throw new OperatorExecutionError("precondition", `the Chainlink round in force at ${target} on ${feed} precedes the aggregator's current phase`);
      }
      const candidate = high - step >= 1n ? high - step : 1n;
      const round = await updatedAt(candidate);
      if (round.rest[2] !== 0n && round.rest[2] <= target) {
        low = candidate;
        found = round;
        break;
      }
      high = candidate;
    }
    while (high - low > 1n) {
      const middle: bigint = (low + high) / 2n;
      const round = await updatedAt(middle);
      if (round.rest[2] !== 0n && round.rest[2] <= target) {
        low = middle;
        found = round;
      } else {
        high = middle;
      }
    }
    return toRound(found!.roundId, found!.rest);
  }

  async #feedDecimals(feed: Address): Promise<number> {
    const cached = this.#decimals.get(feed);
    if (cached !== undefined) return cached;
    const decimals = await this.#read("read Chainlink decimals", () =>
      this.#reader.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "decimals" }),
    );
    this.#decimals.set(feed, decimals);
    return decimals;
  }

  async #read<T>(action: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw describeChainError(error, action);
    }
  }
}
