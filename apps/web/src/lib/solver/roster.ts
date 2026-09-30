import type { Address } from "@/lib/auctions/types";

/**
 * Liquidity participants the modeled schedules and the RFQ builder refer to.
 *
 * Solver ids come from the market fixtures, whose solver-firm book rows name
 * their origin (for example "Solver SLV-07, bonded capacity"). Maker desks are
 * modeled. The devnet maker is the one participant a local runtime actually
 * registers in its qualified maker set.
 */

export type ParticipantKind = "SOLVER" | "MAKER";

export interface Participant {
  id: string;
  label: string;
  kind: ParticipantKind;
  /** Deterministic stand-in address; modeled participants never sign anything. */
  address: Address;
  qualification: "QUALIFIED" | "CONDITIONAL";
  bondedCapacityUsd: number;
  /** Seconds, the typical delay between a window opening and this participant committing. */
  responseSeconds: number;
  source: "MODELED" | "DEVNET";
  note: string;
}

function address(seed: number): Address {
  return `0x${seed.toString(16).padStart(4, "0").repeat(10)}` as Address;
}

/** The solver this workstation operates in the solver cockpit. */
export const OWN_SOLVER_ID = "SLV-07";

export const PARTICIPANTS: Participant[] = [
  {
    id: "SLV-07",
    label: "SLV-07",
    kind: "SOLVER",
    address: address(0x5707),
    qualification: "QUALIFIED",
    bondedCapacityUsd: 3_200_000,
    responseSeconds: 14,
    source: "MODELED",
    note: "Bonded package solver, BTC and FX routes",
  },
  {
    id: "SLV-02",
    label: "SLV-02",
    kind: "SOLVER",
    address: address(0x5702),
    qualification: "QUALIFIED",
    bondedCapacityUsd: 5_400_000,
    responseSeconds: 22,
    source: "MODELED",
    note: "Bonded FX and rates solver",
  },
  {
    id: "SLV-03",
    label: "SLV-03",
    kind: "SOLVER",
    address: address(0x5703),
    qualification: "QUALIFIED",
    bondedCapacityUsd: 2_100_000,
    responseSeconds: 9,
    source: "MODELED",
    note: "Funding and carry solver",
  },
  {
    id: "SLV-05",
    label: "SLV-05",
    kind: "SOLVER",
    address: address(0x5705),
    qualification: "QUALIFIED",
    bondedCapacityUsd: 1_800_000,
    responseSeconds: 31,
    source: "MODELED",
    note: "Metals and commodity solver",
  },
  {
    id: "SLV-11",
    label: "SLV-11",
    kind: "SOLVER",
    address: address(0x5711),
    qualification: "CONDITIONAL",
    bondedCapacityUsd: 900_000,
    responseSeconds: 40,
    source: "MODELED",
    note: "Basis solver, size-capped while qualification completes",
  },
  {
    id: "MKR-14",
    label: "Northgate Markets",
    kind: "MAKER",
    address: address(0x4d14),
    qualification: "QUALIFIED",
    bondedCapacityUsd: 4_000_000,
    responseSeconds: 6,
    source: "MODELED",
    note: "Options and OTC desk",
  },
  {
    id: "MKR-21",
    label: "Halden Liquidity",
    kind: "MAKER",
    address: address(0x4d21),
    qualification: "QUALIFIED",
    bondedCapacityUsd: 2_600_000,
    responseSeconds: 11,
    source: "MODELED",
    note: "Proprietary trading firm",
  },
  {
    id: "MKR-33",
    label: "Corvid Treasury Desk",
    kind: "MAKER",
    address: address(0x4d33),
    qualification: "CONDITIONAL",
    bondedCapacityUsd: 1_200_000,
    responseSeconds: 27,
    source: "MODELED",
    note: "Treasury desk, conditional on collateral attestation",
  },
  {
    id: "DEVNET-MM",
    label: "Setryn Devnet MM",
    kind: "MAKER",
    address: address(0xde00),
    qualification: "QUALIFIED",
    bondedCapacityUsd: 0,
    responseSeconds: 2,
    source: "DEVNET",
    note: "The only maker in the local runtime's qualified maker set",
  },
];

export function participant(id: string): Participant | null {
  return PARTICIPANTS.find((entry) => entry.id === id) ?? null;
}

/** Participants that bid in modeled auctions. The devnet maker only answers real local requests. */
export const AUCTION_BIDDERS = PARTICIPANTS.filter((entry) => entry.source === "MODELED");
