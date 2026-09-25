import { contractBindings, type InternalContractBinding } from "@setryn/internal-contracts";
import type { ProtocolEventDomain } from "@setryn/internal-schemas";

export interface EventDescriptor {
  readonly contractName: string;
  readonly eventName: string;
  readonly domain: ProtocolEventDomain;
  readonly subjectFields: readonly string[];
  readonly enumFields: Readonly<Record<string, readonly string[]>>;
}

type ContractDescriptor = Omit<EventDescriptor, "eventName"> & { readonly events: readonly string[] };

const orderStatuses = ["unspecified", "open", "partiallyFilled", "filled", "cancelled", "expired", "rejected"];
const positionStatuses = ["unspecified", "live", "fixing", "settlementReady", "settled", "closedByUnwind", "replaced", "lapsed", "cancelledByDisruption", "defaulted", "terminalClaim", "abandoned"];
const rfqStatuses = ["unspecified", "inviting", "collecting", "selectionLocked", "capacityReserved", "authorized", "submitted", "clearing", "settled", "cancelled", "expired", "rejected"];
const quoteStatuses = ["unspecified", "offered", "reserved", "selected", "consumed", "cancelled", "expired", "rejected"];
const auctionStatuses = ["unspecified", "scheduled", "commitOpen", "revealOpen", "readyToClear", "cleared", "settled", "cancelled", "failed"];
const bidStatuses = ["unspecified", "committed", "revealed", "winner", "loser", "unrevealed", "bondReleased", "bondSlashed"];
const defaultStatuses = ["unspecified", "cureOpen", "cured", "commitOpen", "revealOpen", "readyToClear", "auctionCleared", "resolved", "terminalResolved", "recoveryRequired"];
const lifecycleStatuses = ["unspecified", "authorized", "executing", "executed", "cancelled", "expired"];

const contracts: readonly ContractDescriptor[] = [
  descriptor("OrderState", "orders", ["orderHash"], ["OrderRegistered", "OrderFillConsumed", "OrderCancelled", "OrderExpired", "OrderRejected"], { status: orderStatuses, initialStatus: orderStatuses, previousStatus: orderStatuses, newStatus: orderStatuses }),
  descriptor("OrderNonceManager", "orders", ["orderHash", "accountId"], ["OrderNonceConsumed", "OrderNonceCancelled"]),
  descriptor("PublicOrderBook", "books", ["orderHash", "bookId"], ["BookOpened", "PriceLevelOpened", "PriceLevelRemoved", "DirectOrderRested", "DirectOrderQuantityChanged", "DirectOrderRemoved", "DirectMatchExecuted", "RouteOrderReserved", "RouteOrderReservationClosed"]),
  descriptor("PrivateRfqBook", "rfqs", ["rfqId", "quoteId"], ["PrivateRfqCommitted", "RfqStatusChanged", "MakerQuoteCommitted", "MakerQuoteStatusChanged", "FirmCapacityReserved", "FirmCapacityChanged", "RfqSelectionCommitted", "RfqSubmitted", "ClearingHandoffConsumed", "RfqSettled", "RfqRejected", "RfqRouteReserved", "RfqRouteReservationClosed"], { previousStatus: rfqStatuses, newStatus: rfqStatuses, quoteStatus: quoteStatuses }),
  descriptor("SealedAuctionHouse", "auctions", ["auctionId", "bidId"], ["AuctionScheduled", "AuctionStatusChanged", "BidCommitted", "BidRevealed", "BidStatusChanged", "AuctionCleared", "ClearingHandoffConsumed", "AuctionSettled", "AuctionRouteReserved", "AuctionRouteReservationClosed"], { previousStatus: auctionStatuses, newStatus: auctionStatuses, status: bidStatuses }),
  descriptor("StreamingQuoteEngine", "streams", ["streamId"], ["StreamRegistered", "StreamQuoteFilled", "StreamCancelled", "StreamRouteReserved", "StreamRouteReservationClosed"]),
  descriptor("CollateralAwareRouteEngine", "routes", ["routeId", "planHash"], ["RouteReserved", "RouteComponentReserved", "RouteRiskBound", "CoincidenceValidated", "RouteStatusChanged"], { previousStatus: ["unspecified", "reserved", "handoffConsumed", "settled", "invalidated", "expired"], newStatus: ["unspecified", "reserved", "handoffConsumed", "settled", "invalidated", "expired"] }),
  descriptor("ProtocolRouteLiquiditySource", "routes", ["routeId"], ["RouteSourcesReserved", "RouteSourcesClosed"]),
  descriptor("CapacityReservationRegistry", "routes", ["referenceId", "reservationId"], ["CapacityReferenceClaimed", "CapacityReferenceClosed"]),
  descriptor("BatchClearingEngine", "fills", ["batchExecutionId", "allocationId", "fillId"], ["BatchAllocationCleared", "BatchExecuted"]),
  descriptor("AtomicClearingEngine", "fills", ["fillId", "orderHash"], ["FillCleared", "FillLedgerEntry", "FillPositionCreated", "OrderFundingReserved", "OrderFundingReleased", "ClearingChannelActivated"], { channelKind: ["unspecified", "direct", "privateRfq", "sealedAuction"], kind: ["unspecified", "consideration", "makerFee", "takerFee"] }),
  descriptor("PositionEngine", "positions", ["positionId", "lockId"], ["PositionCreated", "PositionStatusChanged", "PositionPayoffComputed", "PositionExactPayoffComputed", "PositionQuantityChanged", "PositionFundingLockCreated", "PositionFundingLockReleased"], { previousStatus: positionStatuses, newStatus: positionStatuses }),
  descriptor("FixingEngine", "fixing", ["fixingKey", "proposalHash"], ["FixingEvidenceProposed", "FixingDisputed", "FixingFinalized"], { resolutionKind: ["unspecified", "primaryFinal", "fallbackFinal", "terminalDisruption"] }),
  descriptor("CashSettlementCoordinator", "settlement", ["settlementId", "claimId", "positionId"], ["CashSettlementFinalized", "SettlementClaimFulfilled"], { mode: ["unspecified", "normal", "terminalDisruption", "lapsed"] }),
  descriptor("FundedFeeEngine", "fees", ["consumptionId", "feeScheduleId"], ["FeeWitnessInstalled", "FeeActionConsumed", "FeeLedgerEntryRecorded"], { kind: ["unspecified", "chargeDebit", "chargeCredit", "budgetDebit", "rebateCredit"] }),
  descriptor("PortfolioRiskEngine", "risk", ["admissionId", "positionId", "accountId"], ["RiskAdmissionReserved", "RiskAdmissionConsumed", "RiskAdmissionPartiallyConsumed", "RiskAdmissionReleased", "RiskAdmissionExpired", "ExposureReduced", "ObjectiveDefaultStatePublished"]),
  descriptor("SignedLifecycleEngine", "lifecycle", ["actionId"], ["LifecycleActionAuthorized", "LifecycleActionExecuted", "LifecycleActionCancelled", "LifecycleActionExpired"], { previousStatus: lifecycleStatuses, newStatus: lifecycleStatuses }),
  descriptor("CompressionCoordinator", "lifecycle", ["planId"], ["CompressionAuthorized", "CompressionExecuted", "CompressionCancelled", "CompressionExpired"]),
  descriptor("DefaultProcessEngine", "default", ["processId", "bidId", "depositId", "reservationId"], ["DefaultOpened", "DefaultStatusChanged", "CureCollateralLocked", "LiquidationBidCommitted", "LiquidationBidRevealed", "LiquidationAuctionCleared", "InsuranceDeposited", "InsuranceReserved", "InsuranceConsumed", "DefaultResolved"], { previousStatus: defaultStatuses, newStatus: defaultStatuses, status: defaultStatuses }),
  descriptor("PrivacyCommitmentRegistry", "privacy", ["envelopeId", "grantId", "policyId", "subjectId"], ["PrivacyPolicyRegistered", "PrivacyPolicyStatusChanged", "PrivacyEpochKeyPublished", "PrivacyEnvelopeCommitted", "PrivacyRevealRecorded", "PrivacyEnvelopeExpired", "DisclosureGrantCreated", "DisclosureGrantRevoked", "DisclosureAccessRecorded"], { previousStatus: ["unspecified", "active", "paused", "deprecated"], newStatus: ["unspecified", "active", "paused", "deprecated"], initialStatus: ["unspecified", "active", "paused", "deprecated"], envelopeStatus: ["unspecified", "active", "revealed", "expired"], grantStatus: ["unspecified", "active", "consumed", "revoked", "expired"] }),
  descriptor("VerifiableReceiptLedger", "receipts", ["subjectId", "receiptId"], ["EvidenceJournalBatchAppended", "EvidenceReceiptAppended", "ReceiptSubjectFinalized"]),
  descriptor("OperationalAdapterExecutor", "asyncAdapters", ["actionId"], ["ExternalActionAdvanced", "NativeLedgerExecuted", "OperationalRead"], { previousState: ["unspecified", "submitted", "included", "unknown", "reconciling", "complete", "recovering", "recovered", "noEffect"], newState: ["unspecified", "submitted", "included", "unknown", "reconciling", "complete", "recovering", "recovered", "noEffect"] }),
];

function descriptor(contractName: string, domain: ProtocolEventDomain, subjectFields: readonly string[], events: readonly string[], enumFields: Readonly<Record<string, readonly string[]>> = {}): ContractDescriptor {
  return { contractName, domain, subjectFields, events, enumFields };
}

export const phase2EventDescriptors = new Map<string, EventDescriptor>(
  contracts.flatMap(({ events, ...base }) => events.map((eventName) => [`${base.contractName}.${eventName}`, { ...base, eventName }] as const)),
);

const ignoredArtifactEvents = new Set(["RoleAdminChanged", "RoleGranted", "RoleRevoked", "DefaultAdminDelayChangeCanceled", "DefaultAdminDelayChangeScheduled", "DefaultAdminTransferCanceled", "DefaultAdminTransferScheduled"]);

export function missingPhase2EventDescriptors(bindings: Readonly<Record<string, InternalContractBinding>> = contractBindings): readonly string[] {
  const missing: string[] = [];
  for (const contract of contracts) {
    const binding = bindings[contract.contractName];
    if (!binding) continue;
    for (const item of binding.abi) {
      if (item.type !== "event" || !item.name || ignoredArtifactEvents.has(item.name)) continue;
      if (!phase2EventDescriptors.has(`${contract.contractName}.${item.name}`)) missing.push(`${contract.contractName}.${item.name}`);
    }
  }
  return missing.sort();
}

export function assertPhase2EventDescriptorCoverage(bindings?: Readonly<Record<string, InternalContractBinding>>): void {
  const missing = missingPhase2EventDescriptors(bindings);
  if (missing.length !== 0) throw new Error(`Missing Phase 2 event descriptors: ${missing.join(", ")}`);
}
