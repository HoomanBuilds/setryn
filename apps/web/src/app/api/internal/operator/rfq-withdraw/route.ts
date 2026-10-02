import { keccak256, stringToHex, type Hex } from "viem";
import { withMakerLock } from "@/lib/internal-gateway/maker-lock";
import { makerSigner, signerUnavailableResponse } from "@/lib/internal-gateway/operator-signer";
import { capacityCancelTypedData, privateRfqBookAbi } from "@/lib/internal-gateway/protocol";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** The designated maker withdraws one of its own RFQ quotes and the capacity it reserved, before selection locks it. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { quoteId?: unknown };
    if (typeof body.quoteId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.quoteId)) {
      return Response.json({ error: "Invalid quote identifier" }, { status: 400, headers: NO_STORE });
    }
    const quoteId = body.quoteId as Hex;
    const setryn = await readRuntime();
    const maker = await makerSigner(setryn);
    const { publicClient, walletClient } = maker;
    const quote = await publicClient.readContract({
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "getQuote",
      args: [quoteId],
    });
    if (quote.quote.maker.toLowerCase() !== maker.address.toLowerCase()) throw new Error("QUOTE_MAKER_MISMATCH");
    if (quote.status === 3) throw new Error("RFQ_SELECTION_LOCKED");
    const block = await publicClient.getBlock({ blockTag: "pending" });
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const cancellation = {
      quoteId,
      maker: maker.address,
      nonce,
      deadline: block.timestamp + BigInt(60),
      salt: keccak256(stringToHex(`${quoteId}:${nonce}:cancel-capacity`)),
    } as const;
    const signature = await walletClient.signTypedData({
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook },
      types: capacityCancelTypedData,
      primaryType: "CapacityCancelAuthorization",
      message: cancellation,
    });
    // Every maker send runs under the maker lock, so it never races the liquidity refresh for a nonce.
    const hash = await withMakerLock(async () => {
      const sent = await walletClient.writeContract({
        chain: null,
        address: setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "cancelQuoteCapacity",
        args: [cancellation, signature],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: sent });
      if (receipt.status !== "success") throw new Error("QUOTE_WITHDRAWAL_FAILED");
      return sent;
    });
    return Response.json({ quoteId, transactionHash: hash }, { headers: NO_STORE });
  } catch (error) {
    const unavailable = signerUnavailableResponse(error);
    if (unavailable) return unavailable;
    const message = error instanceof Error ? error.message.split("\n")[0] : "QUOTE_WITHDRAWAL_FAILED";
    return Response.json({ error: message }, { status: 422, headers: NO_STORE });
  }
}
