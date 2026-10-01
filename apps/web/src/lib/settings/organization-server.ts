/*
 * Server side of organization control: one organization-control service per process, over a file-backed store, and
 * the signed-action handler behind `/api/organization`. Members are wallet addresses (lowercased) acting with their
 * own signatures; every write first passes the service's write policy for the configured network, which refuses
 * Arbitrum One.
 */
import * as fs from "node:fs";
import { resolve } from "node:path";
import { setrynDataRoot } from "@/lib/webhooks/json-store";
import { createPublicClient, http, isAddress, isHex, verifyMessage, type Hex, type PublicClient } from "viem";
import {
  FileOrganizationControlStore,
  InternalOrganizationControlService,
  OrganizationControlWritePolicy,
  ORGANIZATION_ROLES,
  assertBytes32,
  sha256Hex,
  type ActorId,
  type ApprovalProposal,
  type ControlEnvironment,
  type ControlSnapshotFileSystem,
  type ControlSnapshot,
  type MonetaryAmount,
  type OrganizationRole,
  type PolicyActionRequest,
  type PolicyConstraints,
  type ScopeAllowlist,
  type StrategyAccountStatus,
} from "../../../../../services/organization-control/src/index";
import { databaseConfigured, readDocument, updateDocument } from "@setryn/persistence";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";
import { networkLabel } from "./organization";
import {
  ORGANIZATION_SIGNATURE_WINDOW_MS,
  isOrganizationAction,
  organizationActionMessage,
  type OrganizationAction,
  type OrganizationActionResponse,
  type OrganizationControlState,
} from "./organization-protocol";

const NETWORKS: readonly ControlEnvironment[] = ["local", "arbitrum-sepolia", "arbitrum-one"];
const MAX_BODY_BYTES = 64 * 1024;

export class OrganizationRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function organizationNetwork(): ControlEnvironment {
  const raw = (process.env.SETRYN_NETWORK ?? process.env.NEXT_PUBLIC_SETRYN_NETWORK ?? "local").trim();
  if (!(NETWORKS as readonly string[]).includes(raw)) {
    throw new OrganizationRequestError(503, "NETWORK_UNSUPPORTED", `SETRYN_NETWORK ${raw} is not a supported network`);
  }
  return raw as ControlEnvironment;
}

/** `SETRYN_ORG_STORE_PATH`, or `<repo>/.setryn/organization-control/<network>.json` next to the other local data. */
export function organizationStorePath(network: ControlEnvironment): string {
  if (process.env.SETRYN_ORG_STORE_PATH) return resolve(/*turbopackIgnore: true*/ process.env.SETRYN_ORG_STORE_PATH);
  return resolve(/*turbopackIgnore: true*/ setrynDataRoot(), "organization-control", `${network}.json`);
}

/** RPC used only to check contract-wallet (ERC-1271 / ERC-6492) signatures. */
function organizationRpcUrl(network: ControlEnvironment): string {
  if (process.env.SETRYN_RPC_URL) return process.env.SETRYN_RPC_URL;
  if (network === "arbitrum-sepolia") return "https://sepolia-rollup.arbitrum.io/rpc";
  if (network === "arbitrum-one") return "https://arb1.arbitrum.io/rpc";
  return process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
}

interface OrganizationControlRuntime {
  readonly key: string;
  readonly network: ControlEnvironment;
  readonly path: string;
  readonly store: FileOrganizationControlStore;
  readonly service: InternalOrganizationControlService;
  readonly writePolicy: OrganizationControlWritePolicy;
  /** Accepted actor+message digests, until their issue window closes. */
  readonly accepted: Map<string, number>;
  client: PublicClient | null;
}

const RUNTIME_KEY = Symbol.for("setryn.organization-control.runtime");

interface DatabaseOrganizationState {
  version: 1;
  snapshot: ControlSnapshot | null;
  accepted: Record<string, number>;
}

const emptyDatabaseState = (): DatabaseOrganizationState => ({ version: 1, snapshot: null, accepted: {} });

/** The per-process service. Kept on `globalThis` so development reloads of this module share one store and replay set. */
export function organizationControl(): OrganizationControlRuntime {
  const network = organizationNetwork();
  const path = organizationStorePath(network);
  const key = `${network}:${path}`;
  const holder = globalThis as typeof globalThis & { [RUNTIME_KEY]?: OrganizationControlRuntime };
  const existing = holder[RUNTIME_KEY];
  if (existing && existing.key === key) return existing;
  let store: FileOrganizationControlStore;
  try {
    store = new FileOrganizationControlStore({ path, fileSystem: fs });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unreadable";
    throw new OrganizationRequestError(503, "STORE_UNAVAILABLE", `Organization records could not be loaded: ${detail}`);
  }
  const writePolicy = new OrganizationControlWritePolicy();
  const runtime: OrganizationControlRuntime = {
    key,
    network,
    path,
    store,
    service: new InternalOrganizationControlService({ store, writePolicy }),
    writePolicy,
    accepted: new Map(),
    client: null,
  };
  holder[RUNTIME_KEY] = runtime;
  return runtime;
}

export function normalizeMember(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) return null;
  return value.toLowerCase();
}

/** The snapshot narrowed to organizations where `member` has a membership record, active or revoked. */
function snapshotForMember(snapshot: ControlSnapshot, member: string | null): ControlSnapshot {
  const organizations = new Set<string>(
    member === null ? [] : snapshot.members.filter((item) => item.memberId === member).map((item) => item.organizationId),
  );
  const visible = <T extends { organizationId: string }>(items: readonly T[]) =>
    items.filter((item) => organizations.has(item.organizationId));
  return {
    ...snapshot,
    organizations: snapshot.organizations.filter((item) => organizations.has(item.id)),
    members: visible(snapshot.members),
    accounts: visible(snapshot.accounts),
    policies: visible(snapshot.policies),
    proposals: visible(snapshot.proposals),
    journals: visible(snapshot.journals),
  };
}

function stateFromControl(control: OrganizationControlRuntime, member: string | null): OrganizationControlState {
  return {
    network: control.network,
    networkLabel: networkLabel(control.network),
    write: control.service.writeStatus(control.network),
    member,
    snapshot: snapshotForMember(control.service.snapshot(), member),
  };
}

export async function readOrganizationState(member: string | null): Promise<OrganizationControlState> {
  if (!databaseConfigured()) return stateFromControl(organizationControl(), member);
  const network = organizationNetwork();
  const stored = await readDocument("organization-control", `${network}.json`, emptyDatabaseState());
  return stateFromControl(controlFromSnapshot(network, stored.snapshot), member);
}

/* ---------------------------------------------------------------- signed actions */

interface ParsedActionRequest {
  action: OrganizationAction;
  params: Record<string, unknown>;
  actor: ActorId;
  issuedAt: string;
  signature: Hex;
}

function parseActionRequest(text: string): ParsedActionRequest {
  if (text.length > MAX_BODY_BYTES) throw new OrganizationRequestError(413, "BODY_TOO_LARGE", "Request body is too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OrganizationRequestError(400, "INVALID_JSON", "Request body must be JSON");
  }
  const record = plainObject(body, "body");
  if (!isOrganizationAction(record.action)) throw new OrganizationRequestError(400, "UNKNOWN_ACTION", `Unknown action ${String(record.action)}`);
  const params = plainObject(record.params, "params");
  const actor = normalizeMember(typeof record.actor === "string" ? record.actor : null);
  if (actor === null) throw new OrganizationRequestError(400, "INVALID_ACTOR", "actor must be a wallet address");
  const issuedAt = record.issuedAt;
  if (typeof issuedAt !== "string" || !Number.isFinite(Date.parse(issuedAt)) || new Date(issuedAt).toISOString() !== issuedAt) {
    throw new OrganizationRequestError(400, "INVALID_ISSUED_AT", "issuedAt must be a canonical ISO timestamp");
  }
  const signature = record.signature;
  if (typeof signature !== "string" || !isHex(signature) || signature.length < 4 || signature.length > 20_000) {
    throw new OrganizationRequestError(400, "INVALID_SIGNATURE", "signature must be a hex signature");
  }
  return { action: record.action, params, actor, issuedAt, signature: signature as Hex };
}

async function signatureMatches(control: OrganizationControlRuntime, address: Hex, message: string, signature: Hex): Promise<boolean> {
  try {
    if (await verifyMessage({ address, message, signature })) return true;
  } catch {
    // Not a recoverable EOA signature; a contract wallet may still have signed it.
  }
  try {
    control.client ??= createPublicClient({ transport: http(organizationRpcUrl(control.network), { timeout: 5_000, retryCount: 0 }) });
    return await control.client.verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}

/**
 * Verifies and applies one signed action. The signature must cover the exact action message for this network, be
 * issued within five minutes of the server clock, and not have been accepted before; the address it verifies for is
 * the actor.
 */
export async function performOrganizationAction(text: string): Promise<OrganizationActionResponse> {
  const control = organizationControl();
  const write = control.writePolicy.assess(control.network);
  if (!write.allowed) throw new OrganizationRequestError(403, "WRITES_DISABLED", write.reason ?? "Writes are disabled on this network");
  const request = parseActionRequest(text);
  const now = Date.now();
  const issuedAtMs = Date.parse(request.issuedAt);
  if (Math.abs(now - issuedAtMs) > ORGANIZATION_SIGNATURE_WINDOW_MS) {
    throw new OrganizationRequestError(401, "SIGNATURE_EXPIRED", "The signed action is outside the five-minute window; sign it again");
  }
  const message = organizationActionMessage({
    action: request.action,
    params: request.params,
    network: control.network,
    issuedAt: request.issuedAt,
  });
  // Keyed on the signed content rather than the signature bytes, so a re-encoded signature cannot replay it either.
  const digest = sha256Hex(`${request.actor}\n${message}`);
  if (!databaseConfigured()) {
    for (const [key, expiresAt] of control.accepted) if (expiresAt <= now) control.accepted.delete(key);
    if (control.accepted.has(digest)) throw new OrganizationRequestError(409, "SIGNATURE_REUSED", "This signed action was already used");
  }
  if (!(await signatureMatches(control, request.actor as Hex, message, request.signature))) {
    throw new OrganizationRequestError(401, "SIGNATURE_MISMATCH", "The signature does not match the actor for this action");
  }
  if (request.action === "registerStrategyAccount") await requireControlledAccount(request.params, request.actor);

  if (databaseConfigured()) {
    return updateDocument("organization-control", `${control.network}.json`, emptyDatabaseState(), (stored) => {
      for (const [key, expiresAt] of Object.entries(stored.accepted)) if (expiresAt <= now) delete stored.accepted[key];
      if (stored.accepted[digest] !== undefined) {
        throw new OrganizationRequestError(409, "SIGNATURE_REUSED", "This signed action was already used");
      }
      const databaseControl = controlFromSnapshot(control.network, stored.snapshot);
      let result: unknown;
      try {
        result = databaseControl.store.runAtomically(() =>
          applyAction(databaseControl, request.action, request.params, request.actor),
        );
      } catch (error) {
        throw asRequestError(error);
      }
      stored.accepted[digest] = issuedAtMs + ORGANIZATION_SIGNATURE_WINDOW_MS;
      stored.snapshot = databaseControl.service.snapshot();
      return {
        next: stored,
        result: { ...stateFromControl(databaseControl, request.actor), action: request.action, result },
      };
    });
  }

  if (control.accepted.has(digest)) throw new OrganizationRequestError(409, "SIGNATURE_REUSED", "This signed action was already used");
  control.accepted.set(digest, issuedAtMs + ORGANIZATION_SIGNATURE_WINDOW_MS);

  let result: unknown;
  try {
    result = control.store.runAtomically(() => applyAction(control, request.action, request.params, request.actor));
  } catch (error) {
    throw asRequestError(error);
  }
  return { ...stateFromControl(control, request.actor), action: request.action, result };
}

function controlFromSnapshot(network: ControlEnvironment, snapshot: ControlSnapshot | null): OrganizationControlRuntime {
  const path = "organization-control.json";
  const files = new Map<string, string>();
  if (snapshot) files.set(path, JSON.stringify(snapshot));
  const fileSystem: ControlSnapshotFileSystem = {
    existsSync: (target) => files.has(target),
    readFileSync: (target) => {
      const value = files.get(target);
      if (value === undefined) throw new Error(`missing in-memory organization snapshot ${target}`);
      return value;
    },
    writeFileSync: (target, data) => {
      files.set(target, data);
    },
    renameSync: (source, target) => {
      const value = files.get(source);
      if (value === undefined) throw new Error(`missing in-memory organization snapshot ${source}`);
      files.set(target, value);
      files.delete(source);
    },
    mkdirSync: () => undefined,
  };
  const store = new FileOrganizationControlStore({ path, fileSystem });
  const writePolicy = new OrganizationControlWritePolicy();
  return {
    key: `${network}:database`,
    network,
    path: "database",
    store,
    service: new InternalOrganizationControlService({ store, writePolicy }),
    writePolicy,
    accepted: new Map(),
    client: null,
  };
}

const vaultAccountAbi = [
  {
    type: "function",
    name: "getAccount",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "bytes32" }],
    outputs: [
      { name: "controller", type: "address" },
      { name: "pendingController", type: "address" },
    ],
  },
] as const;

/**
 * A member may register only a collateral account its own wallet controls onchain, so nobody can claim another
 * trader's account for their organization first.
 */
async function requireControlledAccount(params: Record<string, unknown>, actor: ActorId): Promise<void> {
  const accountId = bytes32(params, "accountId") as Hex;
  let controller: string;
  try {
    const setryn = await readRuntime();
    const client = createPublicClient({ transport: http(setryn.rpcUrl) });
    [controller] = await client.readContract({
      address: setryn.collateralVault,
      abi: vaultAccountAbi,
      functionName: "getAccount",
      args: [accountId],
    });
  } catch {
    throw new OrganizationRequestError(409, "ACCOUNT_UNVERIFIED", "The account does not exist onchain or the chain could not be read");
  }
  if (controller.toLowerCase() !== actor.toLowerCase()) {
    throw forbidden("Only the wallet that controls a collateral account can register it");
  }
}

function applyAction(
  control: OrganizationControlRuntime,
  action: OrganizationAction,
  params: Record<string, unknown>,
  actor: ActorId,
): unknown {
  const { service, network } = control;
  switch (action) {
    case "createOrganization":
      return service.createOrganization(text(params, "name", 80), actor);
    case "grantRole":
      return service.grantRole(bytes32(params, "organizationId"), member(params, "memberId"), role(params, "role"), actor);
    case "revokeRole":
      return service.revokeRole(bytes32(params, "organizationId"), member(params, "memberId"), actor);
    case "registerStrategyAccount":
      return service.registerStrategyAccount(
        bytes32(params, "organizationId"),
        bytes32(params, "accountId"),
        text(params, "label", 80),
        params.riskDomainId === undefined || params.riskDomainId === null ? null : bytes32(params, "riskDomainId"),
        actor,
      );
    case "setAccountStatus":
      return service.setAccountStatus(bytes32(params, "organizationId"), bytes32(params, "accountId"), accountStatus(params), actor);
    case "publishPolicy":
      return service.publishPolicy(bytes32(params, "organizationId"), actor, constraints(params.constraints));
    case "proposeAction": {
      const request: PolicyActionRequest = {
        organizationId: bytes32(params, "organizationId"),
        actor,
        environment: network,
        accountId: bytes32(params, "accountId"),
        marketId: bytes32(params, "marketId"),
        riskDomainId: bytes32(params, "riskDomainId"),
        routeClass: text(params, "routeClass", 40),
        settlementClass: text(params, "settlementClass", 40),
        actionKind: text(params, "actionKind", 40),
        riskClass: riskClass(params),
        notional: amount(params.notional, "notional"),
        collateral: params.collateral === undefined || params.collateral === null ? null : amount(params.collateral, "collateral"),
        requestedAt: new Date().toISOString(),
        actionPayloadHash: bytes32(params, "actionPayloadHash"),
      };
      return service.proposeAction(request, isoTimestamp(params, "expiresAt"));
    }
    case "submitProposal": {
      const proposal = requireProposal(control, params);
      if (proposal.createdBy !== actor) throw forbidden("Only the member who proposed this action can submit it");
      return service.submitProposal(proposal.id);
    }
    case "decideOnProposal": {
      const proposal = requireProposal(control, params);
      const choice = params.choice;
      if (choice !== "approve" && choice !== "reject") throw invalid("choice must be approve or reject");
      const note = params.note === undefined || params.note === null || params.note === "" ? null : text(params, "note", 280);
      return service.decideOnProposal(proposal.id, actor, choice, note);
    }
    case "cancelProposal": {
      const proposal = requireProposal(control, params);
      requireCreatorOrAdmin(control, proposal, actor, "cancel");
      return service.cancelProposal(proposal.id, text(params, "reason", 280));
    }
    case "executeProposal": {
      const proposal = requireProposal(control, params);
      requireCreatorOrAdmin(control, proposal, actor, "execute");
      return service.executeProposal(proposal.id, text(params, "executionReference", 200));
    }
    case "expireProposal": {
      const proposal = requireProposal(control, params);
      const membership = control.store.getMember(proposal.organizationId, actor);
      if (!membership || membership.status !== "active") throw forbidden("Only an active member can expire this proposal");
      return service.expireProposal(proposal.id);
    }
  }
}

function requireProposal(control: OrganizationControlRuntime, params: Record<string, unknown>): ApprovalProposal {
  const id = text(params, "proposalId", 80);
  const proposal = control.service.getProposal(id);
  if (!proposal) throw new OrganizationRequestError(404, "NOT_FOUND", `unknown approval proposal ${id}`);
  return proposal;
}

function requireCreatorOrAdmin(control: OrganizationControlRuntime, proposal: ApprovalProposal, actor: ActorId, verb: string): void {
  if (proposal.createdBy === actor) return;
  const membership = control.store.getMember(proposal.organizationId, actor);
  if (membership && membership.status === "active" && membership.role === "admin") return;
  throw forbidden(`Only the proposer or an active admin can ${verb} this proposal`);
}

/* ---------------------------------------------------------------- parameter parsing */

function invalid(message: string): OrganizationRequestError {
  return new OrganizationRequestError(400, "INVALID_PARAMS", message);
}

function forbidden(message: string): OrganizationRequestError {
  return new OrganizationRequestError(403, "FORBIDDEN", message);
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(params: Record<string, unknown>, key: string, max: number): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim().length === 0) throw invalid(`${key} is required`);
  if (value.length > max) throw invalid(`${key} must be at most ${max} characters`);
  return value.trim();
}

function bytes32(params: Record<string, unknown>, key: string) {
  try {
    return assertBytes32(params[key], key);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${key} must be a 32-byte value`);
  }
}

function member(params: Record<string, unknown>, key: string): ActorId {
  const value = normalizeMember(typeof params[key] === "string" ? (params[key] as string) : null);
  if (value === null) throw invalid(`${key} must be a wallet address`);
  return value;
}

function role(params: Record<string, unknown>, key: string): OrganizationRole {
  const value = params[key];
  if (typeof value !== "string" || !(ORGANIZATION_ROLES as readonly string[]).includes(value)) throw invalid(`${key} is not an organization role`);
  return value as OrganizationRole;
}

function accountStatus(params: Record<string, unknown>): StrategyAccountStatus {
  const value = params.status;
  if (value !== "active" && value !== "suspended" && value !== "closed") throw invalid("status must be active, suspended, or closed");
  return value;
}

function riskClass(params: Record<string, unknown>): PolicyActionRequest["riskClass"] {
  const value = params.riskClass;
  if (value !== "new-risk" && value !== "terminal-resolution" && value !== "operational") {
    throw invalid("riskClass must be new-risk, terminal-resolution, or operational");
  }
  return value;
}

function isoTimestamp(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw invalid(`${key} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function amount(value: unknown, label: string): MonetaryAmount {
  const record = plainObject(value, label);
  if (typeof record.amount !== "string" || record.amount.length > 60) throw invalid(`${label}.amount must be a decimal string`);
  if (typeof record.currency !== "string" || record.currency.trim().length === 0 || record.currency.length > 12) {
    throw invalid(`${label}.currency is required`);
  }
  return { amount: record.amount, currency: record.currency.trim() };
}

function optionalAmount(value: unknown, label: string): MonetaryAmount | null {
  return value === undefined || value === null ? null : amount(value, label);
}

function optionalIso(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw invalid(`${label} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function scope<T extends string>(value: unknown, label: string, hex: boolean): ScopeAllowlist<T> {
  if (value === undefined || value === null) return { mode: "any", values: [] };
  const record = plainObject(value, label);
  if (record.mode !== "any" && record.mode !== "list") throw invalid(`${label}.mode must be any or list`);
  if (!Array.isArray(record.values) || record.values.length > 64 || record.values.some((item) => typeof item !== "string")) {
    throw invalid(`${label}.values must be a list of strings`);
  }
  const values = (record.values as string[]).map((item) => (hex ? item.toLowerCase() : item)) as T[];
  return { mode: record.mode, values };
}

/** Rebuilds the constraints from known fields only, so nothing but the service's schema is ever persisted. */
function constraints(value: unknown): PolicyConstraints {
  const record = plainObject(value, "constraints");
  const requiredApprovers = record.requiredApprovers;
  if (typeof requiredApprovers !== "number") throw invalid("constraints.requiredApprovers must be a number");
  const approverRole = record.approverRole;
  if (typeof approverRole !== "string" || !(ORGANIZATION_ROLES as readonly string[]).includes(approverRole)) {
    throw invalid("constraints.approverRole is not an organization role");
  }
  return {
    accounts: scope(record.accounts, "constraints.accounts", true),
    markets: scope(record.markets, "constraints.markets", true),
    riskDomains: scope(record.riskDomains, "constraints.riskDomains", true),
    routes: scope(record.routes, "constraints.routes", false),
    settlement: scope(record.settlement, "constraints.settlement", false),
    maxNotional: optionalAmount(record.maxNotional, "constraints.maxNotional"),
    minCollateral: optionalAmount(record.minCollateral, "constraints.minCollateral"),
    validFrom: optionalIso(record.validFrom, "constraints.validFrom"),
    validUntil: optionalIso(record.validUntil, "constraints.validUntil"),
    requiredApprovers,
    approverRole: approverRole as OrganizationRole,
    dualControlThreshold: optionalAmount(record.dualControlThreshold, "constraints.dualControlThreshold"),
  };
}

/* ---------------------------------------------------------------- errors */

/**
 * Maps a service refusal to a client status: malformed input 400, missing authority 403, unknown records 404, and
 * state conflicts (already decided, closed, expired, denied by policy) 409. File system failures are 503.
 */
function asRequestError(error: unknown): OrganizationRequestError {
  if (error instanceof OrganizationRequestError) return error;
  const message = error instanceof Error ? error.message.split("\n")[0] : "Organization control failed";
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) {
    return new OrganizationRequestError(503, "STORE_UNAVAILABLE", "Organization records could not be saved");
  }
  if (error instanceof TypeError || error instanceof RangeError) return new OrganizationRequestError(400, "INVALID_PARAMS", message);
  if (/^unknown /.test(message)) return new OrganizationRequestError(404, "NOT_FOUND", message);
  if (/is not an active admin|is not an active member|does not hold role|cannot (register|propose|record|export) /.test(message)) {
    return new OrganizationRequestError(403, "FORBIDDEN", message);
  }
  return new OrganizationRequestError(409, "REJECTED", message);
}

export function organizationErrorResponse(error: unknown): { status: number; body: { error: string; message: string } } {
  const failure = asRequestError(error);
  return { status: failure.status, body: { error: failure.code, message: failure.message } };
}
