import type { JsonObject } from "@setryn/internal-schemas";
import { encodePacked, keccak256, parseEventLogs, stringToHex, type Hex } from "viem";

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
 *   seriesId?: bytes32, seriesVersion?: integer,          // default: the intent market's series (else the primary), v1
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
 *     seriesVersion?: integer                             // default 1
 *   }
 * }
 *    One value per benchmark, shared by every series that fixes on it so the devnet tape stays coherent: the forward
 *    reference (the payoff terms' primary strike) of the benchmark's first listed market, moved by the benchmark's
 *    offset and rescaled to the benchmark's output decimals. Each series whose fixing window has reached its target
 *    time gets the value as evidence; series already proposed or final with it are reported, not resubmitted.
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
      const result = payload.has("fixtures") ? await this.#relayFixtures(intent, payload) : await this.#relay(intent, payload);
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
    const seriesVersion = payload.integer("seriesVersion", { fallback: 1, min: 1 });
    const feedKey = /^0x[0-9a-fA-F]{64}$/.test(intent.feedKey) ? (intent.feedKey.toLowerCase() as Hex) : keccak256(stringToHex(intent.feedKey));
    const submissions = payload.has("submissions") ? payload.objects("submissions") : [payload];
    const outcome = await this.#relaySeries({ seriesId, seriesVersion, feedKey, feedLabel: intent.feedKey, submissions });
    return completed({ marketKey: market.marketKey, ...outcome.details }, outcome.transactions);
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
    const seriesVersion = options.integer("seriesVersion", { fallback: 1, min: 1 });
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
    for (const market of markets) {
      const slots = await this.#catalog.fixingSlots(market.seriesId, seriesVersion);
      const base = { marketKey: market.marketKey, seriesId: market.seriesId, benchmarkId: market.benchmarkId };
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
    if (markets.length > 0 && failures === markets.length) {
      throw new OperatorExecutionError("precondition", `every fixture relay failed: ${results.map((result) => `${result.marketKey}: ${String(result.reason)}`).join("; ")}`, {
        details: { results },
      });
    }
    return completed({ mode: "devnet-fixtures", seriesVersion, chainTime: now, benchmarks, results }, transactions);
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
        adapterEvidence: submission.hex("adapterEvidence", stringToHex(`setryn.operator.oracle-relay.v1:${feedKey}:${slot}:${candidateIndex}`)),
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

function stringList(value: JsonObject, key: string): string[] {
  const list = value[key];
  if (!Array.isArray(list) || list.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new OperatorExecutionError("invalid-payload", `relayPayload.fixtures.${key} must be an array of market keys`);
  }
  return list as string[];
}
