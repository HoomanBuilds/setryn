import { getAddress, isAddress, parseUnits } from "viem";
import { localAccountSigner } from "@/lib/internal-gateway/operator-signer";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** 100 test ETH for gas on the local chain only. */
const FUNDED_BALANCE = "0x56bc75e2d63100000";
/** Test USDC granted per request, and the wallet balance above which no more is granted. */
const USDC_GRANT = parseUnits("100000", 6);
const USDC_WALLET_LIMIT = parseUnits("1000000", 6);

const tokenAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const body = (await response.json()) as { error?: unknown; result?: unknown };
  if (!response.ok || body.error) throw new Error("RPC_FAILED");
  return body.result;
}

/**
 * Local chain only. Tops the wallet up with gas, and with `{ asset: "USDC" }` also grants test USDC from the local
 * settlement token. Every network settles in real USDC that the wallet deposits itself, so this route does not exist
 * there.
 */
export async function POST(request: Request) {
  try {
    const setryn = await readRuntime();
    if (setryn.network !== "local") {
      return Response.json({ error: "NOT_AVAILABLE_ON_NETWORK" }, { status: 404, headers: NO_STORE });
    }
    const body = (await request.json().catch(() => ({}))) as { address?: unknown; asset?: unknown };
    if (typeof body.address !== "string" || !isAddress(body.address)) {
      return Response.json({ error: "Invalid account" }, { status: 400, headers: NO_STORE });
    }
    if (body.asset !== undefined && body.asset !== "GAS" && body.asset !== "USDC") {
      return Response.json({ error: "Invalid asset" }, { status: 400, headers: NO_STORE });
    }
    const address = getAddress(body.address);
    // anvil_setBalance returns null on success, so success is confirmed by reading the balance back.
    await rpc(setryn.rpcUrl, "anvil_setBalance", [address, FUNDED_BALANCE]);
    const balance = await rpc(setryn.rpcUrl, "eth_getBalance", [address, "latest"]);
    if (typeof balance !== "string" || BigInt(balance) !== BigInt(FUNDED_BALANCE)) throw new Error("FUNDING_FAILED");
    if (body.asset !== "USDC") return Response.json({ funded: true }, { headers: NO_STORE });

    const operator = localAccountSigner(setryn, "operator", getAddress(setryn.operator));
    const { publicClient, walletClient } = operator;
    const held = await publicClient.readContract({ address: setryn.settlementToken, abi: tokenAbi, functionName: "balanceOf", args: [address] });
    if (held >= USDC_WALLET_LIMIT) {
      return Response.json(
        { error: "FAUCET_LIMIT", message: "This wallet already holds the most test USDC the local faucet grants." },
        { status: 409, headers: NO_STORE },
      );
    }
    // The token mints to its caller, so the operator mints the grant and transfers it to the wallet.
    const mintHash = await walletClient.writeContract({
      chain: null,
      address: setryn.settlementToken,
      abi: tokenAbi,
      functionName: "mint",
      args: [USDC_GRANT],
    });
    if ((await publicClient.waitForTransactionReceipt({ hash: mintHash })).status !== "success") throw new Error("FUNDING_FAILED");
    const transferHash = await walletClient.writeContract({
      chain: null,
      address: setryn.settlementToken,
      abi: tokenAbi,
      functionName: "transfer",
      args: [address, USDC_GRANT],
    });
    if ((await publicClient.waitForTransactionReceipt({ hash: transferHash })).status !== "success") throw new Error("FUNDING_FAILED");
    return Response.json({ funded: true, usdc: Number(USDC_GRANT) / 1e6, transactionHash: transferHash }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "FUNDING_FAILED", message: "The local chain could not fund this wallet." }, { status: 503, headers: NO_STORE });
  }
}
