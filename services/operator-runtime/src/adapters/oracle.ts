import { keccak256, parseEventLogs, stringToHex, type Hex } from "viem";

import type { OracleRelayExecutionPort } from "../ports.ts";
import type { OperatorExecutionContext, OperatorExecutionResult, OracleRelayIntent } from "../types.ts";
import { transactionSummary, type OperatorChainClient } from "./chain.ts";
import { describeChainError, OperatorExecutionError } from "./errors.ts";
import { PayloadReader } from "./payload.ts";
import { abis, enumName, fixingStatus, fixingStatusNames } from "./protocol.ts";
import { assertIntentEnvironment, completed } from "./results.ts";
import { SeriesCatalog, type FixingSlot } from "./series.ts";

/**
 * Accepted `relayPayload` for an oracle-relay intent. `feedKey` is the benchmark feed name (for example
 * "Crypto.BTC/USD") or its 32-byte keccak, and must match the benchmark the series' fixing candidate names.
 *
 * {
 *   seriesId?: bytes32, seriesVersion?: integer,          // default: the deployed series, version 1
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
      const result = await this.#relay(intent);
      this.#results.set(intent.idempotencyKey, result);
      return result;
    } catch (error) {
      throw describeChainError(error, `oracle relay ${intent.idempotencyKey}`);
    }
  }

  async #relay(intent: OracleRelayIntent): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const payload = new PayloadReader(intent.relayPayload, "relayPayload");
    const seriesId = payload.bytes32("seriesId", deployment.ids.seriesId);
    const seriesVersion = payload.integer("seriesVersion", { fallback: 1, min: 1 });
    if (intent.marketId !== undefined && intent.marketId.toLowerCase() !== deployment.ids.marketId) {
      throw new OperatorExecutionError("invalid-payload", `market ${intent.marketId} is not the deployed market`);
    }
    const fixingSlots = await this.#catalog.fixingSlots(seriesId, seriesVersion);
    const submissions = payload.has("submissions")
      ? payload.objects("submissions")
      : [payload];
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
      const benchmark = await client.read("read benchmark", (reader) =>
        reader.readContract({
          address: deployment.addresses.benchmarkRegistry,
          abi: abis.benchmarkRegistry,
          functionName: "getBenchmark",
          args: [candidate.benchmarkId, candidate.benchmarkVersion],
        }),
      );
      const feedKey = /^0x[0-9a-fA-F]{64}$/.test(intent.feedKey) ? (intent.feedKey.toLowerCase() as Hex) : keccak256(stringToHex(intent.feedKey));
      if (feedKey !== benchmark.definition.feedKey) {
        throw new OperatorExecutionError("invalid-payload", `feed ${intent.feedKey} is not the feed of benchmark ${candidate.benchmarkId}`);
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
    if (existing) return completed({ seriesId, seriesVersion, previouslyRelayed: true, ...existing }, []);

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
    return completed(
      {
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
      [transactionSummary(write)],
    );
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
