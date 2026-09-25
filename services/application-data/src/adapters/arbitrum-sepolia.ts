import type {
  ApplicationDataAdapter,
  ChainStatusSource,
  ContractViewSource,
  IndexedViewSource,
  MarketSnapshotSource,
} from "../ports.ts";
import type { ApplicationViewQuery } from "../types.ts";

export const arbitrumSepoliaChainId = 421614;

export class ArbitrumSepoliaApplicationAdapter implements ApplicationDataAdapter {
  readonly environment = "arbitrum-sepolia" as const;
  readonly #chain: ChainStatusSource;
  readonly #contracts: ContractViewSource;
  readonly #indexer: IndexedViewSource;
  readonly #markets: MarketSnapshotSource;

  constructor(sources: {
    readonly chain: ChainStatusSource;
    readonly contracts: ContractViewSource;
    readonly indexer: IndexedViewSource;
    readonly markets: MarketSnapshotSource;
  }) {
    this.#chain = sources.chain;
    this.#contracts = sources.contracts;
    this.#indexer = sources.indexer;
    this.#markets = sources.markets;
  }

  async load(query: ApplicationViewQuery) {
    if (query.environment !== this.environment) throw new Error("Arbitrum Sepolia adapter received the wrong environment");
    const [chain, contracts, indexed, markets] = await Promise.all([
      this.#chain.loadStatus(),
      this.#contracts.loadContractSnapshot(query),
      this.#indexer.loadIndexedView(query.accountId),
      this.#markets.loadMarketSnapshots(query.marketIds),
    ]);
    if (chain.status.chainId !== arbitrumSepoliaChainId || chain.status.environment !== this.environment) {
      throw new Error("Arbitrum Sepolia application adapter received the wrong chain");
    }
    return {
      status: chain.status,
      contracts: contracts.snapshot,
      markets: markets.markets,
      indexed,
      provenance: [chain.provenance, ...contracts.provenance, ...markets.provenance],
    };
  }
}
