import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Abi,
  type Address,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type TypedData,
  type TypedDataDefinition,
  type WalletClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { StrictEnvironmentWritePolicy } from "../policy.ts";
import type { OperatorEnvironment } from "../types.ts";
import { loadOperatorDeployment, type OperatorDeployment } from "./deployment.ts";
import { describeChainError, OperatorExecutionError } from "./errors.ts";

export type WritableOperatorEnvironment = Exclude<OperatorEnvironment, "arbitrum-one">;

/** The only chain each writable environment may ever observe. Anything else, Arbitrum One included, is refused. */
export const operatorChainIds: Readonly<Record<WritableOperatorEnvironment, number>> = {
  local: 31337,
  "arbitrum-sepolia": 421614,
};

export const arbitrumOneChainId = 42161;

/** Anvil's published development mnemonic; the local bootstrap assigns roles to its accounts in order. */
export const anvilDevelopmentMnemonic = "test test test test test test test test test test test junk";
const anvilAccountSearchDepth = 10;

export type OperatorSignerSource =
  | { readonly kind: "anvil-development"; readonly addressIndex?: number }
  | { readonly kind: "private-key"; readonly privateKey: Hex };

export interface OperatorChainConfig {
  readonly environment: WritableOperatorEnvironment;
  readonly expectedChainId: number;
  readonly rpcUrl: string;
  readonly runtimePath: string;
  readonly manifestPath: string;
  readonly signer: OperatorSignerSource;
}

export interface OperatorTransaction {
  readonly label: string;
  readonly hash: Hex;
  readonly blockNumber: string;
  readonly gasUsed: string;
}

export interface OperatorWriteResult extends OperatorTransaction {
  readonly receipt: TransactionReceipt;
}

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Resolves chain configuration for a writable environment. Local defaults to the devnet the reset script deploys;
 * Arbitrum Sepolia takes every value from explicit variables and has no defaults, so it cannot be reached by accident.
 */
export function resolveOperatorChainConfig(
  environment: OperatorEnvironment,
  env: Readonly<Record<string, string | undefined>> = process.env,
): OperatorChainConfig {
  if (environment === "arbitrum-one") {
    throw new OperatorExecutionError("policy-refused", "Arbitrum One is read-only; operator execution cannot be configured for it");
  }
  if (environment === "local") {
    return {
      environment,
      expectedChainId: operatorChainIds.local,
      rpcUrl: loopbackRpcUrl(env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545"),
      runtimePath: resolve(env.SETRYN_RUNTIME_PATH ?? resolve(repositoryRoot, "deployments/local/runtime.json")),
      manifestPath: resolve(env.SETRYN_LOCAL_MANIFEST_PATH ?? resolve(repositoryRoot, "deployments/local/manifest.json")),
      signer: { kind: "anvil-development" },
    };
  }
  const rpcUrl = requiredVariable(env, "SETRYN_SEPOLIA_RPC_URL");
  const parsed = new URL(rpcUrl);
  if (parsed.protocol !== "https:") throw new OperatorExecutionError("config-invalid", "SETRYN_SEPOLIA_RPC_URL must be an https URL");
  const privateKey = requiredVariable(env, "SETRYN_SEPOLIA_OPERATOR_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new OperatorExecutionError("config-invalid", "SETRYN_SEPOLIA_OPERATOR_KEY must be a 32-byte 0x-prefixed private key");
  }
  return {
    environment,
    expectedChainId: operatorChainIds["arbitrum-sepolia"],
    rpcUrl,
    runtimePath: resolve(requiredVariable(env, "SETRYN_SEPOLIA_RUNTIME_PATH")),
    manifestPath: resolve(requiredVariable(env, "SETRYN_SEPOLIA_MANIFEST_PATH")),
    signer: { kind: "private-key", privateKey: privateKey as Hex },
  };
}

/**
 * The single write path for every operator port. Each signature and transaction first passes the strict environment
 * write policy and then an observed chain-id check, so a misconfigured RPC can never be signed against.
 */
export class OperatorChainClient {
  readonly environment: WritableOperatorEnvironment;
  readonly deployment: OperatorDeployment;
  readonly public: PublicClient<Transport, Chain>;
  readonly #account: LocalAccount;
  readonly #wallet: WalletClient<Transport, Chain, LocalAccount>;
  readonly #policy: StrictEnvironmentWritePolicy;
  readonly #config: OperatorChainConfig;

  private constructor(options: {
    readonly config: OperatorChainConfig;
    readonly deployment: OperatorDeployment;
    readonly account: LocalAccount;
    readonly policy: StrictEnvironmentWritePolicy;
  }) {
    const { config } = options;
    const chain = defineChain({
      id: config.expectedChainId,
      name: config.environment === "local" ? "Setryn local devnet" : "Arbitrum Sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    });
    this.environment = config.environment;
    this.deployment = options.deployment;
    this.#account = options.account;
    this.#policy = options.policy;
    this.#config = config;
    this.public = createPublicClient({ chain, transport: http(config.rpcUrl, { retryCount: 1 }) });
    this.#wallet = createWalletClient({ account: options.account, chain, transport: http(config.rpcUrl, { retryCount: 0 }) });
  }

  static async create(
    config: OperatorChainConfig,
    options: { readonly policy?: StrictEnvironmentWritePolicy } = {},
  ): Promise<OperatorChainClient> {
    assertEnvironmentChain(config.environment, config.expectedChainId);
    const deployment = await loadOperatorDeployment({
      runtimePath: config.runtimePath,
      manifestPath: config.manifestPath,
      expectedChainId: config.expectedChainId,
    });
    const account = resolveSigner(config, deployment);
    return new OperatorChainClient({ config, deployment, account, policy: options.policy ?? new StrictEnvironmentWritePolicy() });
  }

  /** A client for another signer on the same chain and deployment, used by local participants such as smoke takers. */
  withSigner(signer: OperatorSignerSource): OperatorChainClient {
    const config: OperatorChainConfig = { ...this.#config, signer };
    return new OperatorChainClient({
      config,
      deployment: this.deployment,
      account: resolveSigner(config, this.deployment),
      policy: this.#policy,
    });
  }

  get address(): Address {
    return this.#account.address;
  }

  get expectedChainId(): number {
    return this.#config.expectedChainId;
  }

  isDeploymentOperator(): boolean {
    return this.#account.address === this.deployment.operator;
  }

  /** Refuses before any signature unless the policy allows the environment and the RPC reports the expected chain. */
  async assertWritable(action: string): Promise<void> {
    const decision = this.#policy.assess(this.environment);
    if (!decision.allowed) throw new OperatorExecutionError("policy-refused", `${action}: ${decision.reason ?? "writes disabled"}`);
    let observed: number;
    try {
      observed = await this.public.getChainId();
    } catch (error) {
      throw describeChainError(error, `${action} chain-id check`);
    }
    if (observed === arbitrumOneChainId) {
      throw new OperatorExecutionError("chain-mismatch", `${action}: RPC reports Arbitrum One (${observed}); mainnet writes are refused`);
    }
    if (observed !== this.#config.expectedChainId) {
      throw new OperatorExecutionError(
        "chain-mismatch",
        `${action}: ${this.environment} requires chain ${this.#config.expectedChainId} but the RPC reports ${observed}`,
      );
    }
  }

  /** Chain time as the next block will see it. Anvil automine leaves the latest block stale, so deadlines use this. */
  async chainNow(): Promise<bigint> {
    try {
      const block = await this.public.getBlock({ blockTag: "pending" });
      return block.timestamp;
    } catch (error) {
      throw describeChainError(error, "read pending block");
    }
  }

  async read<T>(action: string, call: (client: PublicClient<Transport, Chain>) => Promise<T>): Promise<T> {
    try {
      return await call(this.public);
    } catch (error) {
      throw describeChainError(error, action);
    }
  }

  /** Simulates first so reverts decode to a named contract error, then sends and waits for a successful receipt. */
  async write<
    const abi extends Abi,
    functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
    const args extends ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>,
  >(
    label: string,
    parameters: { readonly address: Address; readonly abi: abi; readonly functionName: functionName; readonly args: args },
  ): Promise<OperatorWriteResult> {
    await this.assertWritable(label);
    const call = { ...parameters, account: this.#account } as never;
    let hash: Hex;
    try {
      // Simulate on the pending block: its timestamp is the one the transaction will execute under.
      await this.public.simulateContract({ ...parameters, account: this.#account, blockTag: "pending" } as never);
      hash = await this.#wallet.writeContract(call);
    } catch (error) {
      throw describeChainError(error, label);
    }
    let receipt: TransactionReceipt;
    try {
      receipt = await this.public.waitForTransactionReceipt({ hash });
    } catch (error) {
      throw describeChainError(error, `${label} receipt ${hash}`);
    }
    if (receipt.status !== "success") {
      throw new OperatorExecutionError("transaction-reverted", `${label} transaction ${hash} reverted onchain`, {
        details: { transactionHash: hash, blockNumber: receipt.blockNumber.toString() },
      });
    }
    return {
      label,
      hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      receipt,
    };
  }

  /** Dry-runs a write without the guard; used to decide whether permissionless work is currently due. */
  async simulate<
    const abi extends Abi,
    functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
    const args extends ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>,
  >(
    label: string,
    parameters: { readonly address: Address; readonly abi: abi; readonly functionName: functionName; readonly args: args },
  ): Promise<void> {
    try {
      await this.public.simulateContract({ ...parameters, account: this.#account, blockTag: "pending" } as never);
    } catch (error) {
      throw describeChainError(error, label);
    }
  }

  async signTypedData<
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
  >(label: string, parameters: TypedDataDefinition<typedData, primaryType>): Promise<Hex> {
    await this.assertWritable(label);
    try {
      return await this.#account.signTypedData(parameters);
    } catch (error) {
      throw describeChainError(error, label);
    }
  }
}

export function transactionSummary(result: OperatorWriteResult): OperatorTransaction {
  return { label: result.label, hash: result.hash, blockNumber: result.blockNumber, gasUsed: result.gasUsed };
}

function assertEnvironmentChain(environment: OperatorEnvironment, chainId: number): void {
  if (environment === "arbitrum-one" || chainId === arbitrumOneChainId) {
    throw new OperatorExecutionError("policy-refused", "Arbitrum One is read-only for the operator runtime");
  }
  if (operatorChainIds[environment] !== chainId) {
    throw new OperatorExecutionError("chain-mismatch", `${environment} must target chain ${operatorChainIds[environment]}, not ${chainId}`);
  }
}

function resolveSigner(config: OperatorChainConfig, deployment: OperatorDeployment): LocalAccount {
  if (config.signer.kind === "private-key") {
    if (config.environment === "local") {
      throw new OperatorExecutionError("config-invalid", "local signers come from the anvil development accounts");
    }
    return privateKeyToAccount(config.signer.privateKey);
  }
  if (config.environment !== "local" || config.expectedChainId !== operatorChainIds.local) {
    throw new OperatorExecutionError("config-invalid", "anvil development keys are only valid on the local devnet");
  }
  if (config.signer.addressIndex !== undefined) {
    return mnemonicToAccount(anvilDevelopmentMnemonic, { addressIndex: config.signer.addressIndex });
  }
  for (let addressIndex = 0; addressIndex < anvilAccountSearchDepth; addressIndex += 1) {
    const account = mnemonicToAccount(anvilDevelopmentMnemonic, { addressIndex });
    if (getAddress(account.address) === deployment.operator) return account;
  }
  throw new OperatorExecutionError(
    "config-invalid",
    `runtime operator ${deployment.operator} is not one of the first ${anvilAccountSearchDepth} anvil development accounts`,
  );
}

function requiredVariable(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new OperatorExecutionError("config-invalid", `${name} is required for arbitrum-sepolia operator execution`);
  return value;
}

function loopbackRpcUrl(rpcUrl: string): string {
  const parsed = new URL(rpcUrl);
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (parsed.protocol !== "http:" || !loopback.has(parsed.hostname)) {
    throw new OperatorExecutionError("config-invalid", "LOCAL_RPC_URL must be an http loopback URL");
  }
  return rpcUrl;
}
