import type { PublicClient } from "viem";

import {
  aggressorSide,
  clearingChannel,
  deploymentKey,
  fillStream,
  marketFeedEventsAbi,
  positionStatusOpen,
  tickRuleSide,
} from "@setryn/market-data";
import { ticksToPrice, type OperatorDeployment } from "@setryn/operator-runtime";
import {
  commitChainBatch,
  readMarketFills,
  readOpenPositions,
  readStreamCursor,
  resetChainStream,
  type MarketFillRecord,
  type MarketPositionRecord,
} from "@setryn/persistence";

/*
 * A deployment's fills and position quantities into setryn.market_fills and setryn.market_positions. The stream starts
 * at the deployment block and applies logs in block ranges up to `confirmations` behind the head; each range's rows and
 * the cursor (last block and its hash) commit together. A cursor whose block is gone or changed means the chain was
 * reset or reorganized below it: the deployment's rows are dropped and replayed from the start, because positions are a
 * projection of every event since the deployment.
 */

const ONE = BigInt(1);

export interface FillPassOptions {
  scope: string;
  /** First block of the stream (deploymentStartBlock); defaults to the deployment's block reference. */
  startBlock?: bigint;
  confirmations: number;
  chunkBlocks: number;
  /** Most block ranges applied in one pass; a longer backlog continues on the next pass. */
  maxChunks: number;
}

export interface FillPassResult {
  deploymentKey: string;
  fromBlock: string | null;
  toBlock: string | null;
  head: string;
  fills: number;
  positions: number;
  reset: boolean;
  caughtUp: boolean;
}

export async function ingestFills(client: PublicClient, deployment: OperatorDeployment, options: FillPassOptions): Promise<FillPassResult> {
  const { addresses } = deployment;
  const clearing = addresses.atomicClearingEngine.toLowerCase();
  const positionEngine = addresses.positionEngine.toLowerCase();
  const key = deploymentKey({
    chainId: deployment.chainId,
    atomicClearingEngine: addresses.atomicClearingEngine,
    positionEngine: addresses.positionEngine,
    publicOrderBook: addresses.publicOrderBook,
  });
  const stream = fillStream(key);
  const scope = options.scope;
  const head = await client.getBlockNumber();
  const confirmations = BigInt(options.confirmations);
  const target = head > confirmations ? head - confirmations : BigInt(0);

  const startBlock = options.startBlock ?? deployment.deploymentBlock;
  let cursor = await readStreamCursor(stream, scope);
  let reset = false;
  // A stream started at another block (the start rule or the runtime changed) is incomplete for this one: replay it.
  if (cursor && String(cursor.payload.startBlock ?? "") !== startBlock.toString()) {
    await resetChainStream({ scope, deploymentKey: key, stream });
    cursor = null;
    reset = true;
  }
  if (cursor && cursor.blockNumber !== null) {
    const at = BigInt(cursor.blockNumber);
    const block = at > head ? null : await client.getBlock({ blockNumber: at }).catch(() => null);
    if (!block || block.hash.toLowerCase() !== cursor.blockHash) {
      await resetChainStream({ scope, deploymentKey: key, stream });
      cursor = null;
      reset = true;
    }
  }

  let from = cursor?.blockNumber !== null && cursor?.blockNumber !== undefined ? BigInt(cursor.blockNumber) + ONE : startBlock;
  const payload = { startBlock: startBlock.toString(), confirmations: options.confirmations, head: head.toString() };
  if (from > target) {
    // Nothing new: the cursor's heartbeat still moves, so a health check can tell a quiet chain from a stopped ingester.
    if (cursor && cursor.blockNumber !== null && cursor.blockHash) {
      await commitChainBatch({ scope, deploymentKey: key, stream, fills: [], positions: [], cursor: { blockNumber: cursor.blockNumber, blockHash: cursor.blockHash, payload } });
    }
    return { deploymentKey: key, fromBlock: null, toBlock: null, head: head.toString(), fills: 0, positions: 0, reset, caughtUp: true };
  }

  const markets = new Map(deployment.markets.map((market) => [market.seriesId.toLowerCase(), market]));
  const positions = new Map((await readOpenPositions({ scope, deploymentKey: key })).map((position) => [position.positionId, position]));
  const lastPrices = new Map((await readMarketFills({ scope, deploymentKey: key, limitPerMarket: 1 })).map((fill) => [fill.marketKey, fill.price]));
  const sides = new Map<string, "BUY" | "SELL" | null>();
  const firstBlock = from;
  let fillCount = 0;
  let positionCount = 0;
  let chunks = 0;
  const chunk = BigInt(options.chunkBlocks);
  while (from <= target && chunks < options.maxChunks) {
    const to = from + chunk - ONE < target ? from + chunk - ONE : target;
    const logs = await client.getLogs({
      address: [addresses.atomicClearingEngine, addresses.positionEngine],
      events: marketFeedEventsAbi,
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    const fills: MarketFillRecord[] = [];
    const touched = new Map<string, MarketPositionRecord>();
    for (const log of logs) {
      const blockNumber = Number(log.blockNumber);
      if (log.eventName === "FillCleared") {
        if (log.address.toLowerCase() !== clearing) continue;
        const record = log.args.record;
        const market = markets.get(record.targetId.toLowerCase());
        if (!market || record.isPackage) continue;
        const price = Number(ticksToPrice(market, record.executionPriceTicks));
        const side = await aggressorSide(client, addresses.orderState, record.takerOrderHash, record.makerOrderHash, sides);
        fills.push({
          fillId: record.fillId,
          chainId: deployment.chainId,
          marketKey: market.marketKey,
          seriesId: market.seriesId,
          blockNumber,
          blockHash: log.blockHash,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          clearedAt: Number(record.clearedAt),
          price,
          priceTicks: record.executionPriceTicks,
          lots: record.fillLots,
          side: side ?? tickRuleSide(price, lastPrices.get(market.marketKey)),
          sideInferred: side === null,
          channel: clearingChannel(record.channelKind),
          takerOrderHash: record.takerOrderHash,
          makerOrderHash: record.makerOrderHash,
          buyerAccountId: record.buyerAccountId,
          sellerAccountId: record.sellerAccountId,
        });
        lastPrices.set(market.marketKey, price);
        continue;
      }
      if (log.address.toLowerCase() !== positionEngine) continue;
      const positionId = log.args.positionId.toLowerCase();
      let position: MarketPositionRecord | undefined;
      if (log.eventName === "PositionCreated") {
        position = { positionId, seriesId: log.args.seriesId.toLowerCase(), remainingLots: log.args.lots, open: true, updatedBlock: blockNumber };
      } else {
        const known = positions.get(positionId);
        // A position not open in the projection is closed, and a closed position never reopens.
        if (!known) continue;
        position =
          log.eventName === "PositionQuantityChanged"
            ? { ...known, remainingLots: log.args.remainingLots, updatedBlock: blockNumber }
            : { ...known, open: positionStatusOpen(log.args.newStatus), updatedBlock: blockNumber };
      }
      positions.set(positionId, position);
      touched.set(positionId, position);
    }
    const block = await client.getBlock({ blockNumber: to });
    await commitChainBatch({
      scope,
      deploymentKey: key,
      stream,
      fills,
      positions: [...touched.values()],
      cursor: { blockNumber: Number(to), blockHash: block.hash, payload },
    });
    for (const [id, position] of touched) if (!position.open) positions.delete(id);
    fillCount += fills.length;
    positionCount += touched.size;
    from = to + ONE;
    chunks += 1;
  }
  return {
    deploymentKey: key,
    fromBlock: firstBlock.toString(),
    toBlock: (from - ONE).toString(),
    head: head.toString(),
    fills: fillCount,
    positions: positionCount,
    reset,
    caughtUp: from > target,
  };
}
