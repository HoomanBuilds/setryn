import { BaseError, ContractFunctionRevertedError, type Address } from "viem";
import { relayerSigner, signerUnavailableResponse } from "@/lib/internal-gateway/operator-signer";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";
import { quoteSettlementRouterAbi } from "@/lib/quotes/protocol";
import { parseQuoteSettlement } from "@/lib/quotes/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Setryn's optional relayer for firm-quote settlements: gasless for the user, never required. The body is a settlement
 * the user already signed (their order and their risk authorization); the relayer adds nothing to it, charges no fee,
 * simulates it against the router, and submits it from its own key and nonce lane. The router is permissionless, so a
 * refusal or an outage here only means the user (or any other relayer or bot) submits the same signed settlement
 * directly. The response is the transaction hash; the client follows the receipt itself.
 */
export async function POST(request: Request) {
  let settlement;
  try {
    settlement = parseQuoteSettlement(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "INVALID_SETTLEMENT" }, { status: 400, headers: NO_STORE });
  }
  const setryn = await readRuntime();
  if (!setryn.quoteSettlementRouter) {
    return Response.json({ error: "QUOTE_ROUTER_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
  // This relayer charges nothing, so it relays only settlements that pay it nothing.
  if (settlement.relayerFeeMinor !== BigInt(0)) {
    return Response.json({ error: "RELAYER_FEE_NOT_ACCEPTED" }, { status: 400, headers: NO_STORE });
  }
  let relayer;
  try {
    relayer = await relayerSigner(setryn);
  } catch (error) {
    const response = signerUnavailableResponse(error);
    if (response) return response;
    throw error;
  }
  const restricted = settlement.taker.terms.relayer;
  if (restricted !== "0x0000000000000000000000000000000000000000" && restricted.toLowerCase() !== relayer.address.toLowerCase()) {
    return Response.json({ error: "RELAYER_NOT_AUTHORIZED" }, { status: 403, headers: NO_STORE });
  }
  const router = setryn.quoteSettlementRouter as Address;
  try {
    await relayer.publicClient.simulateContract({
      account: relayer.address,
      address: router,
      abi: quoteSettlementRouterAbi,
      functionName: "settle",
      args: [settlement],
    });
  } catch (error) {
    return Response.json({ error: "SETTLEMENT_REJECTED", reason: revertName(error) }, { status: 422, headers: NO_STORE });
  }
  try {
    const transactionHash = await relayer.walletClient.writeContract({
      chain: null,
      address: router,
      abi: quoteSettlementRouterAbi,
      functionName: "settle",
      args: [settlement],
    });
    return Response.json({ transactionHash, relayer: relayer.address }, { headers: NO_STORE });
  } catch (error) {
    console.error("[quotes/settle] submit", error instanceof Error ? error.message.split("\n")[0] : error);
    return Response.json({ error: "RELAY_FAILED" }, { status: 502, headers: NO_STORE });
  }
}

/** The router's (or a contract beneath it) revert name, for the client to show; never the raw RPC error. */
function revertName(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? reverted.signature ?? "REVERTED";
  }
  return "REVERTED";
}
