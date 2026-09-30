/**
 * Non-custodial order entry against a LOCAL DEVNET deployment (chain 31337 only).
 *
 *   SETRYN_API_KEY=stk_test_...            key with the "trade" scope, issued at /developers
 *   SETRYN_DEVNET_PRIVATE_KEY=0x...        a local anvil account key; never a real key
 *   SETRYN_BASE_URL=http://localhost:3100
 *   SETRYN_RPC_URL=http://127.0.0.1:8545
 *   pnpm --filter @setryn/sdk example:order
 *
 * Flow: the API prepares the order, the wallet signs it locally, the API relays it to risk admission and returns the
 * transactions, and the wallet sends them. Devnet-only conveniences (minting test sUSD, seeding the devnet maker)
 * are clearly marked and refuse to run on any other chain.
 */
import { createPublicClient, createWalletClient, defineChain, http, keccak256, maxUint256, parseAbi, parseUnits, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SetrynApiError, SetrynClient, placeOrder } from "../src/index.ts";

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
  const market = (await client.listMarkets({ execution: "ONCHAIN" })).data[0];
  if (!market) throw new Error("No onchain market on this deployment.");
  let book = await client.getBook(market.id);
  if (book.asks.length === 0) {
    // Devnet only: the platform's devnet maker quotes both sides of the book.
    await fetch(`${baseUrl}/api/internal/devnet/liquidity`, { method: "POST" });
    book = await client.getBook(market.id);
  }
  const bestAsk = book.asks[0];
  if (!bestAsk) throw new Error("No offers on the book.");
  log(`${market.id}: best ask ${bestAsk.price} x ${bestAsk.lots}`);

  const preview = await client.prepareOrder({ signer: account.address, marketId: market.id, side: "LONG", lots: 1, limitPrice: bestAsk.price, timeInForce: "IOC" });
  if (!preview.preconditions.sufficientCollateral) await ensureDevnetCollateral(preview.accountId, BigInt(preview.preconditions.requiredCollateralMinor));

  const result = await placeOrder(
    client,
    wallet,
    publicClient,
    { signer: account.address, marketId: market.id, side: "LONG", lots: 1, limitPrice: bestAsk.price, timeInForce: "IOC" },
    (transaction, hash) => log(`  ${transaction.step.padEnd(22)} ${hash}`),
  );
  log(`order ${result.submitted.orderHash} risk admission ${result.submitted.riskAdmissionId}`);

  const order = await client.getOrder(result.submitted.orderHash);
  log(`state ${order.state}: ${order.filledLots}/${order.lots} filled, fills ${order.fillIds.length}`);
  const fills = await client.listFills({ accountId: order.accountId }, { limit: 1 });
  const receipts = await client.listReceipts({ accountId: order.accountId }, { limit: 1 });
  const positions = await client.listPositions(order.accountId);
  log(`latest fill ${fills.data[0]?.fillId} ${fills.data[0]?.filledLots} @ ${fills.data[0]?.price}, fees ${fills.data[0]?.feesUsd}`);
  log(`latest receipt ${receipts.data[0]?.receiptId} (${receipts.data[0]?.guarantee})`);
  log(`${positions.page.total} live positions`);
} catch (error) {
  if (error instanceof SetrynApiError) {
    console.error(`${error.status} ${error.code}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
