import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { PublicApiError } from "./errors";
import { deriveAccountId, type ChainContext } from "./chain";

export function parseBytes32(value: string | null | undefined, name: string): Hex {
  if (!value || !isHex(value, { strict: true }) || value.length !== 66) {
    throw new PublicApiError(400, "INVALID_REQUEST", `${name} must be a 0x-prefixed 32-byte hex value.`);
  }
  return value.toLowerCase() as Hex;
}

export function parseAddress(value: string | null | undefined, name: string): Address {
  if (!value || !isAddress(value)) throw new PublicApiError(400, "INVALID_REQUEST", `${name} must be an EVM address.`);
  return getAddress(value);
}

/** `?accountId=` or `?signer=` (the signer's primary account, derived by the collateral vault). */
export async function accountFromQuery(context: ChainContext, url: URL): Promise<Hex> {
  const accountId = url.searchParams.get("accountId");
  const signer = url.searchParams.get("signer");
  if (accountId) return parseBytes32(accountId, "accountId");
  if (signer) return deriveAccountId(context, parseAddress(signer, "signer"));
  throw new PublicApiError(400, "INVALID_REQUEST", "Pass accountId or signer.");
}
