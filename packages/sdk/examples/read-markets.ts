/**
 * Reads the deployment status, the market catalog, and the onchain book and trade tape of every onchain market.
 *
 *   SETRYN_API_KEY=stk_test_... SETRYN_BASE_URL=http://localhost:3100 pnpm --filter @setryn/sdk example:read
 */
import { SetrynApiError, SetrynClient } from "../src/index.ts";

const apiKey = process.env.SETRYN_API_KEY;
if (!apiKey) {
  console.error("Set SETRYN_API_KEY to a key issued at /developers.");
  process.exit(1);
}
const client = new SetrynClient({ apiKey, baseUrl: process.env.SETRYN_BASE_URL ?? "http://localhost:3100" });

try {
  const status = await client.status();
  console.log(`chain ${status.chainId} head #${status.headBlock} chain time ${status.chainTime}`);
  console.log(`deployment ${status.deployment.state}: ${status.deployment.matching}/${status.deployment.contracts} code hashes match`);

  let count = 0;
  for await (const market of client.paginate((page) => client.listMarkets(page), 5)) {
    count += 1;
    const quote = `${market.quote.bestBid} / ${market.quote.bestAsk}`;
    const grid = market.onchain ? `grid 1/${market.onchain.priceScale} x${market.contractMultiplier}` : "";
    console.log(`${market.execution.padEnd(12)} ${market.id.padEnd(22)} ${market.qualification.padEnd(11)} preview ${quote} ${grid}`);
  }
  console.log(`${count} markets`);

  // Every onchain market rests on its own series book with its own price grid.
  for await (const onchain of client.paginate((page) => client.listMarkets({ ...page, execution: "ONCHAIN" }), 50)) {
    const book = await client.getBook(onchain.id);
    const trades = await client.listTrades(onchain.id, { limit: 3 });
    const decimals = Math.round(Math.log10(onchain.onchain?.priceScale ?? 10));
    const top = `${book.bids[0]?.price.toFixed(decimals) ?? "-"} / ${book.asks[0]?.price.toFixed(decimals) ?? "-"}`;
    console.log(`\n${onchain.id} ${book.source}: ${book.bids.length} bid / ${book.asks.length} ask levels, top ${top}, ${trades.page.total} trades`);
    for (const trade of trades.data) console.log(`  ${trade.time} ${trade.aggressorSide} ${trade.lots} @ ${trade.price}`);
  }

  const preview = (await client.listMarkets({ execution: "PREVIEW_ONLY", limit: 1 })).data[0];
  if (preview) {
    const book = await client.getBook(preview.id);
    console.log(`\n${preview.id} ${book.source} (executable: ${book.executable}), best ask ${book.asks[0]?.price}`);
  }
} catch (error) {
  if (error instanceof SetrynApiError) {
    console.error(`${error.status} ${error.code}: ${error.message} (request ${error.requestId})`);
    process.exit(1);
  }
  throw error;
}
