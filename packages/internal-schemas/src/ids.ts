export type Hex = `0x${string}`;
export type Address = Hex;
export type Bytes32 = Hex;

declare const identifierBrand: unique symbol;

export type Identifier<Name extends string> = Bytes32 & {
  readonly [identifierBrand]: Name;
};

export type AccountId = Identifier<"AccountId">;
export type AdapterId = Identifier<"AdapterId">;
export type AssetId = Identifier<"AssetId">;
export type BenchmarkId = Identifier<"BenchmarkId">;
export type CalendarId = Identifier<"CalendarId">;
export type CollateralId = Identifier<"CollateralId">;
export type CollateralLockId = Identifier<"CollateralLockId">;
export type FeeScheduleId = Identifier<"FeeScheduleId">;
export type InstrumentId = Identifier<"InstrumentId">;
export type MarketId = Identifier<"MarketId">;
export type RiskDomainId = Identifier<"RiskDomainId">;
export type SeriesId = Identifier<"SeriesId">;
export type SessionId = Identifier<"SessionId">;
export type TerminalClaimId = Identifier<"TerminalClaimId">;
export type TerminalLiabilityReservationId = Identifier<"TerminalLiabilityReservationId">;

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/;

export function parseHex(value: unknown, label = "hex value"): Hex {
  if (typeof value !== "string" || !hexPattern.test(value)) {
    throw new TypeError(`${label} must be an even-length 0x-prefixed hex string`);
  }
  return value.toLowerCase() as Hex;
}

export function parseAddress(value: unknown, label = "address"): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new TypeError(`${label} must be a 20-byte 0x-prefixed address`);
  }
  return value.toLowerCase() as Address;
}

export function parseBytes32(value: unknown, label = "bytes32"): Bytes32 {
  if (typeof value !== "string" || !bytes32Pattern.test(value)) {
    throw new TypeError(`${label} must be a 32-byte 0x-prefixed value`);
  }
  return value.toLowerCase() as Bytes32;
}

export function parseIdentifier<Name extends string>(value: unknown, name: Name): Identifier<Name> {
  return parseBytes32(value, name) as Identifier<Name>;
}
