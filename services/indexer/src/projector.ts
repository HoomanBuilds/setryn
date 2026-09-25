import { contractBindings } from "@setryn/internal-contracts";
import type { CanonicalBlock } from "@setryn/internal-schemas";

import { applyEvent } from "./reducer.ts";
import type { ProjectionStore } from "./store.ts";

export class SetrynProjector {
  readonly #store: ProjectionStore;

  constructor(store: ProjectionStore) {
    this.#store = store;
  }

  ingest(block: CanonicalBlock): "applied" | "duplicate" {
    const head = this.#store.head();
    if (head?.hash === block.hash) {
      return "duplicate";
    }
    if (head && head.chainId !== block.chainId) {
      throw new Error(`Projector cannot mix chain ${head.chainId} with chain ${block.chainId}`);
    }
    if (head && head.hash !== block.parentHash) {
      this.#store.rollbackTo(block.parentHash);
    }
    const canonicalParent = this.#store.head();
    if (canonicalParent && block.number !== canonicalParent.number + 1n) {
      throw new Error(`Non-contiguous block ${block.number} after ${canonicalParent.number}`);
    }
    const orderedEvents = [...block.events].sort((left, right) => {
      if (left.log.transactionIndex !== right.log.transactionIndex) {
        return left.log.transactionIndex - right.log.transactionIndex;
      }
      return left.log.logIndex - right.log.logIndex;
    });
    this.#store.apply(block, (state) => {
      for (const event of orderedEvents) {
        applyEvent(state, event);
      }
    });
    return "applied";
  }
}

export function assertBindingsReady(): void {
  const required = [
    "AssetRegistry",
    "AdapterRegistry",
    "InstrumentRegistry",
    "MarketRegistry",
    "SeriesRegistry",
    "PackageRegistry",
    "CollateralVault",
    "PositionEngine",
    "FixingEngine",
    "FundedFeeEngine",
    "PortfolioRiskEngine",
    "CashSettlementCoordinator",
    "PrivacyCommitmentRegistry",
    "OperationalAdapterExecutor",
  ];
  for (const contractName of required) {
    if (!(contractName in contractBindings)) {
      throw new Error(`Missing generated internal binding for ${contractName}`);
    }
  }
}
