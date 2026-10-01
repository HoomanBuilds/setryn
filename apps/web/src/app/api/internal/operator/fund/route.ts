import { getAddress, isAddress, parseUnits } from "viem";
import { localAccountSigner, operatorSigner, signerUnavailableResponse } from "@/lib/internal-gateway/operator-signer";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** 100 test ETH for gas on the local chain only. */
const FUNDED_BALANCE = "0x56bc75e2d63100000";
const LOCAL_USDC_GRANT = parseUnits("100000", 6);
const LOCAL_USDC_WALLET_LIMIT = parseUnits("1000000", 6);
const SEPOLIA_USDC_GRANT = parseUnits("10000", 6);
const TEST_USDC_MAXIMUM_BALANCE = parseUnits("10000000", 6);
const CLAIM_COOLDOWN_MS = 3 * 60 * 1000;

const tokenAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "mintTo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
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

const FAUCET_STATE_KEY = Symbol.for("setryn.test-usdc-faucet.state");

interface FaucetState {
  claims: Map<string, number>;
}

function faucetState(): FaucetState {
  const holder = globalThis as unknown as Record<symbol, FaucetState | undefined>;
  holder[FAUCET_STATE_KEY] ??= { claims: new Map() };
  return holder[FAUCET_STATE_KEY];
}

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

/** Grants mintable test collateral locally or on Sepolia. Only the local chain can also top up native gas. */
export async function POST(request: Request) {
  let reservedClaim: { key: string; at: number } | null = null;
  try {
    const setryn = await readRuntime();
    const local = setryn.network === "local";
    const sepoliaFaucet = setryn.network === "arbitrum-sepolia" && setryn.settlementTokenMintable === true;
    if (!local && !sepoliaFaucet) {
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
    if (!local && body.asset !== "USDC") {
      return Response.json({ error: "Invalid asset" }, { status: 400, headers: NO_STORE });
    }
    if (local) {
      await rpc(setryn.rpcUrl, "anvil_setBalance", [address, FUNDED_BALANCE]);
      const balance = await rpc(setryn.rpcUrl, "eth_getBalance", [address, "latest"]);
      if (typeof balance !== "string" || BigInt(balance) !== BigInt(FUNDED_BALANCE)) throw new Error("FUNDING_FAILED");
      if (body.asset !== "USDC") return Response.json({ funded: true }, { headers: NO_STORE });
    }

    if (sepoliaFaucet) {
      const key = address.toLowerCase();
      const now = Date.now();
      const previous = faucetState().claims.get(key) ?? 0;
      const retryAfterMs = previous + CLAIM_COOLDOWN_MS - now;
      if (retryAfterMs > 0) {
        return Response.json(
          { error: "FAUCET_COOLDOWN", message: "Test USDC was already requested recently. Try again in a few minutes." },
          { status: 429, headers: { ...NO_STORE, "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
        );
      }
      faucetState().claims.set(key, now);
      reservedClaim = { key, at: now };
    }

    const operator = local
      ? localAccountSigner(setryn, "operator", getAddress(setryn.operator))
      : await operatorSigner(setryn);
    const { publicClient, walletClient } = operator;
    const held = await publicClient.readContract({ address: setryn.settlementToken, abi: tokenAbi, functionName: "balanceOf", args: [address] });
    const grant = local ? LOCAL_USDC_GRANT : SEPOLIA_USDC_GRANT;
    const walletLimit = local ? LOCAL_USDC_WALLET_LIMIT : TEST_USDC_MAXIMUM_BALANCE;
    if (held > walletLimit - grant) {
      if (reservedClaim && faucetState().claims.get(reservedClaim.key) === reservedClaim.at) {
        faucetState().claims.delete(reservedClaim.key);
        reservedClaim = null;
      }
      return Response.json(
        { error: "FAUCET_LIMIT", message: "This wallet already holds the maximum test USDC available from the faucet." },
        { status: 409, headers: NO_STORE },
      );
    }

    if (sepoliaFaucet) {
      const mintHash = await walletClient.writeContract({
        chain: null,
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "mintTo",
        args: [address, grant],
      });
      if ((await publicClient.waitForTransactionReceipt({ hash: mintHash })).status !== "success") throw new Error("FUNDING_FAILED");
      return Response.json({ funded: true, usdc: Number(grant) / 1e6, transactionHash: mintHash }, { headers: NO_STORE });
    }

    const mintHash = await walletClient.writeContract({
      chain: null,
      address: setryn.settlementToken,
      abi: tokenAbi,
      functionName: "mint",
      args: [grant],
    });
    if ((await publicClient.waitForTransactionReceipt({ hash: mintHash })).status !== "success") throw new Error("FUNDING_FAILED");
    const transferHash = await walletClient.writeContract({
      chain: null,
      address: setryn.settlementToken,
      abi: tokenAbi,
      functionName: "transfer",
      args: [address, grant],
    });
    if ((await publicClient.waitForTransactionReceipt({ hash: transferHash })).status !== "success") throw new Error("FUNDING_FAILED");
    return Response.json({ funded: true, usdc: Number(grant) / 1e6, transactionHash: transferHash }, { headers: NO_STORE });
  } catch (error) {
    if (reservedClaim && faucetState().claims.get(reservedClaim.key) === reservedClaim.at) {
      faucetState().claims.delete(reservedClaim.key);
    }
    const unavailable = signerUnavailableResponse(error);
    if (unavailable) return unavailable;
    return Response.json({ error: "FUNDING_FAILED", message: "The testnet faucet could not fund this wallet." }, { status: 503, headers: NO_STORE });
  }
}
