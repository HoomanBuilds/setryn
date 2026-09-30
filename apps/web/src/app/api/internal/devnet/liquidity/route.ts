import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseUnits,
  stringToHex,
  type Hex,
} from "viem";
import {
  orderStateAbi,
  publicOrderBookAbi,
  publicOrderTypedData,
  riskBindingAbi,
  serializePublicOrder,
  type OnchainPublicOrder,
} from "@/lib/internal-gateway/protocol";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZERO_ID = `0x${"0".repeat(64)}` as Hex;
const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
const MAKER_POLICY_CONTEXT = keccak256(stringToHex("SETRYN_DEVNET_MAKER_PUBLIC_SERIES_V1"));
const BOOK_ID_TYPEHASH = keccak256(
  stringToHex(
    "SetrynDirectBookV1(uint256 chainId,address book,address orderState,uint8 targetKind,bytes32 targetId,uint32 targetVersion,bytes32 executionModeId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 packageLegsHash)",
  ),
);

const vaultAbi = [
  {
    type: "function",
    name: "deriveAccountId",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "accountId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "accountExists",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "bytes32" }],
    outputs: [{ name: "exists", type: "bool" }],
  },
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ name: "accountId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
      { name: "accountId", type: "bytes32" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isLockOperator",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    type: "function",
    name: "setLockOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const tokenAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
] as const;

function deriveBookId(setryn: Awaited<ReturnType<typeof readLocalRuntime>>): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "typeHash", type: "bytes32" },
        { name: "chainId", type: "uint256" },
        { name: "book", type: "address" },
        { name: "orderState", type: "address" },
        { name: "targetKind", type: "uint8" },
        { name: "targetId", type: "bytes32" },
        { name: "targetVersion", type: "uint32" },
        { name: "executionModeId", type: "bytes32" },
        { name: "settlementAssetId", type: "bytes32" },
        { name: "settlementAssetVersion", type: "uint32" },
        { name: "feeScheduleId", type: "bytes32" },
        { name: "feeScheduleVersion", type: "uint32" },
        { name: "packageLegsHash", type: "bytes32" },
      ],
      [
        BOOK_ID_TYPEHASH,
        BigInt(setryn.chainId),
        setryn.publicOrderBook,
        setryn.orderState,
        1,
        setryn.seriesId,
        1,
        setryn.executionModeId,
        setryn.settlementAssetId,
        1,
        setryn.feeScheduleId,
        1,
        ZERO_ID,
      ],
    ),
  );
}

export async function POST(request: Request) {
  try {
    const setryn = await readLocalRuntime();
    const maker = getAddress(setryn.operator);
    const publicClient = createPublicClient({ transport: http(setryn.rpcUrl) });
    const walletClient = createWalletClient({ account: maker, transport: http(setryn.rpcUrl) });
    const accountId = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "deriveAccountId",
      args: [maker, ACCOUNT_SALT],
    });
    const exists = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "accountExists",
      args: [accountId],
    });
    if (!exists) {
      const createHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "createAccount",
        args: [ACCOUNT_SALT],
      });
      await publicClient.waitForTransactionReceipt({ hash: createHash });
      const funding = parseUnits("250000", 6);
      const mintHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "mint",
        args: [funding],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintHash });
      const approvalHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "approve",
        args: [setryn.collateralVault, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      const depositHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "deposit",
        args: [setryn.settlementAssetId, 1, accountId, funding],
      });
      await publicClient.waitForTransactionReceipt({ hash: depositHash });
    }
    for (const operator of [setryn.atomicClearingEngine, setryn.positionEngine]) {
      const lockApproved = await publicClient.readContract({
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "isLockOperator",
        args: [accountId, operator],
      });
      if (!lockApproved) {
        const lockHash = await walletClient.writeContract({
          account: maker,
          chain: null,
          address: setryn.collateralVault,
          abi: vaultAbi,
          functionName: "setLockOperator",
          args: [accountId, operator, true],
        });
        await publicClient.waitForTransactionReceipt({ hash: lockHash });
      }
    }

    const block = await publicClient.getBlock({ blockTag: "pending" });
    const bookId = deriveBookId(setryn);
    const created: Hex[] = [];
    for (const quote of [{ side: 1, priceTicks: BigInt(6110) }, { side: 2, priceTicks: BigInt(6130) }] as const) {
      let bestLevel = await publicClient.readContract({
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "bestLevel",
        args: [bookId, quote.side],
      }).catch(() => ZERO_ID);
      for (let attempt = 0; bestLevel !== ZERO_ID && attempt < 8; attempt += 1) {
        const level = await publicClient.readContract({
          address: setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "getPriceLevel",
          args: [bestLevel],
        });
        const record = await publicClient.readContract({
          address: setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [level.headOrderHash],
        });
        if ((record.status === 1 || record.status === 2) && record.order.deadline > block.timestamp) break;
        const pruneHash = await walletClient.writeContract({
          account: maker,
          chain: null,
          address: setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "pruneBest",
          args: [bookId, quote.side, [level.headOrderHash]],
        });
        await publicClient.waitForTransactionReceipt({ hash: pruneHash });
        bestLevel = await publicClient.readContract({
          address: setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "bestLevel",
          args: [bookId, quote.side],
        });
      }
      if (bestLevel !== ZERO_ID) continue;
      const nonce = block.timestamp * BigInt(10) + BigInt(quote.side);
      const order: OnchainPublicOrder = {
        signer: maker,
        accountId,
        policyId: PUBLIC_SERIES_POLICY,
        policyContextHash: MAKER_POLICY_CONTEXT,
        recipient: maker,
        targetKind: 1,
        seriesId: setryn.seriesId,
        targetVersion: 1,
        packageId: ZERO_ID,
        side: quote.side,
        lots: BigInt(10),
        priceTicks: quote.priceTicks,
        timeInForce: 1,
        remainderPolicy: 1,
        deadline: block.timestamp + BigInt(240),
        feeScheduleId: setryn.feeScheduleId,
        feeScheduleVersion: 1,
        maxFeeMinor: parseUnits("100", 6),
        executionModeId: setryn.executionModeId,
        actionId: setryn.enterActionId,
        permittedExecutor: setryn.atomicClearingEngine,
        nonce,
        salt: keccak256(encodeAbiParameters([{ name: "nonce", type: "uint256" }], [nonce])),
        allowPartialFills: true,
        minimumFillLots: BigInt(1),
        postOnly: true,
        reduceOnly: false,
      };
      const signature = await walletClient.signTypedData({
        account: maker,
        domain: {
          name: "Setryn",
          version: "1",
          chainId: setryn.chainId,
          verifyingContract: setryn.orderState,
        },
        types: publicOrderTypedData,
        primaryType: "PublicOrder",
        message: order,
      });
      const orderHash = await publicClient.readContract({
        address: setryn.orderState,
        abi: orderStateAbi,
        functionName: "hashOrder",
        args: [order],
      });
      const reservation = await fetch(new URL("/api/internal/orders/reserve-risk", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: serializePublicOrder(order), signature, orderHash }),
      });
      const reservationBody = (await reservation.json()) as { admissionId?: Hex };
      if (!reservation.ok || !reservationBody.admissionId) throw new Error("MAKER_RISK_RESERVATION_FAILED");
      const bindingHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.riskAdmissionBindingRegistry,
        abi: riskBindingAbi,
        functionName: "bindOrderRisk",
        args: [order, reservationBody.admissionId],
      });
      await publicClient.waitForTransactionReceipt({ hash: bindingHash });
      const registrationHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.orderState,
        abi: orderStateAbi,
        functionName: "registerSignedOrder",
        args: [order, signature],
      });
      await publicClient.waitForTransactionReceipt({ hash: registrationHash });
      const placementHash = await walletClient.writeContract({
        account: maker,
        chain: null,
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "placeSeriesOrder",
        args: [orderHash, { previousLevelId: ZERO_ID, nextLevelId: ZERO_ID }],
      });
      await publicClient.waitForTransactionReceipt({ hash: placementHash });
      created.push(orderHash);
    }
    return Response.json({ maker, accountId, created }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DEVNET_LIQUIDITY_FAILED";
    return Response.json({ error: message }, { status: 422 });
  }
}
