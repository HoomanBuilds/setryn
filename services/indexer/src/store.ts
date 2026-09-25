import type { Bytes32, CanonicalBlock } from "@setryn/internal-schemas";

import { emptyProjectionState, type ProjectionState } from "./projection-types.ts";

interface AppliedBlock {
  readonly block: Omit<CanonicalBlock, "events">;
  readonly stateBefore: ProjectionState;
}

export interface ProjectionStore {
  state(): ProjectionState;
  head(): Omit<CanonicalBlock, "events"> | null;
  apply(block: CanonicalBlock, reduce: (state: ProjectionState) => void): void;
  rollbackTo(parentHash: Bytes32): void;
}

export class InMemoryProjectionStore implements ProjectionStore {
  readonly #retention: number;
  #state: ProjectionState;
  #history: AppliedBlock[] = [];

  constructor(retention = 128, initialState = emptyProjectionState()) {
    if (!Number.isSafeInteger(retention) || retention < 1) {
      throw new TypeError("retention must be a positive safe integer");
    }
    this.#retention = retention;
    this.#state = initialState;
  }

  state(): ProjectionState {
    return this.#state;
  }

  head(): Omit<CanonicalBlock, "events"> | null {
    return this.#history.at(-1)?.block ?? null;
  }

  apply(block: CanonicalBlock, reduce: (state: ProjectionState) => void): void {
    const stateBefore = structuredClone(this.#state);
    try {
      reduce(this.#state);
    } catch (error) {
      this.#state = stateBefore;
      throw error;
    }
    this.#history.push({
      block: {
        chainId: block.chainId,
        number: block.number,
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: block.timestamp,
      },
      stateBefore,
    });
    if (this.#history.length > this.#retention) {
      this.#history.shift();
    }
  }

  rollbackTo(parentHash: Bytes32): void {
    const head = this.#history.at(-1);
    if (!head || head.block.hash === parentHash) {
      return;
    }
    let targetIndex = -1;
    for (let index = this.#history.length - 1; index >= 0; index -= 1) {
      if (this.#history[index]?.block.hash === parentHash) {
        targetIndex = index;
        break;
      }
    }
    if (targetIndex === -1 && this.#history[0]?.block.parentHash === parentHash) {
      targetIndex = -1;
    } else if (targetIndex === -1) {
      throw new Error(`Reorg exceeds retained block history at parent ${parentHash}`);
    }
    while (this.#history.length - 1 > targetIndex) {
      const removed = this.#history.pop();
      if (removed) {
        this.#state = removed.stateBefore;
      }
    }
  }
}
