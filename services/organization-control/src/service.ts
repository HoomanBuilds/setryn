import { buildAccountingJournal, exportAccountingJournal } from "./accounting.ts";
import {
  cancelApproval,
  executeApproval,
  expireApproval,
  recordApprovalDecision,
  sha256Hex,
  submitForApproval,
} from "./approvals.ts";
import { evaluatePolicyAction, validateConstraints } from "./policy.ts";
import type { ControlClock, ControlIdSource, OrganizationControlStorePort } from "./repository.ts";
import {
  ORGANIZATION_ROLES,
  assertBytes32,
  assertIsoTimestamp,
  assertNonEmpty,
  type AccountingJournal,
  type AccountId,
  type ActorId,
  type ApprovalChoice,
  type ApprovalProposal,
  type Bytes32,
  type CompletedPackageExecution,
  type ControlEnvironment,
  type ControlSnapshot,
  type JournalExport,
  type Organization,
  type OrganizationId,
  type OrganizationMember,
  type OrganizationRole,
  type PolicyActionRequest,
  type PolicyConstraints,
  type PolicyDecision,
  type PolicyVersion,
  type RiskDomainId,
  type RouteClass,
  type SettlementClass,
  type StrategyAccount,
  type StrategyAccountStatus,
} from "./types.ts";
import { OrganizationControlWritePolicy, type ControlWriteDecision } from "./write-policy.ts";

export interface OrganizationControlServiceConfig {
  readonly store: OrganizationControlStorePort;
  readonly writePolicy?: OrganizationControlWritePolicy;
  readonly clock?: ControlClock;
  readonly ids?: ControlIdSource;
}

let defaultControlCounter = 0;

export function defaultControlId(prefix: string): string {
  defaultControlCounter += 1;
  return `${prefix}_${sha256Hex(`${prefix}:${defaultControlCounter}:${Date.now()}`).slice(0, 24)}`;
}

const defaultIds: ControlIdSource = { next: (prefix) => defaultControlId(prefix) };

export class InternalOrganizationControlService {
  readonly #store: OrganizationControlStorePort;
  readonly #writePolicy: OrganizationControlWritePolicy;
  readonly #clock: ControlClock;
  readonly #ids: ControlIdSource;

  constructor(config: OrganizationControlServiceConfig) {
    this.#store = config.store;
    this.#writePolicy = config.writePolicy ?? new OrganizationControlWritePolicy();
    this.#clock = config.clock ?? { now: () => new Date() };
    this.#ids = config.ids ?? defaultIds;
  }

  createOrganization(name: string, createdBy: ActorId): Organization {
    assertNonEmpty(name, "organization name");
    assertNonEmpty(createdBy, "createdBy");
    const now = this.#clock.now().toISOString();
    const organization: Organization = {
      id: `0x${sha256Hex(`org:${this.#ids.next("org")}`).slice(0, 64)}` as OrganizationId,
      name: name.trim(),
      createdAt: now,
      createdBy,
    };
    this.#store.saveOrganization(organization);
    this.#store.saveMember({
      organizationId: organization.id,
      memberId: createdBy,
      role: "admin",
      status: "active",
      grantedAt: now,
      grantedBy: createdBy,
      revokedAt: null,
    });
    return organization;
  }

  grantRole(
    organizationId: OrganizationId,
    memberId: ActorId,
    role: OrganizationRole,
    grantedBy: ActorId,
  ): OrganizationMember {
    const organization = this.#requireOrganization(organizationId);
    assertNonEmpty(memberId, "memberId");
    assertNonEmpty(grantedBy, "grantedBy");
    if (!(ORGANIZATION_ROLES as readonly string[]).includes(role)) throw new TypeError(`role ${role} is unsupported`);
    this.#requireActiveAdmin(organizationId, grantedBy);
    const now = this.#clock.now().toISOString();
    const member: OrganizationMember = {
      organizationId: organization.id,
      memberId,
      role,
      status: "active",
      grantedAt: now,
      grantedBy,
      revokedAt: null,
    };
    this.#store.saveMember(member);
    return member;
  }

  revokeRole(organizationId: OrganizationId, memberId: ActorId, revokedBy: ActorId): OrganizationMember {
    this.#requireOrganization(organizationId);
    assertNonEmpty(memberId, "memberId");
    this.#requireActiveAdmin(organizationId, revokedBy);
    const target = this.#store.getMember(organizationId, memberId);
    if (!target) throw new Error(`unknown member ${memberId}`);
    if (target.status === "revoked") return target;
    if (target.role === "admin") {
      const activeAdmins = this.#store
        .listMembers(organizationId)
        .filter((member) => member.role === "admin" && member.status === "active");
      if (activeAdmins.length <= 1) throw new Error("cannot revoke the last active admin");
    }
    const revoked: OrganizationMember = { ...target, status: "revoked", revokedAt: this.#clock.now().toISOString() };
    this.#store.saveMember(revoked);
    return revoked;
  }

  registerStrategyAccount(
    organizationId: OrganizationId,
    accountId: string,
    label: string,
    riskDomainId: string | null,
    registeredBy: ActorId,
  ): StrategyAccount {
    const organization = this.#requireOrganization(organizationId);
    const parsedAccount = assertBytes32(accountId, "accountId") as AccountId;
    assertNonEmpty(label, "account label");
    const parsedDomain = riskDomainId === null ? null : (assertBytes32(riskDomainId, "riskDomainId") as RiskDomainId);
    const registrar = this.#store.getMember(organizationId, registeredBy);
    if (!registrar || registrar.status !== "active" || registrar.role === "viewer") {
      throw new Error(`member ${registeredBy} cannot register strategy accounts`);
    }
    if (this.#store.getAccount(parsedAccount)) {
      throw new Error(`strategy account ${parsedAccount} is already registered`);
    }
    const account: StrategyAccount = {
      accountId: parsedAccount,
      organizationId: organization.id,
      label: label.trim(),
      riskDomainId: parsedDomain,
      status: "active",
      registeredAt: this.#clock.now().toISOString(),
      registeredBy,
      closedAt: null,
    };
    this.#store.saveAccount(account);
    return account;
  }

  setAccountStatus(
    organizationId: OrganizationId,
    accountId: string,
    status: StrategyAccountStatus,
    actor: ActorId,
  ): StrategyAccount {
    this.#requireOrganization(organizationId);
    if (status !== "active" && status !== "suspended" && status !== "closed") {
      throw new TypeError(`account status ${status} is unsupported`);
    }
    this.#requireActiveAdmin(organizationId, actor);
    const parsed = assertBytes32(accountId, "accountId") as AccountId;
    const current = this.#store.getAccount(parsed);
    if (!current || current.organizationId !== organizationId) throw new Error(`unknown strategy account ${accountId}`);
    if (current.status === "closed") throw new Error(`strategy account ${accountId} is closed and cannot transition`);
    const next: StrategyAccount = {
      ...current,
      status,
      closedAt: status === "closed" ? this.#clock.now().toISOString() : null,
    };
    this.#store.saveAccount(next);
    return next;
  }

  publishPolicy(organizationId: OrganizationId, createdBy: ActorId, constraints: PolicyConstraints): PolicyVersion {
    this.#requireOrganization(organizationId);
    this.#requireActiveAdmin(organizationId, createdBy);
    validateConstraints(constraints);
    const now = this.#clock.now().toISOString();
    const current = this.#store.currentPolicy(organizationId);
    const version: PolicyVersion = {
      organizationId,
      version: current === null ? 1 : current.version + 1,
      createdAt: now,
      createdBy,
      constraints: cloneConstraints(constraints),
      supersededAt: null,
    };
    if (current !== null) this.#store.savePolicy({ ...current, supersededAt: now });
    this.#store.savePolicy(version);
    return version;
  }

  evaluateAction(request: PolicyActionRequest): PolicyDecision {
    const policy = this.#requireCurrentPolicy(request.organizationId);
    const member = this.#store.getMember(request.organizationId, request.actor);
    const account = this.#store.getAccount(request.accountId);
    const registered = account !== null && account.organizationId === request.organizationId;
    return evaluatePolicyAction(policy, request, {
      actorStatus: member === null ? null : member.status,
      accountRegistered: registered,
      accountStatus: registered && account !== null ? account.status : null,
    });
  }

  proposeAction(request: PolicyActionRequest, expiresAt: string): ApprovalProposal {
    // Only members who may trade can put new risk up for approval; viewers, approvers and accountants cannot.
    this.#requireRole(request.organizationId, request.actor, PROPOSER_ROLES, "propose actions");
    const decision = this.evaluateAction(request);
    if (!decision.allowed) throw new Error(decision.reason ?? "action is denied by policy");
    if (request.riskClass === "terminal-resolution") throw new Error("terminal-resolution completes without approval");
    assertIsoTimestamp(expiresAt, "expiresAt");
    if (Date.parse(expiresAt) <= Date.parse(request.requestedAt)) {
      throw new RangeError("expiresAt must be later than requestedAt");
    }
    const proposal: ApprovalProposal = {
      id: this.#ids.next("proposal"),
      organizationId: request.organizationId,
      policyVersion: decision.policyVersion,
      actionPayloadHash: request.actionPayloadHash.toLowerCase() as Bytes32,
      accountId: request.accountId,
      marketId: request.marketId,
      riskDomainId: request.riskDomainId,
      routeClass: request.routeClass as RouteClass,
      settlementClass: request.settlementClass as SettlementClass,
      actionKind: request.actionKind,
      riskClass: request.riskClass,
      notional: { ...request.notional },
      environment: request.environment,
      status: "draft",
      createdBy: request.actor,
      createdAt: this.#clock.now().toISOString(),
      expiresAt,
      requiredApprovers: decision.requiredApprovers,
      approverRole: decision.approverRole,
      decisions: [],
      decidedAt: null,
      executedAt: null,
      executionReference: null,
      cancelReason: null,
    };
    this.#store.saveProposal(proposal);
    return proposal;
  }

  submitProposal(proposalId: string): ApprovalProposal {
    const proposal = this.#requireProposal(proposalId);
    const next = submitForApproval(proposal, this.#clock.now().toISOString());
    this.#store.saveProposal(next);
    return next;
  }

  decideOnProposal(
    proposalId: string,
    approver: ActorId,
    choice: ApprovalChoice,
    note: string | null = null,
  ): ApprovalProposal {
    const proposal = this.#requireProposal(proposalId);
    if (proposal.status !== "pending") throw new Error(`proposal ${proposalId} is not awaiting decision`);
    if (choice !== "approve" && choice !== "reject") throw new TypeError(`approval choice ${choice} is unsupported`);
    const member = this.#store.getMember(proposal.organizationId, approver);
    if (!member || member.status !== "active") throw new Error(`approver ${approver} is not an active member`);
    if (member.role !== proposal.approverRole && member.role !== "admin") {
      throw new Error(`approver ${approver} does not hold role ${proposal.approverRole}`);
    }
    const now = this.#clock.now().toISOString();
    const next = recordApprovalDecision(
      proposal,
      { proposalId: proposal.id, approver, roleAtDecision: member.role, choice, decidedAt: now, note },
      now,
    );
    this.#store.saveProposal(next);
    return next;
  }

  expireProposal(proposalId: string): ApprovalProposal {
    const proposal = this.#requireProposal(proposalId);
    const next = expireApproval(proposal, this.#clock.now().toISOString());
    this.#store.saveProposal(next);
    return next;
  }

  executeProposal(proposalId: string, executionReference: string): ApprovalProposal {
    const proposal = this.#requireProposal(proposalId);
    if (proposal.riskClass !== "terminal-resolution") {
      this.#writePolicy.assertWritable(proposal.environment);
    }
    const next = executeApproval(proposal, executionReference, this.#clock.now().toISOString());
    this.#store.saveProposal(next);
    return next;
  }

  cancelProposal(proposalId: string, reason: string): ApprovalProposal {
    const proposal = this.#requireProposal(proposalId);
    const next = cancelApproval(proposal, reason, this.#clock.now().toISOString());
    this.#store.saveProposal(next);
    return next;
  }

  recordExecutionJournal(input: CompletedPackageExecution, recordedBy: ActorId): AccountingJournal {
    this.#requireOrganization(input.organizationId);
    this.#requireRole(input.organizationId, recordedBy, JOURNAL_WRITER_ROLES, "record journals");
    const account = this.#store.getAccount(input.accountId);
    if (!account || account.organizationId !== input.organizationId) {
      throw new Error(`strategy account ${input.accountId} is not registered to this organization`);
    }
    const journal = buildAccountingJournal(
      input,
      this.#ids.next("journal"),
      this.#clock.now().toISOString(),
    );
    this.#store.saveJournal(journal);
    return journal;
  }

  exportJournal(journalId: string, exportedBy: ActorId): JournalExport {
    const journal = this.#store.getJournal(journalId);
    if (!journal) throw new Error(`unknown journal ${journalId}`);
    this.#requireRole(journal.organizationId, exportedBy, JOURNAL_EXPORTER_ROLES, "export journals");
    return exportAccountingJournal(journal);
  }

  getProposal(proposalId: string): ApprovalProposal | null {
    return this.#store.getProposal(proposalId);
  }

  listProposals(organizationId: OrganizationId): readonly ApprovalProposal[] {
    return this.#store.listProposals(organizationId);
  }

  currentPolicy(organizationId: OrganizationId): PolicyVersion | null {
    return this.#store.currentPolicy(organizationId);
  }

  writeStatus(environment: ControlEnvironment): ControlWriteDecision {
    return this.#writePolicy.assess(environment);
  }

  snapshot(): ControlSnapshot {
    return this.#store.snapshot(this.#clock.now());
  }

  #requireOrganization(organizationId: OrganizationId): Organization {
    const organization = this.#store.getOrganization(organizationId);
    if (!organization) throw new Error(`unknown organization ${organizationId}`);
    return organization;
  }

  #requireRole(
    organizationId: OrganizationId,
    actor: ActorId,
    roles: readonly OrganizationRole[],
    action: string,
  ): void {
    const member = this.#store.getMember(organizationId, actor);
    if (!member || member.status !== "active" || !roles.includes(member.role)) {
      throw new Error(`member ${actor} cannot ${action}`);
    }
  }

  #requireActiveAdmin(organizationId: OrganizationId, actor: ActorId): void {
    const member = this.#store.getMember(organizationId, actor);
    if (!member || member.status !== "active" || member.role !== "admin") {
      throw new Error(`member ${actor} is not an active admin`);
    }
  }

  #requireProposal(proposalId: string): ApprovalProposal {
    const proposal = this.#store.getProposal(proposalId);
    if (!proposal) throw new Error(`unknown approval proposal ${proposalId}`);
    return proposal;
  }

  #requireCurrentPolicy(organizationId: OrganizationId): PolicyVersion {
    const policy = this.#store.currentPolicy(organizationId);
    if (!policy) throw new Error(`organization ${organizationId} has no active policy`);
    return policy;
  }
}

const PROPOSER_ROLES: readonly OrganizationRole[] = ["admin", "trader"];
const JOURNAL_WRITER_ROLES: readonly OrganizationRole[] = ["admin", "accountant", "trader"];
const JOURNAL_EXPORTER_ROLES: readonly OrganizationRole[] = ["admin", "accountant"];

function cloneConstraints(constraints: PolicyConstraints): PolicyConstraints {
  return JSON.parse(JSON.stringify(constraints)) as PolicyConstraints;
}
