import type { Hex } from "viem";

import type { OperatorChainClient } from "./chain.ts";
import { OperatorExecutionError } from "./errors.ts";
import { abis } from "./protocol.ts";

const maximumFixingSlots = 16;

export interface FixingCandidate {
  readonly benchmarkId: Hex;
  readonly benchmarkVersion: number;
  readonly requiredWindowKindId: Hex;
  readonly selectionRuleId: Hex;
  readonly targetAt: bigint;
  readonly windowStartsAt: bigint;
  readonly windowEndsAt: bigint;
  readonly unavailableAfter: bigint;
  readonly maxPublicationLagSeconds: number;
  readonly minimumObservations: number;
  readonly maximumObservations: number;
  readonly selectionParametersHash: Hex;
}

export interface FixingSlot {
  readonly slot: number;
  readonly candidates: readonly FixingCandidate[];
}

export interface SeriesSchedule {
  readonly seriesId: Hex;
  readonly version: number;
  readonly lastTradingAt: bigint;
  readonly fixingWindowOpen: bigint;
  readonly fixingWindowClose: bigint;
  readonly primaryEvidenceDeadline: bigint;
  readonly correctionCutoffAt: bigint;
  readonly finalResolutionAt: bigint;
  readonly settlementDeadline: bigint;
  readonly fixingSlotsHash: Hex;
  readonly exercisePolicyId: Hex;
  readonly exerciseOpensAt: bigint;
  readonly exerciseCutoffAt: bigint;
}

/**
 * Series schedule and qualified fixing slots, reconstructed from SeriesQualificationPublished and accepted only when
 * they hash to the fixing-slot commitment the registry stores for that exact version.
 */
export class SeriesCatalog {
  readonly #client: OperatorChainClient;
  readonly #slots = new Map<string, readonly FixingSlot[]>();

  constructor(client: OperatorChainClient) {
    this.#client = client;
  }

  async schedule(seriesId: Hex, version: number): Promise<SeriesSchedule> {
    const record = await this.#client.read("read series", (reader) =>
      reader.readContract({
        address: this.#client.deployment.addresses.seriesRegistry,
        abi: abis.seriesRegistry,
        functionName: "getSeries",
        args: [seriesId, version],
      }),
    );
    const definition = record.definition;
    return {
      seriesId,
      version,
      lastTradingAt: definition.lastTradingAt,
      fixingWindowOpen: definition.fixingWindowOpen,
      fixingWindowClose: definition.fixingWindowClose,
      primaryEvidenceDeadline: definition.primaryEvidenceDeadline,
      correctionCutoffAt: definition.correctionCutoffAt,
      finalResolutionAt: definition.finalResolutionAt,
      settlementDeadline: definition.settlementDeadline,
      fixingSlotsHash: definition.fixingSlotsHash,
      exercisePolicyId: definition.exercisePolicyId,
      exerciseOpensAt: definition.exerciseOpensAt,
      exerciseCutoffAt: definition.exerciseCutoffAt,
    };
  }

  async fixingSlots(seriesId: Hex, version: number): Promise<readonly FixingSlot[]> {
    const key = `${seriesId}:${version}`;
    const cached = this.#slots.get(key);
    if (cached) return cached;
    const { deployment } = this.#client;
    const record = await this.#client.read("read series", (reader) =>
      reader.readContract({ address: deployment.addresses.seriesRegistry, abi: abis.seriesRegistry, functionName: "getSeries", args: [seriesId, version] }),
    );
    const events = await this.#client.read("read series qualification", (reader) =>
      reader.getContractEvents({
        address: deployment.addresses.seriesRegistry,
        abi: abis.seriesRegistry,
        eventName: "SeriesQualificationPublished",
        args: { seriesId, version },
        fromBlock: deployment.deploymentBlock,
        toBlock: "latest",
        strict: true,
      }),
    );
    for (const event of [...events].reverse()) {
      const slots: FixingSlot[] = event.args.qualification.fixingSlots.map((slot) => ({
        slot: slot.slot,
        candidates: slot.candidates.map((candidate) => ({ ...candidate })),
      }));
      const committed = await this.#client.read("hash fixing slots", (reader) =>
        reader.readContract({
          address: deployment.addresses.seriesRegistry,
          abi: abis.seriesRegistry,
          functionName: "hashFixingSlots",
          args: [record.definition, slots, maximumFixingSlots],
        }),
      );
      if (committed !== record.definition.fixingSlotsHash) continue;
      this.#slots.set(key, slots);
      return slots;
    }
    throw new OperatorExecutionError(
      "precondition",
      `no published qualification for series ${seriesId} v${version} matches its fixing-slot commitment`,
    );
  }

  /** Positions opened on a series, discovered from PositionEngine.PositionCreated since the deployment block. */
  async positionIds(seriesId: Hex): Promise<Hex[]> {
    const { deployment } = this.#client;
    const events = await this.#client.read("read created positions", (reader) =>
      reader.getContractEvents({
        address: deployment.addresses.positionEngine,
        abi: abis.positionEngine,
        eventName: "PositionCreated",
        args: { seriesId },
        fromBlock: deployment.deploymentBlock,
        toBlock: "latest",
        strict: true,
      }),
    );
    return [...new Set(events.map((event) => event.args.positionId))];
  }
}
