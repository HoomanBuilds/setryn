import { contractBindings } from "@setryn/internal-contracts";
import type { Address, Bytes32, JsonObject } from "@setryn/internal-schemas";

import type { ContractReadDescriptor, ContractReadTransport, ContractViewSource } from "./ports.ts";
import type { ApplicationViewQuery, Provenance } from "./types.ts";

export interface GeneratedContractViewConfig {
  readonly chainId: number;
  readonly addresses: Readonly<Record<string, Address>>;
  readonly reads: readonly ContractReadDescriptor[];
  readonly deploymentId?: Bytes32;
  readonly observedAt: () => string;
  readonly head: () => Promise<{ readonly number: bigint; readonly hash: Bytes32 }>;
}

export class GeneratedBindingContractViewSource implements ContractViewSource {
  readonly #transport: ContractReadTransport;
  readonly #config: GeneratedContractViewConfig;

  constructor(transport: ContractReadTransport, config: GeneratedContractViewConfig) {
    this.#transport = transport;
    this.#config = config;
  }

  async loadContractSnapshot(_query: ApplicationViewQuery) {
    const head = await this.#config.head();
    const entries = await Promise.all(this.#config.reads.map(async (read) => {
      const binding = contractBindings[read.contractName as keyof typeof contractBindings];
      const address = this.#config.addresses[read.contractName];
      if (!binding || !address) throw new Error(`Missing internal binding or address for ${read.contractName}`);
      const value = await this.#transport.read({
        chainId: this.#config.chainId,
        blockNumber: head.number,
        address,
        abi: binding.abi,
        functionName: read.functionName,
        args: read.args,
      });
      return [read.key, read.map(value)] as const;
    }));
    const observedAt = this.#config.observedAt();
    const provenance: Provenance[] = this.#config.reads.map((read) => ({
      kind: "contract-read",
      source: `${read.contractName}.${read.functionName}`,
      chainId: this.#config.chainId,
      blockNumber: head.number,
      blockHash: head.hash,
      observedAt,
    }));
    return {
      snapshot: {
        deploymentId: this.#config.deploymentId ?? null,
        values: Object.fromEntries(entries) as Readonly<Record<string, JsonObject>>,
      },
      provenance,
    };
  }
}
