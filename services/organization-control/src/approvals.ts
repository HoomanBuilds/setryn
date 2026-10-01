import {
  assertIsoTimestamp,
  assertNonEmpty,
  type ApprovalDecision,
  type ApprovalProposal,
  type ApprovalStatus,
  type Bytes32,
} from "./types";

const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const SHA256_H: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

export function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("value is not JSON serializable");
}

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function add(...values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum >>> 0;
}

export function sha256Hex(message: string): string {
  const bytes = utf8Bytes(message);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push(
    (high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff,
    (low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff,
  );
  const h = [...SHA256_H];
  const w = new Array<number>(64).fill(0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[offset + i * 4] as number) * 0x1000000 +
          (bytes[offset + i * 4 + 1] as number) * 0x10000 +
          (bytes[offset + i * 4 + 2] as number) * 0x100 +
          (bytes[offset + i * 4 + 3] as number)) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = add(w[i - 16] as number, s0, w[i - 7] as number, s1);
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = add(hh, s1, ch, SHA256_K[i] as number, w[i] as number);
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = add(s0, maj);
      hh = g;
      g = f;
      f = e;
      e = add(d, t1);
      d = c;
      c = b;
      b = a;
      a = add(t1, t2);
    }
    h[0] = add(h[0] as number, a);
    h[1] = add(h[1] as number, b);
    h[2] = add(h[2] as number, c);
    h[3] = add(h[3] as number, d);
    h[4] = add(h[4] as number, e);
    h[5] = add(h[5] as number, f);
    h[6] = add(h[6] as number, g);
    h[7] = add(h[7] as number, hh);
  }
  return h.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

export function canonicalPayloadHash(payload: unknown): Bytes32 {
  return `0x${sha256Hex(stableJson(payload))}` as Bytes32;
}

const NEXT: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
  draft: ["pending", "canceled"],
  pending: ["approved", "rejected", "expired", "canceled"],
  approved: ["executed", "expired", "canceled"],
  rejected: [],
  expired: [],
  executed: [],
  canceled: [],
};

export function approvalExpired(proposal: ApprovalProposal, now: string): boolean {
  assertIsoTimestamp(now, "now");
  return Date.parse(now) > Date.parse(proposal.expiresAt);
}

export function submitForApproval(proposal: ApprovalProposal, now: string): ApprovalProposal {
  assertIsoTimestamp(now, "now");
  if (proposal.status !== "draft") throw new Error(`proposal ${proposal.id} cannot be submitted from ${proposal.status}`);
  if (approvalExpired(proposal, now)) throw new Error(`proposal ${proposal.id} has already expired`);
  return move(proposal, "pending");
}

export function recordApprovalDecision(
  proposal: ApprovalProposal,
  decision: ApprovalDecision,
  now: string,
): ApprovalProposal {
  assertIsoTimestamp(now, "now");
  if (proposal.status !== "pending") throw new Error(`proposal ${proposal.id} is not awaiting decision`);
  if (approvalExpired(proposal, now)) throw new Error(`proposal ${proposal.id} has expired`);
  if (decision.proposalId !== proposal.id) throw new Error("decision targets a different proposal");
  if (decision.choice !== "approve" && decision.choice !== "reject") {
    throw new TypeError(`approval choice ${decision.choice} is unsupported`);
  }
  assertNonEmpty(decision.approver, "approver");
  assertIsoTimestamp(decision.decidedAt, "decidedAt");
  if (proposal.decisions.some((existing) => existing.approver === decision.approver)) {
    throw new Error(`approver ${decision.approver} has already decided on ${proposal.id}`);
  }
  const decisions = [...proposal.decisions, { ...decision }].sort(
    (a, b) => a.decidedAt.localeCompare(b.decidedAt) || a.approver.localeCompare(b.approver),
  );
  if (decision.choice === "reject") {
    return { ...move(proposal, "rejected"), decisions, decidedAt: now };
  }
  const approvals = new Set(
    decisions
      .filter((entry) => entry.choice === "approve" && entry.approver !== proposal.createdBy)
      .map((entry) => entry.approver),
  );
  if (approvals.size >= proposal.requiredApprovers) {
    return { ...move(proposal, "approved"), decisions, decidedAt: now };
  }
  return { ...proposal, decisions };
}

export function expireApproval(proposal: ApprovalProposal, now: string): ApprovalProposal {
  assertIsoTimestamp(now, "now");
  if (proposal.status !== "pending" && proposal.status !== "approved") {
    throw new Error(`proposal ${proposal.id} cannot expire from ${proposal.status}`);
  }
  if (!approvalExpired(proposal, now)) throw new Error(`proposal ${proposal.id} has not expired`);
  return move(proposal, "expired");
}

export function executeApproval(proposal: ApprovalProposal, reference: string, now: string): ApprovalProposal {
  assertIsoTimestamp(now, "now");
  if (proposal.status !== "approved") throw new Error(`proposal ${proposal.id} cannot execute from ${proposal.status}`);
  if (approvalExpired(proposal, now)) throw new Error(`proposal ${proposal.id} has expired`);
  assertNonEmpty(reference, "executionReference");
  return { ...move(proposal, "executed"), executedAt: now, executionReference: reference };
}

export function cancelApproval(proposal: ApprovalProposal, reason: string, now: string): ApprovalProposal {
  assertIsoTimestamp(now, "now");
  if (proposal.status !== "draft" && proposal.status !== "pending" && proposal.status !== "approved") {
    throw new Error(`proposal ${proposal.id} cannot cancel from ${proposal.status}`);
  }
  assertNonEmpty(reason, "cancelReason");
  return { ...move(proposal, "canceled"), cancelReason: reason };
}

function move(proposal: ApprovalProposal, status: ApprovalStatus): ApprovalProposal {
  if (!NEXT[proposal.status].includes(status)) {
    throw new Error(`proposal ${proposal.id} cannot move from ${proposal.status} to ${status}`);
  }
  return { ...proposal, status };
}
