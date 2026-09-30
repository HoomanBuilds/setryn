/**
 * Non-custodial private RFQ against a LOCAL DEVNET deployment (chain 31337 only).
 *
 *   SETRYN_API_KEY=stk_test_...            key with the "trade" scope, issued at /developers
 *   SETRYN_DEVNET_PRIVATE_KEY=0x...        a local anvil account key; never a real key
 *   SETRYN_BASE_URL=http://localhost:3100
 *   SETRYN_RPC_URL=http://127.0.0.1:8545
 *   SETRYN_MARKET_ID=EURUSD-FW-30DEC26       optional; any market with execution ONCHAIN
 *   SETRYN_SIDE=LONG                         optional; LONG or SHORT
 *   pnpm --filter @setryn/sdk example:rfq
 *
 * Flow: the API prepares the taker order and the private RFQ request bound to it, the wallet signs both, the API
 * reserves risk and returns the transactions that commit and open the RFQ, the solver quotes (on the devnet, the
 * platform's seeded solver), the wallet signs the selection of the best quote inside its limit and sends the
 * selection transactions, and the executor clears the fill atomically. Devnet-only conveniences (minting test sUSD)
 * are clearly marked and refuse to run on any other chain.
 */
import { createPublicClient, createWalletClient, defineChain, http, keccak256, maxUint256, parseAbi, parseUnits, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SetrynApiError, SetrynClient, executeRfq } from "../src/index.ts";

const apiKey = process.env.SETRYN_API_KEY;
const privateKey = process.env.SETRYN_DEVNET_PRIVATE_KEY as Hex | undefined;
const baseUrl = process.env.SETRYN_BASE_URL ?? "http://localhost:3100";
const rpcUrl = process.env.SETRYN_RPC_URL ?? "http://127.0.0.1:8545";
if (!apiKey || !privateKey) {
  console.error("Set SETRYN_API_KEY (trade scope) and SETRYN_DEVNET_PRIVATE_KEY (a local anvil account).");
  process.exit(1);
}

const client = new SetrynClient({ apiKey, baseUrl });
const status = await client.status();
if (status.chainId !== 31337) {
  console.error(`Refusing to run: this example is for the local devnet (31337), the deployment reports ${status.chainId}.`);
  process.exit(1);
}
const chain = defineChain({
  id: 31337,
  name: "Setryn local devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(privateKey);
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const log = (line: string) => console.log(line);

// --- Devnet only: post test collateral so risk admission can pass. -------------------------------------------------
const vault = status.contracts.collateralVault;
const token = status.settlement.token;
const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function mint(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const vaultAbi = parseAbi([
  "function accountExists(bytes32 accountId) view returns (bool)",
  "function createAccount(bytes32 salt) returns (bytes32)",
  "function deposit(bytes32 assetId, uint32 bindingVersion, bytes32 accountId, uint128 amount)",
]);
async function ensureDevnetCollateral(accountId: Hex, requiredMinor: bigint): Promise<void> {
  const confirm = async (hash: Hex) => {
    await publicClient.waitForTransactionReceipt({ hash });
  };
  const amount = requiredMinor * BigInt(2) + parseUnits("100", 6);
  if (!(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "accountExists", args: [accountId] }))) {
    const salt = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
    await confirm(await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "createAccount", args: [salt] }));
  }
  const balance = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account.address] });
  if (balance < amount) await confirm(await wallet.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [amount - balance] }));
  await confirm(await wallet.writeContract({ address: token, abi: tokenAbi, functionName: "approve", args: [vault, maxUint256] }));
  await confirm(
    await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "deposit", args: [status.settlement.assetId, 1, accountId, amount] }),
  );
  log(`devnet: deposited ${Number(amount) / 1e6} test sUSD`);
}

try {
  const marketId = process.env.SETRYN_MARKET_ID ?? "EURUSD-FW-30DEC26";
  const side = process.env.SETRYN_SIDE === "SHORT" ? "SHORT" : "LONG";
  const market = await client.getMarket(marketId);
  if (market.execution !== "ONCHAIN") throw new Error(`${marketId} does not execute onchain on this deployment.`);
  // The limit is the worst price accepted: a quote outside it is reported with withinLimit: false and cannot be accepted.
  const limitPrice = side === "LONG" ? market.quote.bestAsk : market.quote.bestBid;
  log(`${market.id}: requesting firm quotes to go ${side} 1 lot, limit ${limitPrice}`);

  const preview = await client.prepareRfq({ signer: account.address, marketId: market.id, side, lots: 1, limitPrice });
  if (!preview.preconditions.sufficientCollateral) await ensureDevnetCollateral(preview.accountId, BigInt(preview.preconditions.requiredCollateralMinor));

  const result = await executeRfq(
    client,
    wallet,
    publicClient,
    { marketId: market.id, side, lots: 1, limitPrice },
    { onStep: (transaction, hash) => log(`  ${transaction.step.padEnd(22)} ${hash}`) },
  );
  for (const quote of result.quotes) log(`quote ${quote.quoteId} ${quote.solver}: ${quote.lots} @ ${quote.price} (within limit: ${quote.withinLimit})`);
  log(`accepted ${result.quote.quoteId} at ${result.accepted.price}`);
  log(`settled: fill ${result.settlement.fillId} ${result.settlement.filledLots} @ ${result.settlement.price}, fees ${result.settlement.feesUsd}`);
  log(`RFQ ${result.rfq.rfqId} is ${result.rfq.state}; position ${result.settlement.positionId}`);
} catch (error) {
  if (error instanceof SetrynApiError) {
    console.error(`${error.status} ${error.code}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
