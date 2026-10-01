import type { Address } from "@/lib/auctions/types";

/**
 * Liquidity participants. The only participant a deployment registers is its optional designated maker, whose address
 * the operator status route reports; the eligible maker set itself is committed onchain by hash only. No modeled desks or
 * solvers are listed.
 */

export type ParticipantKind = "SOLVER" | "MAKER";

export interface Participant {
  id: string;
  label: string;
  kind: ParticipantKind;
  address: Address;
  qualification: "QUALIFIED" | "CONDITIONAL";
  /** Bonded capacity in USDC, when the participant posts a bond; zero when none is reported. */
  bondedCapacityUsd: number;
  /** Seconds; zero when not measured. */
  responseSeconds: number;
  source: "OBSERVED" | "MODELED";
  note: string;
}

/** Participants known from chain or the operator status. Empty until a reader lists them. */
export const PARTICIPANTS: Participant[] = [];

export function participant(id: string): Participant | null {
  return PARTICIPANTS.find((entry) => entry.id === id) ?? null;
}

/** The deployment's designated maker as a participant, from the operator status route's public address. */
export function designatedMaker(address: string | null): Participant | null {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return {
    id: "DESIGNATED-MAKER",
    label: "Designated maker",
    kind: "MAKER",
    address: address as Address,
    qualification: "QUALIFIED",
    bondedCapacityUsd: 0,
    responseSeconds: 0,
    source: "OBSERVED",
    note: "The deployment's own maker key; it answers private requests and may rest quotes on the books.",
  };
}
