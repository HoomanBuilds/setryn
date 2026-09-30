/**
 * What Setryn earns today versus what the product plan (feature map section Q and the unit-economics note) only
 * intends. Only a stream the contracts charge onchain is IMPLEMENTED; partner revenue share is MODELED because a share
 * is computed for reconciliation but no payout exists; everything else is PLANNED.
 */
export interface RevenueStream {
  id: string;
  label: string;
  status: "IMPLEMENTED" | "MODELED" | "PLANNED";
  detail: string;
}

export const REVENUE_STREAMS: readonly RevenueStream[] = [
  {
    id: "taker-fee",
    label: "Taker execution fee",
    status: "IMPLEMENTED",
    detail: "Charged on each fill's consideration under the active fee schedule, funded from the taker's collateral at clearing.",
  },
  {
    id: "maker-fee",
    label: "Maker execution fee",
    status: "IMPLEMENTED",
    detail: "Charged on the resting side of each fill, on the public book and private RFQs, through the same collateral-backed path.",
  },
  {
    id: "partner-share",
    label: "Partner revenue share",
    status: "MODELED",
    detail: "A partner's fee share is computed for reconciliation; no onchain payout or claim exists yet.",
  },
  { id: "volume-tiers", label: "Volume tiers and maker rebates", status: "PLANNED", detail: "Funded from realized revenue once it exists." },
  { id: "settlement-fee", label: "Settlement and exercise fees", status: "PLANNED", detail: "Settlement, lapse and terminal resolution carry no fee, so a fee can never block an exit." },
  { id: "lifecycle-fee", label: "Lifecycle automation fees", status: "PLANNED", detail: "Amendment, unwind, roll and off-platform clearing, only where the user explicitly authorizes the fee." },
  { id: "liquidation-fee", label: "Liquidation and default fees", status: "PLANNED", detail: "Default auction and liquidation fee actions exist in the fee engine; no schedule charges them." },
  { id: "solver-fee", label: "Solver and keeper fees", status: "PLANNED", detail: "Solver route and keeper reward actions exist; no schedule charges or pays them." },
  { id: "interface-fee", label: "Third-party interface clearing fee", status: "PLANNED", detail: "Clearing fee for interfaces and builder or strategy-publisher fees." },
  { id: "subscriptions", label: "Maker API and terminal subscriptions", status: "PLANNED", detail: "Professional maker API and risk-terminal subscription." },
  { id: "privacy-data", label: "Privacy services and market data", status: "PLANNED", detail: "Premium selective disclosure and executable benchmark licensing." },
];
