import { getAddress, type Address, type Hex } from "viem";
import { makerAccountId } from "./designated-maker";
import { makerSigner } from "./operator-signer";
import { positionTerminalAbi } from "./protocol";
import type { SetrynRuntime } from "./runtime";

/*
 * Counterparty consent from the designated maker for a lifecycle action (the platform's full exit). The maker consents
 * only to the zero-increase terms an exit uses, and only for positions it is the counterparty of; anything else needs
 * the real counterparty's own consent.
 */

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

/** Why the maker will not consent; `COUNTERPARTY_CONSENT_REQUIRED` means the position's counterparty is someone else. */
export class MakerConsentRefusal extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(code: "COUNTERPARTY_CONSENT_REQUIRED" | "MAKER_CONSENT_TERMS_REFUSED", detail: string) {
    super(code);
    this.name = "MakerConsentRefusal";
    this.status = code === "COUNTERPARTY_CONSENT_REQUIRED" ? 409 : 403;
    this.detail = detail;
  }
}

/** The designated maker's address and account, or SignerUnavailableError when no maker can sign. */
export async function designatedMaker(setryn: SetrynRuntime): Promise<{ address: Address; accountId: Hex }> {
  const maker = await makerSigner(setryn);
  return { address: maker.address, accountId: (await makerAccountId(maker)).toLowerCase() as Hex };
}

/**
 * Signs `consent` as the designated maker after checking that it is the maker's own consent on zero-increase terms and
 * that the maker's account is a party to every listed position.
 */
export async function signMakerConsent(setryn: SetrynRuntime, consent: LifecycleConsent, positionIds: readonly Hex[]): Promise<Hex> {
  const maker = await makerSigner(setryn);
  const accountId = (await makerAccountId(maker)).toLowerCase();
  if (consent.accountId.toLowerCase() !== accountId) {
    throw new MakerConsentRefusal("COUNTERPARTY_CONSENT_REQUIRED", "The consenting account is not the designated maker's.");
  }
  if (getAddress(consent.signer) !== getAddress(maker.address)) {
    throw new MakerConsentRefusal("MAKER_CONSENT_TERMS_REFUSED", "The consent names another signer.");
  }
  if (
    consent.maximumLiabilityIncreaseBaseUnits !== BigInt(0) ||
    consent.maximumCollateralIncreaseBaseUnits !== BigInt(0) ||
    consent.allowsPackageBreak
  ) {
    throw new MakerConsentRefusal("MAKER_CONSENT_TERMS_REFUSED", "The maker consents only to terms that add no liability or collateral.");
  }
  if (positionIds.length === 0) throw new MakerConsentRefusal("COUNTERPARTY_CONSENT_REQUIRED", "No position names the maker as counterparty.");
  const positions = await Promise.all(
    positionIds.map((positionId) =>
      maker.publicClient.readContract({ address: setryn.positionEngine, abi: positionTerminalAbi, functionName: "getPosition", args: [positionId] }),
    ),
  );
  for (const [economics] of positions) {
    const parties = [economics.longAccountId.toLowerCase(), economics.shortAccountId.toLowerCase()];
    if (!parties.includes(accountId)) {
      throw new MakerConsentRefusal("COUNTERPARTY_CONSENT_REQUIRED", `The designated maker is not the counterparty of position ${economics.positionId}.`);
    }
  }
  return maker.walletClient.signTypedData({
    domain: lifecycleDomain(setryn),
    types: lifecycleConsentTypes,
    primaryType: "SetrynLifecycleConsentV1",
    message: consent,
  });
}
