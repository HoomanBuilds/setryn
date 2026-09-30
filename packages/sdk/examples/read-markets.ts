/**
 * Reads the deployment status, the market catalog, the onchain book and the trade tape.
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
    console.log(`${market.execution.padEnd(12)} ${market.id.padEnd(22)} ${market.qualification.padEnd(11)} preview ${quote}`);
  }
  console.log(`${count} markets`);

  const onchain = (await client.listMarkets({ execution: "ONCHAIN" })).data[0];
  if (onchain) {
    const book = await client.getBook(onchain.id);
    console.log(`\n${onchain.id} ${book.source}: ${book.bids.length} bid levels, ${book.asks.length} ask levels`);
    for (const level of book.asks.slice(0, 3).reverse()) console.log(`  ask ${level.price.toFixed(1)} x ${level.lots}`);
    for (const level of book.bids.slice(0, 3)) console.log(`  bid ${level.price.toFixed(1)} x ${level.lots}`);
    const trades = await client.listTrades(onchain.id, { limit: 5 });
    console.log(`last ${trades.data.length} of ${trades.page.total} onchain trades`);
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
