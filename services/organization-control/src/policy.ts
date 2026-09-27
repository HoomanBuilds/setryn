import { parseScaledAmount } from "./accounting.ts";
import {
  ACTION_KINDS,
  ORGANIZATION_ROLES,
  ROUTE_CLASSES,
  SETTLEMENT_CLASSES,
  TERMINAL_ACTION_KINDS,
  assertBytes32,
  assertIsoTimestamp,
  assertNonEmpty,
  isBytes32,
  type MemberStatus,
  type MonetaryAmount,
  type PolicyActionRequest,
  type PolicyConstraints,
  type PolicyDecision,
  type PolicyVersion,
  type RouteClass,
  type ScopeAllowlist,
  type SettlementClass,
  type StrategyAccountStatus,
} from "./types.ts";

export interface PolicyEvaluationContext {
  readonly actorStatus: MemberStatus | null;
  readonly accountRegistered: boolean;
  readonly accountStatus: StrategyAccountStatus | null;
}

export function validateConstraints(constraints: PolicyConstraints): void {
  assertScope(constraints.accounts, "accounts");
  assertScope(constraints.markets, "markets");
  assertScope(constraints.riskDomains, "riskDomains");
  assertScope(constraints.routes, "routes");
  assertScope(constraints.settlement, "settlement");
  for (const value of constraints.accounts.values) assertBytes32(value, "policy account");
  for (const value of constraints.markets.values) assertBytes32(value, "policy market");
  for (const value of constraints.riskDomains.values) assertBytes32(value, "policy risk domain");
  for (const value of constraints.routes.values) {
    if (!(ROUTE_CLASSES as readonly string[]).includes(value)) throw new TypeError(`policy route ${value} is unsupported`);
  }
  for (const value of constraints.settlement.values) {
    if (!(SETTLEMENT_CLASSES as readonly string[]).includes(value)) {
      throw new TypeError(`policy settlement class ${value} is unsupported`);
    }
  }
  if (
    !Number.isSafeInteger(constraints.requiredApprovers) ||
    constraints.requiredApprovers < 1 ||
    constraints.requiredApprovers > 8
  ) {
    throw new RangeError("requiredApprovers must be a safe integer from 1 to 8");
  }
  if (!(ORGANIZATION_ROLES as readonly string[]).includes(constraints.approverRole) || constraints.approverRole === "viewer") {
    throw new TypeError("approverRole must be an accountable organization role");
  }
  assertAmountOrNull(constraints.maxNotional, "maxNotional");
  assertAmountOrNull(constraints.minCollateral, "minCollateral");
  assertAmountOrNull(constraints.dualControlThreshold, "dualControlThreshold");
  if (constraints.validFrom !== null) assertIsoTimestamp(constraints.validFrom, "validFrom");
  if (constraints.validUntil !== null) assertIsoTimestamp(constraints.validUntil, "validUntil");
  if (
    constraints.validFrom !== null &&
    constraints.validUntil !== null &&
    Date.parse(constraints.validFrom) >= Date.parse(constraints.validUntil)
  ) {
    throw new RangeError("validFrom must be earlier than validUntil");
  }
}

export function evaluatePolicyAction(
  policy: PolicyVersion,
  request: PolicyActionRequest,
  context: PolicyEvaluationContext,
): PolicyDecision {
  const explanations: string[] = [];
  const terminal = request.riskClass === "terminal-resolution";
  if (request.organizationId !== policy.organizationId) {
    return deny(policy, explanations, "request targets a different organization than the policy version");
  }
  if (!isBytes32(request.actionPayloadHash)) {
    return deny(policy, explanations, "action payload hash must be a 32-byte value");
  }
  if (!Number.isFinite(Date.parse(request.requestedAt))) {
    return deny(policy, explanations, "requestedAt must be an ISO timestamp");
  }
  if (!(ROUTE_CLASSES as readonly string[]).includes(request.routeClass)) {
    return deny(policy, explanations, `unsupported route class ${request.routeClass}`);
  }
  if (!(SETTLEMENT_CLASSES as readonly string[]).includes(request.settlementClass)) {
    return deny(policy, explanations, `unsupported settlement class ${request.settlementClass}`);
  }
  const allowedKinds = terminal ? TERMINAL_ACTION_KINDS : ACTION_KINDS;
  if (!allowedKinds.includes(request.actionKind)) {
    return deny(policy, explanations, `unsupported action kind ${request.actionKind} for ${request.riskClass}`);
  }
  explanations.push(`action kind ${request.actionKind} is supported for ${request.riskClass}`);
  let notional: bigint;
  try {
    assertNonEmpty(request.notional.currency, "notional.currency");
    notional = parseScaledAmount(request.notional.amount);
  } catch {
    return deny(policy, explanations, "notional must be a positive amount with a currency");
  }
  if (request.collateral !== null) {
    try {
      assertNonEmpty(request.collateral.currency, "collateral.currency");
      parseScaledAmount(request.collateral.amount);
    } catch {
      return deny(policy, explanations, "collateral must be a positive amount with a currency");
    }
  }
  if (!terminal) {
    const scopeDenial =
      scopeDenialFor(policy.constraints.accounts, request.accountId, "account") ??
      scopeDenialFor(policy.constraints.markets, request.marketId, "market") ??
      scopeDenialFor(policy.constraints.riskDomains, request.riskDomainId, "risk domain") ??
      scopeDenialFor(policy.constraints.routes, request.routeClass as RouteClass, "route") ??
      scopeDenialFor(policy.constraints.settlement, request.settlementClass as SettlementClass, "settlement");
    if (scopeDenial !== null) return deny(policy, explanations, scopeDenial);
    explanations.push("request matches all policy scopes");
  } else {
    explanations.push("terminal-resolution bypasses scope allowlists and follows committed state");
  }
  if (!terminal && policy.constraints.maxNotional !== null) {
    const limit = policy.constraints.maxNotional;
    if (limit.currency !== request.notional.currency) {
      return deny(policy, explanations, "notional currency does not match the policy limit currency");
    }
    if (notional > parseScaledAmount(limit.amount)) {
      return deny(policy, explanations, `notional exceeds the policy maximum of ${limit.amount} ${limit.currency}`);
    }
    explanations.push(`notional is within the policy maximum of ${limit.amount} ${limit.currency}`);
  }
  if (!terminal && policy.constraints.minCollateral !== null) {
    const minimum = policy.constraints.minCollateral;
    if (
      request.collateral === null ||
      request.collateral.currency !== minimum.currency ||
      parseScaledAmount(request.collateral.amount) < parseScaledAmount(minimum.amount)
    ) {
      return deny(policy, explanations, `collateral is below the policy minimum of ${minimum.amount} ${minimum.currency}`);
    }
    explanations.push(`collateral meets the policy minimum of ${minimum.amount} ${minimum.currency}`);
  }
  if (!terminal) {
    const requestedAt = Date.parse(request.requestedAt);
    if (policy.constraints.validFrom !== null && requestedAt < Date.parse(policy.constraints.validFrom)) {
      return deny(policy, explanations, "request predates the policy validity window");
    }
    if (policy.constraints.validUntil !== null && requestedAt > Date.parse(policy.constraints.validUntil)) {
      return deny(policy, explanations, "request is past the policy validity window");
    }
    explanations.push("request is within the policy validity window");
  }
  if (!terminal && context.actorStatus !== "active") {
    return deny(policy, explanations, "actor is not an active organization member");
  }
  if (!context.accountRegistered) {
    return deny(policy, explanations, "strategy account is not registered to this organization");
  }
  if (!terminal && context.accountStatus !== "active") {
    return deny(policy, explanations, `strategy account is ${context.accountStatus ?? "unknown"}`);
  }
  if (terminal) {
    explanations.push("terminal-resolution completes without approval on the permissionless path");
    return {
      allowed: true,
      reason: null,
      policyVersion: policy.version,
      requiredApprovers: 0,
      approverRole: policy.constraints.approverRole,
      explanations,
    };
  }
  let requiredApprovers = policy.constraints.requiredApprovers;
  if (policy.constraints.dualControlThreshold !== null) {
    const threshold = policy.constraints.dualControlThreshold;
    if (threshold.currency !== request.notional.currency) {
      return deny(policy, explanations, "notional currency does not match the dual-control threshold currency");
    }
    if (notional >= parseScaledAmount(threshold.amount)) {
      requiredApprovers = Math.max(requiredApprovers, 2);
      explanations.push(`notional reaches the dual-control threshold of ${threshold.amount} ${threshold.currency}`);
    }
  }
  explanations.push(`requires ${requiredApprovers} approver(s) with role ${policy.constraints.approverRole}`);
  return {
    allowed: true,
    reason: null,
    policyVersion: policy.version,
    requiredApprovers,
    approverRole: policy.constraints.approverRole,
    explanations,
  };
}

function deny(policy: PolicyVersion, explanations: readonly string[], reason: string): PolicyDecision {
  return {
    allowed: false,
    reason,
    policyVersion: policy.version,
    requiredApprovers: 0,
    approverRole: policy.constraints.approverRole,
    explanations: [...explanations, reason],
  };
}

function scopeDenialFor<T>(scope: ScopeAllowlist<T>, value: T, label: string): string | null {
  if (scope.mode === "any") return null;
  if (scope.values.includes(value)) return null;
  return `${label} is outside the policy allowlist`;
}

function assertScope<T>(scope: ScopeAllowlist<T>, label: string): void {
  if (scope.mode !== "any" && scope.mode !== "list") throw new TypeError(`${label} scope mode is unsupported`);
  if (scope.mode === "any" && scope.values.length !== 0) {
    throw new TypeError(`${label} scope allows any value and must not list values`);
  }
  if (scope.mode === "list" && scope.values.length === 0) {
    throw new TypeError(`${label} scope must list at least one value`);
  }
  if (new Set(scope.values).size !== scope.values.length) {
    throw new TypeError(`${label} scope must not contain duplicates`);
  }
}

function assertAmountOrNull(value: MonetaryAmount | null, label: string): void {
  if (value === null) return;
  assertNonEmpty(value.currency, `${label}.currency`);
  parseScaledAmount(value.amount);
}
