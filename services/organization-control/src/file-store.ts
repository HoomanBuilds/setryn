import { InMemoryOrganizationControlStore, type OrganizationControlStorePort } from "./repository";
import {
  assertBytes32,
  organizationControlVersion,
  type AccountId,
  type AccountingJournal,
  type ActorId,
  type ApprovalProposal,
  type ControlSnapshot,
  type Organization,
  type OrganizationId,
  type OrganizationMember,
  type PolicyVersion,
  type StrategyAccount,
} from "./types";

/**
 * The few synchronous file operations the store needs. Node's `node:fs` module satisfies it structurally, so callers
 * pass it directly; any other runtime supplies its own.
 */
export interface ControlSnapshotFileSystem {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string, options: { encoding: "utf8"; mode: number }): void;
  renameSync(oldPath: string, newPath: string): void;
  mkdirSync(path: string, options: { recursive: true }): unknown;
}

export interface FileOrganizationControlStoreOptions {
  /** Snapshot file. Loaded on construction when present, rewritten after every committed change. */
  readonly path: string;
  /** Defaults to Node's built-in `node:fs`. */
  readonly fileSystem?: ControlSnapshotFileSystem;
}

/**
 * Durable organization control store. Records live in an in-memory store; the file holds the latest `ControlSnapshot`.
 * On construction the snapshot is replayed in dependency order (organizations, members, accounts, policies by
 * version, proposals, journals), refusing any record that points at an organization the file does not define. After
 * every save, or once at the end of `runAtomically`, the whole snapshot is written to a temporary file and renamed over
 * the old one, so a reader never sees a partial file. A failed write or a failed atomic batch restores the last
 * persisted state.
 */
export class FileOrganizationControlStore implements OrganizationControlStorePort {
  readonly path: string;
  readonly #fs: ControlSnapshotFileSystem;
  #inner: InMemoryOrganizationControlStore;
  #persisted: ControlSnapshot | null;
  #batchDepth = 0;
  #dirty = false;

  constructor(options: FileOrganizationControlStoreOptions) {
    if (typeof options.path !== "string" || options.path.trim().length === 0) {
      throw new TypeError("organization control store path must not be empty");
    }
    this.path = options.path;
    this.#fs = options.fileSystem ?? nodeFileSystem();
    this.#persisted = this.#fs.existsSync(this.path) ? parseSnapshot(this.#fs.readFileSync(this.path, "utf8")) : null;
    this.#inner = replaySnapshot(this.#persisted);
  }

  /**
   * Runs `operation` against the store and persists once at the end. If it throws, every change it made is discarded
   * and the store returns to the last persisted snapshot.
   */
  runAtomically<T>(operation: () => T): T {
    this.#batchDepth += 1;
    try {
      const result = operation();
      this.#batchDepth -= 1;
      if (this.#batchDepth === 0 && this.#dirty) this.#persist();
      return result;
    } catch (error) {
      this.#batchDepth -= 1;
      if (this.#batchDepth === 0) this.#restore();
      throw error;
    }
  }

  saveOrganization(organization: Organization): void {
    this.#inner.saveOrganization(organization);
    this.#committed();
  }

  getOrganization(id: OrganizationId): Organization | null {
    return this.#inner.getOrganization(id);
  }

  listOrganizations(): readonly Organization[] {
    return this.#inner.listOrganizations();
  }

  saveMember(member: OrganizationMember): void {
    this.#inner.saveMember(member);
    this.#committed();
  }

  getMember(organizationId: OrganizationId, memberId: ActorId): OrganizationMember | null {
    return this.#inner.getMember(organizationId, memberId);
  }

  listMembers(organizationId: OrganizationId): readonly OrganizationMember[] {
    return this.#inner.listMembers(organizationId);
  }

  saveAccount(account: StrategyAccount): void {
    this.#inner.saveAccount(account);
    this.#committed();
  }

  getAccount(accountId: AccountId): StrategyAccount | null {
    return this.#inner.getAccount(accountId);
  }

  listAccounts(organizationId: OrganizationId): readonly StrategyAccount[] {
    return this.#inner.listAccounts(organizationId);
  }

  savePolicy(policy: PolicyVersion): void {
    this.#inner.savePolicy(policy);
    this.#committed();
  }

  currentPolicy(organizationId: OrganizationId): PolicyVersion | null {
    return this.#inner.currentPolicy(organizationId);
  }

  getPolicy(organizationId: OrganizationId, version: number): PolicyVersion | null {
    return this.#inner.getPolicy(organizationId, version);
  }

  listPolicies(organizationId: OrganizationId): readonly PolicyVersion[] {
    return this.#inner.listPolicies(organizationId);
  }

  saveProposal(proposal: ApprovalProposal): void {
    this.#inner.saveProposal(proposal);
    this.#committed();
  }

  getProposal(id: string): ApprovalProposal | null {
    return this.#inner.getProposal(id);
  }

  listProposals(organizationId: OrganizationId): readonly ApprovalProposal[] {
    return this.#inner.listProposals(organizationId);
  }

  saveJournal(journal: AccountingJournal): void {
    this.#inner.saveJournal(journal);
    this.#committed();
  }

  getJournal(id: string): AccountingJournal | null {
    return this.#inner.getJournal(id);
  }

  listJournals(organizationId: OrganizationId): readonly AccountingJournal[] {
    return this.#inner.listJournals(organizationId);
  }

  snapshot(now: Date): ControlSnapshot {
    return this.#inner.snapshot(now);
  }

  #committed(): void {
    this.#dirty = true;
    if (this.#batchDepth === 0) this.#persist();
  }

  #persist(): void {
    const snapshot = this.#inner.snapshot(new Date());
    try {
      const directory = parentDirectory(this.path);
      if (directory !== null) this.#fs.mkdirSync(directory, { recursive: true });
      const temporary = `${this.path}.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.tmp`;
      this.#fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      this.#fs.renameSync(temporary, this.path);
    } catch (error) {
      this.#restore();
      throw error;
    }
    this.#persisted = snapshot;
    this.#dirty = false;
  }

  #restore(): void {
    this.#inner = replaySnapshot(this.#persisted);
    this.#dirty = false;
  }
}

function nodeFileSystem(): ControlSnapshotFileSystem {
  const runtime = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = runtime?.getBuiltinModule?.("node:fs");
  if (!fs) throw new Error("FileOrganizationControlStore needs a file system; pass one outside Node.js");
  return fs as ControlSnapshotFileSystem;
}

function parentDirectory(path: string): string | null {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index <= 0 ? null : path.slice(0, index);
}

const SNAPSHOT_COLLECTIONS = ["organizations", "members", "accounts", "policies", "proposals", "journals"] as const;

function parseSnapshot(text: string): ControlSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("organization control snapshot is not valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("organization control snapshot must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== organizationControlVersion) {
    throw new Error(`organization control snapshot schema ${String(record.schemaVersion)} is unsupported`);
  }
  for (const key of SNAPSHOT_COLLECTIONS) {
    if (!Array.isArray(record[key])) throw new Error(`organization control snapshot ${key} must be an array`);
  }
  return value as ControlSnapshot;
}

/** Rebuilds an in-memory store from a snapshot, parents first, so every record's organization exists before it does. */
function replaySnapshot(snapshot: ControlSnapshot | null): InMemoryOrganizationControlStore {
  const store = new InMemoryOrganizationControlStore();
  if (snapshot === null) return store;
  const organizations = new Set<string>();
  const requireOrganization = (organizationId: unknown, label: string): void => {
    if (typeof organizationId !== "string" || !organizations.has(organizationId)) {
      throw new Error(`organization control snapshot ${label} references unknown organization ${String(organizationId)}`);
    }
  };
  for (const organization of snapshot.organizations) {
    assertBytes32(organization.id, "snapshot organization id");
    store.saveOrganization(organization);
    organizations.add(organization.id);
  }
  for (const member of snapshot.members) {
    requireOrganization(member.organizationId, `member ${member.memberId}`);
    store.saveMember(member);
  }
  for (const account of snapshot.accounts) {
    requireOrganization(account.organizationId, `account ${account.accountId}`);
    assertBytes32(account.accountId, "snapshot account id");
    store.saveAccount(account);
  }
  const policies = [...snapshot.policies].sort(
    (a, b) => a.organizationId.localeCompare(b.organizationId) || a.version - b.version,
  );
  for (const policy of policies) {
    requireOrganization(policy.organizationId, `policy v${policy.version}`);
    if (!Number.isSafeInteger(policy.version) || policy.version < 1) {
      throw new Error(`organization control snapshot policy version ${String(policy.version)} is invalid`);
    }
    store.savePolicy(policy);
  }
  for (const proposal of snapshot.proposals) {
    requireOrganization(proposal.organizationId, `proposal ${proposal.id}`);
    store.saveProposal(proposal);
  }
  for (const journal of snapshot.journals) {
    requireOrganization(journal.organizationId, `journal ${journal.journalId}`);
    store.saveJournal(journal);
  }
  return store;
}
