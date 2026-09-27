export const organizationControlVersion = "setryn.organization-control.v1" as const;
export type OrganizationControlVersion = typeof organizationControlVersion;

export const organizationControlJournalVersion = "setryn.organization-control.journal.v1" as const;
export type OrganizationControlJournalVersion = typeof organizationControlJournalVersion;

export type Hex = `0x${string}`;
export type Bytes32 = Hex;
export type OrganizationId = Bytes32;
export type AccountId = Bytes32;
export type MarketId = Bytes32;
export type RiskDomainId = Bytes32;
export type ActorId = string;

export type ControlEnvironment = "local" | "arbitrum-sepolia" | "arbitrum-one";
export type OrganizationRole = "admin" | "trader" | "approver" | "accountant" | "viewer";
export type MemberStatus = "active" | "revoked";
export type StrategyAccountStatus = "active" | "suspended" | "closed";
export type ControlRiskClass = "new-risk" | "terminal-resolution" | "operational";
export type RouteClass = "internal-match" | "external-venue" | "otc-settlement";
export type SettlementClass = "atomic" | "escrowed" | "delivery-versus-payment";

export const ORGANIZATION_ROLES: readonly OrganizationRole[] = ["admin", "trader", "approver", "accountant", "viewer"];
export const ROUTE_CLASSES: readonly RouteClass[] = ["internal-match", "external-venue", "otc-settlement"];
export const SETTLEMENT_CLASSES: readonly SettlementClass[] = ["atomic", "escrowed", "delivery-versus-payment"];
export const ACTION_KINDS: readonly string[] = [
  "open-package",
  "amend-package",
  "cancel-package",
  "settle-package",
  "move-collateral",
  "resolve-terminal",
  "release-collateral",
];
export const TERMINAL_ACTION_KINDS: readonly string[] = ["settle-package", "resolve-terminal", "release-collateral"];

export interface Organization {
  readonly id: OrganizationId;
  readonly name: string;
  readonly createdAt: string;
  readonly createdBy: ActorId;
}

export interface OrganizationMember {
  readonly organizationId: OrganizationId;
  readonly memberId: ActorId;
  readonly role: OrganizationRole;
  readonly status: MemberStatus;
  readonly grantedAt: string;
  readonly grantedBy: ActorId;
  readonly revokedAt: string | null;
}

export interface StrategyAccount {
  readonly accountId: AccountId;
  readonly organizationId: OrganizationId;
  readonly label: string;
  readonly riskDomainId: RiskDomainId | null;
  readonly status: StrategyAccountStatus;
  readonly registeredAt: string;
  readonly registeredBy: ActorId;
  readonly closedAt: string | null;
}

export interface ScopeAllowlist<T> {
  readonly mode: "any" | "list";
  readonly values: readonly T[];
}

export interface MonetaryAmount {
  readonly amount: string;
  readonly currency: string;
}

export interface PolicyConstraints {
  readonly accounts: ScopeAllowlist<AccountId>;
  readonly markets: ScopeAllowlist<MarketId>;
  readonly riskDomains: ScopeAllowlist<RiskDomainId>;
  readonly routes: ScopeAllowlist<RouteClass>;
  readonly settlement: ScopeAllowlist<SettlementClass>;
  readonly maxNotional: MonetaryAmount | null;
  readonly minCollateral: MonetaryAmount | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly requiredApprovers: number;
  readonly approverRole: OrganizationRole;
  readonly dualControlThreshold: MonetaryAmount | null;
}

export interface PolicyVersion {
  readonly organizationId: OrganizationId;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: ActorId;
  readonly constraints: PolicyConstraints;
  readonly supersededAt: string | null;
}

export interface PolicyActionRequest {
  readonly organizationId: OrganizationId;
  readonly actor: ActorId;
  readonly environment: ControlEnvironment;
  readonly accountId: AccountId;
  readonly marketId: MarketId;
  readonly riskDomainId: RiskDomainId;
  readonly routeClass: string;
  readonly settlementClass: string;
  readonly actionKind: string;
  readonly riskClass: ControlRiskClass;
  readonly notional: MonetaryAmount;
  readonly collateral: MonetaryAmount | null;
  readonly requestedAt: string;
  readonly actionPayloadHash: Bytes32;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly policyVersion: number;
  readonly requiredApprovers: number;
  readonly approverRole: OrganizationRole;
  readonly explanations: readonly string[];
}

export type ApprovalStatus = "draft" | "pending" | "approved" | "rejected" | "expired" | "executed" | "canceled";
export type ApprovalChoice = "approve" | "reject";

export interface ApprovalDecision {
  readonly proposalId: string;
  readonly approver: ActorId;
  readonly roleAtDecision: OrganizationRole;
  readonly choice: ApprovalChoice;
  readonly decidedAt: string;
  readonly note: string | null;
}

export interface ApprovalProposal {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly policyVersion: number;
  readonly actionPayloadHash: Bytes32;
  readonly accountId: AccountId;
  readonly marketId: MarketId;
  readonly riskDomainId: RiskDomainId;
  readonly routeClass: RouteClass;
  readonly settlementClass: SettlementClass;
  readonly actionKind: string;
  readonly riskClass: ControlRiskClass;
  readonly notional: MonetaryAmount;
  readonly environment: ControlEnvironment;
  readonly status: ApprovalStatus;
  readonly createdBy: ActorId;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly requiredApprovers: number;
  readonly approverRole: OrganizationRole;
  readonly decisions: readonly ApprovalDecision[];
  readonly decidedAt: string | null;
  readonly executedAt: string | null;
  readonly executionReference: string | null;
  readonly cancelReason: string | null;
}

export interface ExecutionLegInput {
  readonly legId: string;
  readonly debitAccount: string;
  readonly creditAccount: string;
  readonly amount: string;
  readonly currency: string;
}

export interface CompletedPackageExecution {
  readonly executionId: string;
  readonly organizationId: OrganizationId;
  readonly accountId: AccountId;
  readonly marketId: MarketId;
  readonly packageHash: Bytes32;
  readonly receiptId: Bytes32;
  readonly transactionHash: Bytes32;
  readonly completedAt: string;
  readonly legs: readonly ExecutionLegInput[];
}

export interface JournalEntry {
  readonly entryId: string;
  readonly journalId: string;
  readonly organizationId: OrganizationId;
  readonly accountId: AccountId;
  readonly marketId: MarketId;
  readonly debitAccount: string;
  readonly creditAccount: string;
  readonly amount: string;
  readonly currency: string;
  readonly executionId: string;
  readonly packageHash: Bytes32;
  readonly receiptId: Bytes32;
  readonly transactionHash: Bytes32;
  readonly postedAt: string;
}

export interface AccountingJournal {
  readonly journalId: string;
  readonly exportVersion: OrganizationControlJournalVersion;
  readonly organizationId: OrganizationId;
  readonly executionId: string;
  readonly packageHash: Bytes32;
  readonly receiptId: Bytes32;
  readonly transactionHash: Bytes32;
  readonly postedAt: string;
  readonly entries: readonly JournalEntry[];
  readonly totals: Readonly<Record<string, string>>;
}

export interface JournalExport {
  readonly exportVersion: OrganizationControlJournalVersion;
  readonly journalId: string;
  readonly organizationId: OrganizationId;
  readonly executionId: string;
  readonly packageHash: Bytes32;
  readonly receiptId: Bytes32;
  readonly transactionHash: Bytes32;
  readonly postedAt: string;
  readonly entries: readonly JournalEntry[];
  readonly totals: Readonly<Record<string, string>>;
}

export interface ControlSnapshot {
  readonly schemaVersion: OrganizationControlVersion;
  readonly generatedAt: string;
  readonly organizations: readonly Organization[];
  readonly members: readonly OrganizationMember[];
  readonly accounts: readonly StrategyAccount[];
  readonly policies: readonly PolicyVersion[];
  readonly proposals: readonly ApprovalProposal[];
  readonly journals: readonly AccountingJournal[];
}

const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;

export function isBytes32(value: unknown): value is Bytes32 {
  return typeof value === "string" && bytes32Pattern.test(value);
}

export function assertBytes32(value: unknown, label: string): Bytes32 {
  if (!isBytes32(value)) throw new TypeError(`${label} must be a 32-byte 0x-prefixed value`);
  return value.toLowerCase() as Bytes32;
}

export function assertNonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must not be empty`);
  return value;
}

export function assertIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return value;
}
