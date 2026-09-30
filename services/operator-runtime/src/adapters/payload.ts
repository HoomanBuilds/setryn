import type { JsonObject, JsonValue } from "@setryn/internal-schemas";
import type { Hex } from "viem";

import { OperatorExecutionError } from "./errors.ts";

const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/;

/** Strict readers for intent payload fields; every failure names the field so a rejected job explains itself. */
export class PayloadReader {
  readonly #value: JsonObject;
  readonly #path: string;

  constructor(value: JsonObject, path: string) {
    this.#value = value;
    this.#path = path;
  }

  has(key: string): boolean {
    return this.#value[key] !== undefined && this.#value[key] !== null;
  }

  string(key: string): string;
  string(key: string, fallback: string): string;
  string(key: string, fallback?: string): string {
    const value = this.#value[key];
    if (value === undefined || value === null) return this.#fallback(key, fallback);
    if (typeof value !== "string" || value.trim().length === 0) throw this.#invalid(key, "must be a non-empty string");
    return value;
  }

  bytes32(key: string): Hex;
  bytes32(key: string, fallback: Hex): Hex;
  bytes32(key: string, fallback?: Hex): Hex {
    const value = this.#value[key];
    if (value === undefined || value === null) return this.#fallback(key, fallback);
    if (typeof value !== "string" || !bytes32Pattern.test(value)) throw this.#invalid(key, "must be a 32-byte hex value");
    return value.toLowerCase() as Hex;
  }

  hex(key: string, fallback: Hex): Hex {
    const value = this.#value[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "string" || !hexPattern.test(value)) throw this.#invalid(key, "must be even-length hex");
    return value.toLowerCase() as Hex;
  }

  /** Integers arrive as JSON numbers or decimal strings so values above 2^53 survive transport. */
  bigint(key: string, options: { readonly fallback?: bigint; readonly min?: bigint; readonly max?: bigint } = {}): bigint {
    const value = this.#value[key];
    if (value === undefined || value === null) return this.#fallback(key, options.fallback);
    let parsed: bigint;
    if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
    else if (typeof value === "string" && /^-?\d+$/.test(value)) parsed = BigInt(value);
    else throw this.#invalid(key, "must be an integer or a decimal integer string");
    if (options.min !== undefined && parsed < options.min) throw this.#invalid(key, `must be at least ${options.min}`);
    if (options.max !== undefined && parsed > options.max) throw this.#invalid(key, `must be at most ${options.max}`);
    return parsed;
  }

  integer(key: string, options: { readonly fallback?: number; readonly min?: number; readonly max?: number } = {}): number {
    const value = this.#value[key];
    if (value === undefined || value === null) return this.#fallback(key, options.fallback);
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw this.#invalid(key, "must be a safe integer");
    if (options.min !== undefined && value < options.min) throw this.#invalid(key, `must be at least ${options.min}`);
    if (options.max !== undefined && value > options.max) throw this.#invalid(key, `must be at most ${options.max}`);
    return value;
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.#value[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "boolean") throw this.#invalid(key, "must be a boolean");
    return value;
  }

  bytes32List(key: string, fallback: readonly Hex[] = []): Hex[] {
    const value = this.#value[key];
    if (value === undefined || value === null) return [...fallback];
    if (!Array.isArray(value)) throw this.#invalid(key, "must be an array of 32-byte hex values");
    return value.map((item, index) => {
      if (typeof item !== "string" || !bytes32Pattern.test(item)) throw this.#invalid(`${key}[${index}]`, "must be a 32-byte hex value");
      return item.toLowerCase() as Hex;
    });
  }

  strings(key: string): string[] {
    const value = this.#value[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw this.#invalid(key, "must be an array of strings");
    return value.map((item, index) => {
      if (typeof item !== "string" || item.trim().length === 0) throw this.#invalid(`${key}[${index}]`, "must be a non-empty string");
      return item;
    });
  }

  objects(key: string): PayloadReader[] {
    const value = this.#value[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw this.#invalid(key, "must be an array of objects");
    return value.map((item, index) => {
      if (!isObject(item)) throw this.#invalid(`${key}[${index}]`, "must be an object");
      return new PayloadReader(item, `${this.#path}.${key}[${index}]`);
    });
  }

  oneOf<const T extends string>(key: string, allowed: readonly T[], fallback?: T): T {
    const value = this.string(key, fallback as string);
    if (!allowed.includes(value as T)) throw this.#invalid(key, `must be one of ${allowed.join(", ")}`);
    return value as T;
  }

  #fallback<T>(key: string, fallback: T | undefined): T {
    if (fallback === undefined) throw this.#invalid(key, "is required");
    return fallback;
  }

  #invalid(key: string, message: string): OperatorExecutionError {
    return new OperatorExecutionError("invalid-payload", `${this.#path}.${key} ${message}`);
  }
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
