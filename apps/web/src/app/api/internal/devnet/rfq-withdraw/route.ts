import { createPublicClient, createWalletClient, getAddress, http, keccak256, stringToHex, type Hex } from "viem";
import { capacityCancelTypedData, privateRfqBookAbi } from "@/lib/internal-gateway/protocol";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";
import { devnetOperatorTransport } from "@/lib/internal-gateway/devnet-operator-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { quoteId?: unknown };
    if (typeof body.quoteId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.quoteId)) {
      return Response.json({ error: "Invalid quote identifier" }, { status: 400 });
    }
    const quoteId = body.quoteId as Hex;
    const setryn = await readLocalRuntime();
    const maker = getAddress(setryn.operator);
    const publicClient = createPublicClient({ transport: http(setryn.rpcUrl) });
    const walletClient = createWalletClient({ account: maker, transport: devnetOperatorTransport(setryn.rpcUrl) });
    const quote = await publicClient.readContract({
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "getQuote",
      args: [quoteId],
    });
    if (quote.quote.maker.toLowerCase() !== maker.toLowerCase()) throw new Error("QUOTE_MAKER_MISMATCH");
    if (quote.status === 3) throw new Error("RFQ_SELECTION_LOCKED");
    const block = await publicClient.getBlock({ blockTag: "pending" });
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const cancellation = {
      quoteId,
      maker,
      nonce,
      deadline: block.timestamp + BigInt(60),
      salt: keccak256(stringToHex(`${quoteId}:${nonce}:cancel-capacity`)),
    } as const;
    const signature = await walletClient.signTypedData({
      account: maker,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook },
      types: capacityCancelTypedData,
      primaryType: "CapacityCancelAuthorization",
      message: cancellation,
    });
    const hash = await walletClient.writeContract({
      account: maker,
      chain: null,
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "cancelQuoteCapacity",
      args: [cancellation, signature],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("QUOTE_WITHDRAWAL_FAILED");
    return Response.json({ quoteId, transactionHash: hash }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "QUOTE_WITHDRAWAL_FAILED";
    return Response.json({ error: message }, { status: 422 });
  }
}
