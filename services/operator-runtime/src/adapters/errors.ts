import { contractBindings } from "@setryn/internal-contracts";
import type { JsonObject, JsonValue } from "@setryn/internal-schemas";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
  type Abi,
  type Hex,
} from "viem";

type AbiError = Extract<Abi[number], { readonly type: "error" }>;

export type OperatorErrorCode =
  | "policy-refused"
  | "chain-mismatch"
  | "config-invalid"
  | "invalid-payload"
  | "precondition"
  | "contract-revert"
  | "transaction-reverted"
  | "rpc-unavailable"
  | "unexpected";

/** A chain failure mapped to a stable code and a readable reason; never a raw viem error. */
export class OperatorExecutionError extends Error {
  readonly code: OperatorErrorCode;
  readonly retryable: boolean;
  readonly details: JsonObject;

  constructor(
    code: OperatorErrorCode,
    message: string,
    options: { readonly retryable?: boolean; readonly details?: JsonObject } = {},
  ) {
    super(`${code}: ${message}`);
    this.name = "OperatorExecutionError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }
}

export interface DecodedRevert {
  readonly errorName: string;
  readonly args: readonly JsonValue[];
}

let combinedErrorAbi: Abi | null = null;

/** Every custom error declared by any generated binding, so reverts bubbled from a callee still decode. */
function protocolErrorAbi(): Abi {
  if (combinedErrorAbi) return combinedErrorAbi;
  const seen = new Set<string>();
  const errors: AbiError[] = [];
  for (const binding of Object.values(contractBindings)) {
    for (const item of binding.abi as readonly { readonly type: string }[]) {
      if (item.type !== "error") continue;
      const error = item as unknown as AbiError;
      const signature = `${error.name}(${error.inputs.map((input) => input.type).join(",")})`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      errors.push(error);
    }
  }
  combinedErrorAbi = errors;
  return combinedErrorAbi;
}

export function decodeRevertData(data: Hex | undefined): DecodedRevert | null {
  if (!data || data === "0x" || data.length < 10) return null;
  try {
    const decoded = decodeErrorResult({ abi: protocolErrorAbi(), data });
    return { errorName: decoded.errorName, args: (decoded.args ?? []).map(jsonSafe) };
  } catch {
    return { errorName: `unknown selector ${data.slice(0, 10)}`, args: [] };
  }
}

/** Maps anything thrown while talking to the chain into an OperatorExecutionError with a clear reason. */
export function describeChainError(error: unknown, action: string): OperatorExecutionError {
  if (error instanceof OperatorExecutionError) return error;
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const decoded = reverted.data?.errorName
        ? { errorName: reverted.data.errorName, args: (reverted.data.args ?? []).map(jsonSafe) }
        : decodeRevertData(reverted.raw);
      const reason = decoded
        ? `${decoded.errorName}(${decoded.args.map((arg) => String(arg)).join(", ")})`
        : reverted.reason ?? "execution reverted without data";
      return new OperatorExecutionError("contract-revert", `${action} reverted: ${reason}`, {
        details: {
          action,
          errorName: decoded?.errorName ?? null,
          errorArgs: decoded ? [...decoded.args] : [],
          reason,
        },
      });
    }
    const transport = error.walk(
      (cause) => cause instanceof HttpRequestError || cause instanceof TimeoutError || cause instanceof RpcRequestError,
    );
    if (transport) {
      return new OperatorExecutionError("rpc-unavailable", `${action} could not reach the RPC endpoint: ${shortMessage(transport)}`, {
        retryable: true,
        details: { action },
      });
    }
    return new OperatorExecutionError("unexpected", `${action} failed: ${error.shortMessage}`, {
      retryable: true,
      details: { action, viemError: error.name },
    });
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return new OperatorExecutionError("invalid-payload", `${action}: ${error.message}`, { details: { action } });
  }
  const message = error instanceof Error && error.message ? error.message : "unknown failure";
  const transportLike = /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(message);
  return new OperatorExecutionError(transportLike ? "rpc-unavailable" : "unexpected", `${action} failed: ${message}`, {
    retryable: true,
    details: { action },
  });
}

export function isContractRevert(error: unknown): error is OperatorExecutionError {
  return error instanceof OperatorExecutionError && error.code === "contract-revert";
}

function shortMessage(error: Error): string {
  return error instanceof BaseError ? error.shortMessage : error.message;
}

export function jsonSafe(value: unknown): JsonValue {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return String(value);
}
