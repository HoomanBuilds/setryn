import type { OperatorExecutionPorts } from "../ports.ts";
import { OperatorChainClient, resolveOperatorChainConfig } from "./chain.ts";
import { ChainKeeperExecutionPort } from "./keeper.ts";
import { ChainMakerQuoteExecutionPort } from "./maker.ts";
import { ChainOracleRelayExecutionPort } from "./oracle.ts";
import { SeriesCatalog } from "./series.ts";
import { ChainSolverExecutionPort } from "./solver.ts";
import type { StrictEnvironmentWritePolicy } from "../policy.ts";
import type { OperatorEnvironment } from "../types.ts";

export * from "./book.ts";
export * from "./chain.ts";
export * from "./deployment.ts";
export * from "./errors.ts";
export * from "./keeper.ts";
export * from "./maker.ts";
export * from "./oracle.ts";
export * from "./payload.ts";
export * from "./protocol.ts";
export * from "./results.ts";
export * from "./series.ts";
export * from "./solver.ts";

export interface ChainExecutionPorts extends Required<OperatorExecutionPorts> {
  readonly client: OperatorChainClient;
}

/** All four concrete ports bound to one chain client, sharing one series catalog. */
export function createChainExecutionPorts(
  client: OperatorChainClient,
  options: { readonly accountFundingMinor?: bigint | null } = {},
): ChainExecutionPorts {
  const catalog = new SeriesCatalog(client);
  return {
    client,
    maker: new ChainMakerQuoteExecutionPort(client, options),
    solver: new ChainSolverExecutionPort(client, options),
    keeper: new ChainKeeperExecutionPort(client, catalog),
    oracle: new ChainOracleRelayExecutionPort(client, catalog),
  };
}

/** Resolves configuration for a writable environment, loads its deployment, and builds the ports. */
export async function createEnvironmentExecutionPorts(
  environment: OperatorEnvironment,
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly policy?: StrictEnvironmentWritePolicy;
    readonly accountFundingMinor?: bigint | null;
  } = {},
): Promise<ChainExecutionPorts> {
  const client = await OperatorChainClient.create(resolveOperatorChainConfig(environment, options.env), { policy: options.policy });
  return createChainExecutionPorts(client, { accountFundingMinor: options.accountFundingMinor });
}
