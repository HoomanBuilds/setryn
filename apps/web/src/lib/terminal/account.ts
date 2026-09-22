export const ACCOUNT = {
  workspace: "Preview workspace",
  subaccount: "Desk 01",
  riskDomain: "Crypto carry domain",
} as const;

export const ENVIRONMENT = {
  chain: "Arbitrum Sepolia",
} as const;

export type WithdrawalAvailability = "IMMEDIATE" | "SCHEDULED" | "LOCKED";

/**
 * One line of posted collateral. Value is the marked USDC value before the
 * haircut; eligible value and availability are derived, never authored twice.
 */
export interface CollateralAsset {
  id: string;
  asset: string;
  value: number;
  /** Fraction of value the risk engine discounts before it counts as margin. */
  haircut: number;
  /** Eligible value already pledged against open positions. */
  reserved: number;
  withdrawal: WithdrawalAvailability;
  withdrawalNote: string;
  source: string;
}

/**
 * Preview fixture. No wallet is connected in this build, so nothing here is a
 * balance, a claim, or anything that could be withdrawn.
 */
export const COLLATERAL: CollateralAsset[] = [
  {
    id: "usdc",
    asset: "USDC",
    value: 196_000,
    haircut: 0,
    reserved: 168_000,
    withdrawal: "IMMEDIATE",
    withdrawalNote: "Settles in the same block as the request.",
    source: "Venue settlement account",
  },
  {
    id: "usdc-term",
    asset: "USDC term receipt",
    value: 84_000,
    haircut: 0.05,
    reserved: 74_800,
    withdrawal: "SCHEDULED",
    withdrawalNote: "Redeems at the 24 Dec 2026 term maturity.",
    source: "USDC term financing book",
  },
  {
    id: "tbill",
    asset: "Tokenised T-bill note",
    value: 62_000,
    haircut: 0.08,
    reserved: 52_040,
    withdrawal: "SCHEDULED",
    withdrawalNote: "Redeems on the next business day after the request.",
    source: "Registered note custodian",
  },
  {
    id: "wsteth",
    asset: "wstETH",
    value: 36_000,
    haircut: 0.25,
    reserved: 10_720,
    withdrawal: "IMMEDIATE",
    withdrawalNote: "Transfers immediately at the haircut value.",
    source: "Liquid staking token",
  },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Marked value less the risk engine haircut: what the line counts as margin. */
export function eligibleValue(asset: CollateralAsset): number {
  return round(asset.value * (1 - asset.haircut));
}

function total(pick: (asset: CollateralAsset) => number): number {
  return round(COLLATERAL.reduce((sum, asset) => sum + pick(asset), 0));
}

/**
 * Account-level collateral, derived from the lines above so no surface has to
 * author its own total. Available is what an order ticket can still reserve.
 */
const ELIGIBLE = total(eligibleValue);
const RESERVED = total((asset) => asset.reserved);

export const COLLATERAL_TOTALS = {
  posted: total((asset) => asset.value),
  eligible: ELIGIBLE,
  reserved: RESERVED,
  available: round(ELIGIBLE - RESERVED),
};
