/*
 * Organization control model for the settings workspace. The types come straight from the organization-control
 * service (`services/organization-control`, schema `setryn.organization-control.v1`) as a type-only import, so the
 * records the settings pages render are the service's own. The service runs on the web server
 * (`organization-server.ts`); members act on it with their connected wallets through `/api/organization`.
 */
import type {
  ActorId,
  ApprovalProposal,
  ApprovalStatus,
  ControlEnvironment,
  ControlSnapshot,
  Organization,
  OrganizationId,
  OrganizationMember,
  OrganizationRole,
  PolicyConstraints,
  PolicyVersion,
  StrategyAccount,
  StrategyAccountStatus,
} from "../../../../../services/organization-control/src/types";

export type {
  ActorId,
  ApprovalProposal,
  ApprovalStatus,
  ControlEnvironment,
  ControlSnapshot,
  Organization,
  OrganizationId,
  OrganizationMember,
  OrganizationRole,
  PolicyConstraints,
  PolicyVersion,
  StrategyAccount,
  StrategyAccountStatus,
};

export const ORGANIZATION_SCHEMA = "setryn.organization-control.v1";

export const ORGANIZATION_ROLE_LIST: readonly OrganizationRole[] = ["admin", "trader", "approver", "accountant", "viewer"];

/**
 * How each network is named in the product. The local chain is presented as plain Arbitrum, never as mainnet; the
 * testnet keeps its own name.
 */
export function networkLabel(network: ControlEnvironment): string {
  if (network === "arbitrum-sepolia") return "Arbitrum Sepolia";
  return network === "arbitrum-one" ? "Arbitrum One" : "Arbitrum";
}

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
  { id: "grant-roles", label: "Grant and revoke roles", detail: "The last active admin cannot be revoked or demoted.", roles: ["admin"] },
  { id: "register-accounts", label: "Register subaccounts", detail: "Any active member except viewers.", roles: ["admin", "trader", "approver", "accountant"] },
  { id: "suspend-accounts", label: "Suspend or close subaccounts", detail: "Closed accounts cannot transition again.", roles: ["admin"] },
  { id: "publish-policy", label: "Publish policy versions", detail: "Each version supersedes the last; history is kept.", roles: ["admin"] },
  { id: "propose-actions", label: "Propose new-risk actions", detail: "Members who may trade: admins and traders.", roles: ["admin", "trader"] },
  { id: "decide-approvals", label: "Approve or reject proposals", detail: "Holder of the policy approver role, or admin.", roles: ["admin", "approver"] },
  { id: "record-journals", label: "Record execution journals", detail: "Admins, accountants, and traders for completed executions.", roles: ["admin", "accountant", "trader"] },
  { id: "export-journals", label: "Export journals", detail: "Admins and accountants.", roles: ["admin", "accountant"] },
  { id: "terminal-resolution", label: "Complete terminal resolution", detail: "Settle, resolve, and release collateral without approval.", roles: "ANY" },
];

export function roleCan(role: OrganizationRole | null, capability: Capability): boolean {
  if (role === null) return false;
  const entry = CAPABILITIES.find((item) => item.id === capability);
  return entry !== undefined && (entry.roles === "ANY" || entry.roles.includes(role));
}

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

export const ACCOUNT_STATUS_LABEL: Record<StrategyAccountStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

export function activeMembers(members: readonly OrganizationMember[]): OrganizationMember[] {
  return members.filter((member) => member.status === "active");
}

export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length > head + tail + 3 ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;
}

/** One organization's records out of a control snapshot. */
export interface OrganizationRecords {
  organization: Organization;
  members: OrganizationMember[];
  accounts: StrategyAccount[];
  policies: PolicyVersion[];
  proposals: ApprovalProposal[];
  /** The policy in force: the newest version that has not been superseded. */
  policy: PolicyVersion | null;
}

export function organizationRecords(snapshot: ControlSnapshot, organizationId: string): OrganizationRecords | null {
  const organization = snapshot.organizations.find((item) => item.id === organizationId);
  if (!organization) return null;
  const policies = snapshot.policies
    .filter((item) => item.organizationId === organizationId)
    .sort((a, b) => b.version - a.version);
  return {
    organization,
    members: snapshot.members.filter((item) => item.organizationId === organizationId),
    accounts: snapshot.accounts.filter((item) => item.organizationId === organizationId),
    policies,
    proposals: snapshot.proposals
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
    policy: policies.find((item) => item.supersededAt === null) ?? null,
  };
}

/** A pending or approved proposal past its expiry can no longer be decided or executed, whatever its stored status. */
export function effectiveProposalStatus(proposal: ApprovalProposal, nowMs: number): ApprovalStatus {
  if ((proposal.status === "pending" || proposal.status === "approved") && Date.parse(proposal.expiresAt) < nowMs) {
    return "expired";
  }
  return proposal.status;
}
