/*
 * Organization control model for the settings workspace. The types come straight from the organization-control
 * service (`services/organization-control`, schema `setryn.organization-control.v1`) as a type-only import, so the
 * fixture below cannot drift from the service's own records. The web platform does not call that service yet: this
 * is a recorded fixture presented read-only, and every surface that shows it says so.
 */
import type {
  ActorId,
  ApprovalProposal,
  ApprovalStatus,
  ControlEnvironment,
  ControlSnapshot,
  OrganizationMember,
  OrganizationRole,
  PolicyVersion,
} from "../../../../../services/organization-control/src/types.ts";

export type {
  ApprovalProposal,
  ApprovalStatus,
  ControlEnvironment,
  ControlSnapshot,
  OrganizationMember,
  OrganizationRole,
  PolicyVersion,
};

export const ORGANIZATION_SCHEMA = "setryn.organization-control.v1";

const ORG = "0x5e7a0c1d9b2f48e6a3c7d05b1e9f2a846c3d0b7e19f5a2c48d6e0b3f7a1c9d52" as const;
const CARRY_ACCOUNT = "0x8f2c4e6a1b3d5f7092e4c6a8b0d2f4e6a8c0e2f4a6b8d0f2e4c6a8b0d2f4e6a8" as const;
const FX_ACCOUNT = "0x1a3c5e7092b4d6f8a0c2e4f6b8d0a2c4e6f8b0d2a4c6e8f0b2d4a6c8e0f2b4d6" as const;
const BASIS_ACCOUNT = "0x4d6f8a0c2e4b6d8f0a2c4e6f8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d" as const;
const CARRY_DOMAIN = "0x9c1e3a5d7f0b2d4e6a8c0e2f4b6d8a0c2e4f6b8d0a2c4e6f8b0d2a4c6e8f0b2d" as const;
const MACRO_DOMAIN = "0x2b4d6f8a0c1e3a5c7e9a1c3e5a7c9e1a3c5e7a9c1e3a5c7e9a1c3e5a7c9e1a3c" as const;
const BTC_MARKET = "0x7e1f3b5d7a9c1e3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f" as const;
const EUR_MARKET = "0x3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c" as const;

export const ACTOR: Record<string, ActorId> = {
  admin: "desk-admin.r-alvarez",
  trader: "trader.k-mensah",
  approver: "risk.j-tanaka",
  accountant: "finance.l-moreau",
  viewer: "audit.s-berg",
  former: "trader.d-novak",
};

const POLICY_V3: PolicyVersion = {
  organizationId: ORG,
  version: 3,
  createdAt: "2026-09-18T14:05:00.000Z",
  createdBy: ACTOR.admin,
  constraints: {
    accounts: { mode: "list", values: [CARRY_ACCOUNT, FX_ACCOUNT] },
    markets: { mode: "any", values: [] },
    riskDomains: { mode: "list", values: [CARRY_DOMAIN, MACRO_DOMAIN] },
    routes: { mode: "list", values: ["internal-match", "otc-settlement"] },
    settlement: { mode: "list", values: ["atomic", "escrowed"] },
    maxNotional: { amount: "5000000", currency: "USDC" },
    minCollateral: { amount: "25000", currency: "USDC" },
    validFrom: "2026-09-18T00:00:00.000Z",
    validUntil: "2026-12-31T23:59:59.000Z",
    requiredApprovers: 1,
    approverRole: "approver",
    dualControlThreshold: { amount: "1000000", currency: "USDC" },
  },
  supersededAt: null,
};

const POLICY_V2: PolicyVersion = {
  ...POLICY_V3,
  version: 2,
  createdAt: "2026-09-04T09:30:00.000Z",
  constraints: {
    ...POLICY_V3.constraints,
    maxNotional: { amount: "2500000", currency: "USDC" },
    dualControlThreshold: { amount: "750000", currency: "USDC" },
  },
  supersededAt: "2026-09-18T14:05:00.000Z",
};

function proposal(partial: Partial<ApprovalProposal> & Pick<ApprovalProposal, "id" | "status">): ApprovalProposal {
  return {
    organizationId: ORG,
    policyVersion: 3,
    actionPayloadHash: "0xc4e1a93b7d25f06e8a1c3b5d7f9e2a4c6b8d0f1e3a5c7b9d2f4e6a8c0b1d3f5e",
    accountId: CARRY_ACCOUNT,
    marketId: BTC_MARKET,
    riskDomainId: CARRY_DOMAIN,
    routeClass: "internal-match",
    settlementClass: "atomic",
    actionKind: "open-package",
    riskClass: "new-risk",
    notional: { amount: "400000", currency: "USDC" },
    environment: "arbitrum-sepolia",
    createdBy: ACTOR.trader,
    createdAt: "2026-09-22T08:12:00.000Z",
    expiresAt: "2026-09-22T20:12:00.000Z",
    requiredApprovers: 1,
    approverRole: "approver",
    decisions: [],
    decidedAt: null,
    executedAt: null,
    executionReference: null,
    cancelReason: null,
    ...partial,
  };
}

export const ORGANIZATION_CONTROL_FIXTURE: ControlSnapshot = {
  schemaVersion: ORGANIZATION_SCHEMA,
  generatedAt: "2026-09-22T08:55:00.000Z",
  organizations: [{ id: ORG, name: "Setryn Treasury Desk", createdAt: "2026-09-02T10:00:00.000Z", createdBy: ACTOR.admin }],
  members: [
    { organizationId: ORG, memberId: ACTOR.admin, role: "admin", status: "active", grantedAt: "2026-09-02T10:00:00.000Z", grantedBy: ACTOR.admin, revokedAt: null },
    { organizationId: ORG, memberId: ACTOR.trader, role: "trader", status: "active", grantedAt: "2026-09-02T10:14:00.000Z", grantedBy: ACTOR.admin, revokedAt: null },
    { organizationId: ORG, memberId: ACTOR.approver, role: "approver", status: "active", grantedAt: "2026-09-02T10:16:00.000Z", grantedBy: ACTOR.admin, revokedAt: null },
    { organizationId: ORG, memberId: ACTOR.accountant, role: "accountant", status: "active", grantedAt: "2026-09-03T08:40:00.000Z", grantedBy: ACTOR.admin, revokedAt: null },
    { organizationId: ORG, memberId: ACTOR.viewer, role: "viewer", status: "active", grantedAt: "2026-09-10T12:00:00.000Z", grantedBy: ACTOR.admin, revokedAt: null },
    { organizationId: ORG, memberId: ACTOR.former, role: "trader", status: "revoked", grantedAt: "2026-09-02T10:15:00.000Z", grantedBy: ACTOR.admin, revokedAt: "2026-09-17T16:20:00.000Z" },
  ],
  accounts: [
    { accountId: CARRY_ACCOUNT, organizationId: ORG, label: "Carry book", riskDomainId: CARRY_DOMAIN, status: "active", registeredAt: "2026-09-02T11:00:00.000Z", registeredBy: ACTOR.admin, closedAt: null },
    { accountId: FX_ACCOUNT, organizationId: ORG, label: "FX hedging", riskDomainId: MACRO_DOMAIN, status: "active", registeredAt: "2026-09-03T09:10:00.000Z", registeredBy: ACTOR.trader, closedAt: null },
    { accountId: BASIS_ACCOUNT, organizationId: ORG, label: "Legacy basis", riskDomainId: null, status: "suspended", registeredAt: "2026-09-02T11:05:00.000Z", registeredBy: ACTOR.admin, closedAt: null },
  ],
  policies: [POLICY_V3, POLICY_V2],
  proposals: [
    proposal({
      id: "proposal_7c2e41a9d0b3f5e6a8c1d2e4",
      status: "pending",
      notional: { amount: "1200000", currency: "USDC" },
      requiredApprovers: 2,
      createdAt: "2026-09-22T08:31:00.000Z",
      expiresAt: "2026-09-22T20:31:00.000Z",
      decisions: [
        { proposalId: "proposal_7c2e41a9d0b3f5e6a8c1d2e4", approver: ACTOR.approver, roleAtDecision: "approver", choice: "approve", decidedAt: "2026-09-22T08:44:00.000Z", note: "Within carry domain limits." },
      ],
    }),
    proposal({
      id: "proposal_3f9b0e2d4c6a8b1e5d7f9a2c",
      status: "approved",
      accountId: FX_ACCOUNT,
      marketId: EUR_MARKET,
      riskDomainId: MACRO_DOMAIN,
      routeClass: "otc-settlement",
      settlementClass: "escrowed",
      notional: { amount: "250000", currency: "USDC" },
      createdAt: "2026-09-22T07:50:00.000Z",
      expiresAt: "2026-09-22T19:50:00.000Z",
      decisions: [
        { proposalId: "proposal_3f9b0e2d4c6a8b1e5d7f9a2c", approver: ACTOR.approver, roleAtDecision: "approver", choice: "approve", decidedAt: "2026-09-22T08:02:00.000Z", note: null },
      ],
      decidedAt: "2026-09-22T08:02:00.000Z",
    }),
    proposal({
      id: "proposal_a1d3f5b7c9e0a2b4d6f8c1e3",
      status: "executed",
      notional: { amount: "180000", currency: "USDC" },
      createdAt: "2026-09-21T15:20:00.000Z",
      expiresAt: "2026-09-22T03:20:00.000Z",
      decisions: [
        { proposalId: "proposal_a1d3f5b7c9e0a2b4d6f8c1e3", approver: ACTOR.admin, roleAtDecision: "admin", choice: "approve", decidedAt: "2026-09-21T15:31:00.000Z", note: null },
      ],
      decidedAt: "2026-09-21T15:31:00.000Z",
      executedAt: "2026-09-21T15:34:00.000Z",
      executionReference: "0x9d2b4f6a8c0e1d3b5f7a9c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a5c7e9b2d",
    }),
    proposal({
      id: "proposal_e8c0a2d4f6b1c3e5a7d9f0b2",
      status: "rejected",
      accountId: BASIS_ACCOUNT,
      riskDomainId: CARRY_DOMAIN,
      routeClass: "internal-match",
      actionKind: "move-collateral",
      riskClass: "operational",
      notional: { amount: "60000", currency: "USDC" },
      createdAt: "2026-09-20T10:05:00.000Z",
      expiresAt: "2026-09-20T22:05:00.000Z",
      decisions: [
        { proposalId: "proposal_e8c0a2d4f6b1c3e5a7d9f0b2", approver: ACTOR.approver, roleAtDecision: "approver", choice: "reject", decidedAt: "2026-09-20T10:22:00.000Z", note: "Account is suspended pending review." },
      ],
      decidedAt: "2026-09-20T10:22:00.000Z",
    }),
  ],
  journals: [],
};

/** Mirror of `OrganizationControlWritePolicy.assess`: Arbitrum One writes are hard-disabled. */
export const WRITE_POLICY: { environment: ControlEnvironment; label: string; allowed: boolean; reason: string }[] = [
  { environment: "local", label: "Local devnet", allowed: true, reason: "Local fixtures and devnet writes are permitted." },
  { environment: "arbitrum-sepolia", label: "Arbitrum Sepolia", allowed: true, reason: "Testnet write intents are permitted." },
  { environment: "arbitrum-one", label: "Arbitrum One", allowed: false, reason: "Arbitrum One writes are hard-disabled by the organization control policy." },
];

export type Capability =
  | "grant-roles"
  | "register-accounts"
  | "suspend-accounts"
  | "publish-policy"
  | "propose-actions"
  | "decide-approvals"
  | "record-journals"
  | "export-journals"
  | "terminal-resolution";

/**
 * What each role can do, read from the service's own checks: admin-only calls use `#requireActiveAdmin`, account
 * registration refuses viewers, decisions need the policy's approver role or admin, and terminal resolution follows
 * committed state on the permissionless path.
 */
export const CAPABILITIES: { id: Capability; label: string; detail: string; roles: OrganizationRole[] | "ANY" }[] = [
  { id: "grant-roles", label: "Grant and revoke roles", detail: "The last active admin cannot be revoked.", roles: ["admin"] },
  { id: "register-accounts", label: "Register subaccounts", detail: "Any active member except viewers.", roles: ["admin", "trader", "approver", "accountant"] },
  { id: "suspend-accounts", label: "Suspend or close subaccounts", detail: "Closed accounts cannot transition again.", roles: ["admin"] },
  { id: "publish-policy", label: "Publish policy versions", detail: "Each version supersedes the last; history is kept.", roles: ["admin"] },
  { id: "propose-actions", label: "Propose new-risk actions", detail: "Members who may trade: admins and traders.", roles: ["admin", "trader"] },
  { id: "decide-approvals", label: "Approve or reject proposals", detail: "Holder of the policy approver role, or admin.", roles: ["admin", "approver"] },
  { id: "record-journals", label: "Record execution journals", detail: "Admins, accountants, and traders for completed executions.", roles: ["admin", "accountant", "trader"] },
  { id: "export-journals", label: "Export journals", detail: "Admins and accountants.", roles: ["admin", "accountant"] },
  { id: "terminal-resolution", label: "Complete terminal resolution", detail: "Settle, resolve, and release collateral without approval.", roles: "ANY" },
];

export const ROLE_LABEL: Record<OrganizationRole, string> = {
  admin: "Admin",
  trader: "Trader",
  approver: "Approver",
  accountant: "Accountant",
  viewer: "Viewer",
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  executed: "Executed",
  canceled: "Canceled",
};

export function activeMembers(members: readonly OrganizationMember[]): OrganizationMember[] {
  return members.filter((member) => member.status === "active");
}

export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length > head + tail + 3 ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;
}
