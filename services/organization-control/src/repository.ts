import {
  organizationControlVersion,
  type AccountingJournal,
  type AccountId,
  type ActorId,
  type ApprovalProposal,
  type ControlSnapshot,
  type Organization,
  type OrganizationId,
  type OrganizationMember,
  type PolicyVersion,
  type StrategyAccount,
} from "./types";

export type ControlIdPrefix = "org" | "proposal" | "journal" | "execution";

export interface ControlClock {
  now(): Date;
}

export interface ControlIdSource {
  next(prefix: ControlIdPrefix): string;
}

export interface OrganizationControlStorePort {
  saveOrganization(organization: Organization): void;
  getOrganization(id: OrganizationId): Organization | null;
  listOrganizations(): readonly Organization[];
  saveMember(member: OrganizationMember): void;
  getMember(organizationId: OrganizationId, memberId: ActorId): OrganizationMember | null;
  listMembers(organizationId: OrganizationId): readonly OrganizationMember[];
  saveAccount(account: StrategyAccount): void;
  getAccount(accountId: AccountId): StrategyAccount | null;
  listAccounts(organizationId: OrganizationId): readonly StrategyAccount[];
  savePolicy(policy: PolicyVersion): void;
  currentPolicy(organizationId: OrganizationId): PolicyVersion | null;
  getPolicy(organizationId: OrganizationId, version: number): PolicyVersion | null;
  listPolicies(organizationId: OrganizationId): readonly PolicyVersion[];
  saveProposal(proposal: ApprovalProposal): void;
  getProposal(id: string): ApprovalProposal | null;
  listProposals(organizationId: OrganizationId): readonly ApprovalProposal[];
  saveJournal(journal: AccountingJournal): void;
  getJournal(id: string): AccountingJournal | null;
  listJournals(organizationId: OrganizationId): readonly AccountingJournal[];
  snapshot(now: Date): ControlSnapshot;
}

const IMMUTABLE = new Set<ApprovalProposal["status"]>(["rejected", "expired", "executed", "canceled"]);

export class InMemoryOrganizationControlStore implements OrganizationControlStorePort {
  readonly #organizations = new Map<string, Organization>();
  readonly #members = new Map<string, OrganizationMember>();
  readonly #accounts = new Map<string, StrategyAccount>();
  readonly #policies = new Map<string, PolicyVersion>();
  readonly #proposals = new Map<string, ApprovalProposal>();
  readonly #journals = new Map<string, AccountingJournal>();

  saveOrganization(organization: Organization): void {
    if (this.#organizations.has(organization.id)) throw new Error(`organization ${organization.id} already exists`);
    this.#organizations.set(organization.id, clone(organization));
  }

  getOrganization(id: OrganizationId): Organization | null {
    const value = this.#organizations.get(id);
    return value === undefined ? null : clone(value);
  }

  listOrganizations(): readonly Organization[] {
    return [...this.#organizations.values()].sort((a, b) => a.id.localeCompare(b.id)).map(clone);
  }

  saveMember(member: OrganizationMember): void {
    this.#members.set(`${member.organizationId}:${member.memberId}`, clone(member));
  }

  getMember(organizationId: OrganizationId, memberId: ActorId): OrganizationMember | null {
    const value = this.#members.get(`${organizationId}:${memberId}`);
    return value === undefined ? null : clone(value);
  }

  listMembers(organizationId: OrganizationId): readonly OrganizationMember[] {
    return [...this.#members.values()]
      .filter((member) => member.organizationId === organizationId)
      .sort((a, b) => a.memberId.localeCompare(b.memberId))
      .map(clone);
  }

  saveAccount(account: StrategyAccount): void {
    this.#accounts.set(account.accountId, clone(account));
  }

  getAccount(accountId: AccountId): StrategyAccount | null {
    const value = this.#accounts.get(accountId);
    return value === undefined ? null : clone(value);
  }

  listAccounts(organizationId: OrganizationId): readonly StrategyAccount[] {
    return [...this.#accounts.values()]
      .filter((account) => account.organizationId === organizationId)
      .sort((a, b) => a.accountId.localeCompare(b.accountId))
      .map(clone);
  }

  savePolicy(policy: PolicyVersion): void {
    this.#policies.set(`${policy.organizationId}:${policy.version}`, clone(policy));
  }

  currentPolicy(organizationId: OrganizationId): PolicyVersion | null {
    const versions = this.listPolicies(organizationId);
    return versions.length === 0 ? null : versions[versions.length - 1];
  }

  getPolicy(organizationId: OrganizationId, version: number): PolicyVersion | null {
    const value = this.#policies.get(`${organizationId}:${version}`);
    return value === undefined ? null : clone(value);
  }

  listPolicies(organizationId: OrganizationId): readonly PolicyVersion[] {
    return [...this.#policies.values()]
      .filter((policy) => policy.organizationId === organizationId)
      .sort((a, b) => a.version - b.version)
      .map(clone);
  }

  saveProposal(proposal: ApprovalProposal): void {
    const existing = this.#proposals.get(proposal.id);
    if (existing !== undefined && IMMUTABLE.has(existing.status)) {
      throw new Error(`historical approval ${proposal.id} is immutable`);
    }
    this.#proposals.set(proposal.id, clone(proposal));
  }

  getProposal(id: string): ApprovalProposal | null {
    const value = this.#proposals.get(id);
    return value === undefined ? null : clone(value);
  }

  listProposals(organizationId: OrganizationId): readonly ApprovalProposal[] {
    return [...this.#proposals.values()]
      .filter((proposal) => proposal.organizationId === organizationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(clone);
  }

  saveJournal(journal: AccountingJournal): void {
    if (this.#journals.has(journal.journalId)) throw new Error(`journal ${journal.journalId} already exists`);
    this.#journals.set(journal.journalId, clone(journal));
  }

  getJournal(id: string): AccountingJournal | null {
    const value = this.#journals.get(id);
    return value === undefined ? null : clone(value);
  }

  listJournals(organizationId: OrganizationId): readonly AccountingJournal[] {
    return [...this.#journals.values()]
      .filter((journal) => journal.organizationId === organizationId)
      .sort((a, b) => a.postedAt.localeCompare(b.postedAt) || a.journalId.localeCompare(b.journalId))
      .map(clone);
  }

  snapshot(now: Date): ControlSnapshot {
    const members = [...this.#members.values()].sort(
      (a, b) => a.organizationId.localeCompare(b.organizationId) || a.memberId.localeCompare(b.memberId),
    );
    const accounts = [...this.#accounts.values()].sort((a, b) => a.accountId.localeCompare(b.accountId));
    const policies = [...this.#policies.values()].sort(
      (a, b) => a.organizationId.localeCompare(b.organizationId) || a.version - b.version,
    );
    const proposals = [...this.#proposals.values()].sort((a, b) => a.id.localeCompare(b.id));
    const journals = [...this.#journals.values()].sort((a, b) => a.journalId.localeCompare(b.journalId));
    return {
      schemaVersion: organizationControlVersion,
      generatedAt: now.toISOString(),
      organizations: this.listOrganizations(),
      members: members.map(clone),
      accounts: accounts.map(clone),
      policies: policies.map(clone),
      proposals: proposals.map(clone),
      journals: journals.map(clone),
    };
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
