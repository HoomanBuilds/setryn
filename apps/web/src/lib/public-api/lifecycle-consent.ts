/**
 * Counterparty consent for a lifecycle exit through the API comes from the designated maker, under the same checks as
 * `/api/internal/operator/lifecycle-consent` (lib/internal-gateway/maker-consent.ts): zero-increase terms only, and only
 * for positions the maker is the counterparty of.
 */
export {
  designatedMaker,
  lifecycleConsentTypes,
  lifecycleDomain,
  MakerConsentRefusal,
  signMakerConsent,
  type LifecycleConsent,
} from "@/lib/internal-gateway/maker-consent";
