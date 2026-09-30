import { createWalletClient, getAddress, http, type Address, type Hex } from "viem";
import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";

/**
 * Counterparty consent for a lifecycle action whose other participant is the local devnet maker (the runtime
 * operator). The maker's key is an unlocked devnet node account, so the consent is signed through the node, exactly
 * like `/api/internal/devnet/lifecycle-consent`. Only the zero-increase terms the platform's full exit uses are signed.
 */

export const DEVNET_CHAIN_ID = 31337;

export const lifecycleConsentTypes = {
  SetrynLifecycleConsentV1: [
    { name: "actionId", type: "bytes32" },
    { name: "accountId", type: "bytes32" },
    { name: "signer", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "maximumLiabilityIncreaseBaseUnits", type: "uint128" },
    { name: "maximumCollateralIncreaseBaseUnits", type: "uint128" },
    { name: "allowsPackageBreak", type: "bool" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export interface LifecycleConsent {
  actionId: Hex;
  accountId: Hex;
  signer: Address;
  nonce: bigint;
  deadline: bigint;
  maximumLiabilityIncreaseBaseUnits: bigint;
  maximumCollateralIncreaseBaseUnits: bigint;
  allowsPackageBreak: boolean;
  salt: Hex;
}

export function lifecycleDomain(setryn: SetrynRuntime) {
  return { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.signedLifecycleEngine } as const;
}

/** Signs `consent` as the devnet maker. The caller has already checked that `consent.accountId` is the maker's account. */
export async function signDevnetMakerConsent(setryn: SetrynRuntime, consent: LifecycleConsent): Promise<Hex> {
  if (setryn.chainId !== DEVNET_CHAIN_ID) throw new Error("MAKER_CONSENT_DEVNET_ONLY");
  const maker = getAddress(setryn.operator);
  if (getAddress(consent.signer) !== maker) throw new Error("MAKER_CONSENT_SIGNER_MISMATCH");
  if (consent.maximumLiabilityIncreaseBaseUnits !== BigInt(0) || consent.maximumCollateralIncreaseBaseUnits !== BigInt(0) || consent.allowsPackageBreak) {
    throw new Error("MAKER_CONSENT_TERMS_REFUSED");
  }
  const walletClient = createWalletClient({ account: maker, transport: http(setryn.rpcUrl) });
  return walletClient.signTypedData({
    account: maker,
    domain: lifecycleDomain(setryn),
    types: lifecycleConsentTypes,
    primaryType: "SetrynLifecycleConsentV1",
    message: consent,
  });
}
