/*
 * Wire contract between the settings workspace and `/api/organization`, shared by the browser and the server so both
 * build the signed message from the same bytes. Hashing reuses the organization-control service's own canonical JSON
 * and SHA-256, the functions it hashes approval payloads with.
 */
import { sha256Hex, stableJson } from "../../../../../services/organization-control/src/approvals";
import type { ControlEnvironment, ControlSnapshot } from "./organization";

export const ORGANIZATION_ACTIONS = [
  "createOrganization",
  "grantRole",
  "revokeRole",
  "registerStrategyAccount",
  "setAccountStatus",
  "publishPolicy",
  "proposeAction",
  "submitProposal",
  "decideOnProposal",
  "cancelProposal",
  "executeProposal",
  "expireProposal",
] as const;

export type OrganizationAction = (typeof ORGANIZATION_ACTIONS)[number];

export function isOrganizationAction(value: unknown): value is OrganizationAction {
  return typeof value === "string" && (ORGANIZATION_ACTIONS as readonly string[]).includes(value);
}

/** A signed action is accepted only while its issue time is within this window of the server clock, and only once. */
export const ORGANIZATION_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export function organizationPayloadHash(params: unknown): string {
  return sha256Hex(stableJson(params));
}

/** The exact text a member's wallet signs for one action. */
export function organizationActionMessage(input: {
  action: OrganizationAction;
  params: unknown;
  network: ControlEnvironment;
  issuedAt: string;
}): string {
  return [
    "Setryn organization control",
    `Action: ${input.action}`,
    `Payload: ${organizationPayloadHash(input.params)}`,
    `Network: ${input.network}`,
    `Issued: ${input.issuedAt}`,
  ].join("\n");
}

export interface OrganizationWriteStatus {
  allowed: boolean;
  reason: string | null;
}

/** `GET /api/organization?member=<address>`: the records of every organization the address has a membership in. */
export interface OrganizationControlState {
  network: ControlEnvironment;
  networkLabel: string;
  write: OrganizationWriteStatus;
  /** The lowercased member address the snapshot was filtered for, or null for an empty snapshot. */
  member: string | null;
  snapshot: ControlSnapshot;
}

/** `POST /api/organization` body. */
export interface OrganizationActionRequest {
  action: OrganizationAction;
  params: Record<string, unknown>;
  /** The signing wallet address; the server acts as the address the signature recovers to. */
  actor: string;
  /** Canonical ISO timestamp (`Date#toISOString`) the message was signed at. */
  issuedAt: string;
  signature: `0x${string}`;
}

/** `POST /api/organization` success: the service's result and the actor's refreshed view. */
export interface OrganizationActionResponse extends OrganizationControlState {
  action: OrganizationAction;
  result: unknown;
}

export interface OrganizationErrorResponse {
  error: string;
  message: string;
}
