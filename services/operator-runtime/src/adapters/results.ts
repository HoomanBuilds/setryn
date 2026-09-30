import type { JsonObject, JsonValue } from "@setryn/internal-schemas";

import type { OperatorEnvironment, OperatorExecutionContext, OperatorExecutionResult } from "../types.ts";
import type { OperatorChainClient, OperatorTransaction } from "./chain.ts";
import { jsonSafe, OperatorExecutionError } from "./errors.ts";

/** A port only executes intents for the environment its client is bound to. */
export function assertIntentEnvironment(
  client: OperatorChainClient,
  environment: OperatorEnvironment,
  context: OperatorExecutionContext,
): void {
  if (environment !== client.environment || context.environment !== client.environment) {
    throw new OperatorExecutionError(
      "policy-refused",
      `intent for ${environment} (context ${context.environment}) cannot run on the ${client.environment} execution port`,
    );
  }
}

export function transactionHashes(transactions: readonly OperatorTransaction[]): JsonValue[] {
  return transactions.map((transaction) => ({ label: transaction.label, hash: transaction.hash, blockNumber: transaction.blockNumber }));
}

/** Results carry every transaction hash in order; the runtime stores the details verbatim as job evidence. */
export function completed(details: Record<string, unknown>, transactions: readonly OperatorTransaction[]): OperatorExecutionResult {
  return {
    state: "completed",
    details: {
      ...(jsonSafe(details) as JsonObject),
      transactionCount: transactions.length,
      transactions: transactionHashes(transactions),
    },
  };
}
