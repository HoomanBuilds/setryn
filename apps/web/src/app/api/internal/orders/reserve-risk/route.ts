import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  isHex,
  keccak256,
  stringToHex,
  verifyTypedData,
  type Hex,
} from "viem";
import {
  orderStateAbi,
  parsePublicOrder,
  publicOrderTypedData,
  type SerializedPublicOrder,
} from "@/lib/internal-gateway/protocol";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
const POSITION_NAMESPACE = keccak256(stringToHex("SETRYN_PROSPECTIVE_POSITION_V1"));
const ECONOMICS_NAMESPACE = keccak256(stringToHex("SETRYN_DEVNET_ORDER_ECONOMICS_V1"));
const OBSERVATION_KEY = keccak256(stringToHex("SETRYN_DEVNET_BTC_USD_MARK_V1"));
const REQUEST_TYPEHASH = keccak256(
  stringToHex(
    "SetrynRiskAdmissionRequestV1(bytes32 accountId,bytes32 riskDomainId,uint32 riskDomainVersion,uint128 openInterestIncreaseBaseUnits,uint128 terminalLiabilityIncreaseBaseUnits,uint64 deadline,uint256 nonce,bytes32 salt,uint256 chainId,address engine)",
  ),
);
const ADMISSION_ID_TYPEHASH = keccak256(stringToHex("SetrynRiskAdmissionIdV1"));
const ZERO_ID = `0x${"0".repeat(64)}` as Hex;

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
] as const;

const riskEngineAbi = [
  {
    type: "function",
    name: "reserveNewRisk",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "accountId", type: "bytes32" },
          { name: "riskDomainId", type: "bytes32" },
          { name: "riskDomainVersion", type: "uint32" },
          { name: "openInterestIncreaseBaseUnits", type: "uint128" },
          { name: "terminalLiabilityIncreaseBaseUnits", type: "uint128" },
          { name: "deadline", type: "uint64" },
          { name: "nonce", type: "uint256" },
          { name: "salt", type: "bytes32" },
        ],
      },
      {
        name: "positions",
        type: "tuple[]",
        components: [
          { name: "positionId", type: "bytes32" },
          { name: "seriesId", type: "bytes32" },
          { name: "seriesVersion", type: "uint32" },
          { name: "signedLots", type: "int128" },
          { name: "entryPriceTicks", type: "int128" },
          { name: "maximumTerminalLiabilityBaseUnits", type: "uint128" },
          { name: "economicsHash", type: "bytes32" },
        ],
      },
      {
        name: "observations",
        type: "tuple[]",
        components: [
          { name: "observationKey", type: "bytes32" },
          { name: "valueHash", type: "bytes32" },
          { name: "observedAt", type: "uint64" },
        ],
      },
    ],
    outputs: [
      { name: "admissionId", type: "bytes32" },
      {
        name: "result",
        type: "tuple",
        components: [
          { name: "configurationHash", type: "bytes32" },
          { name: "witnessHash", type: "bytes32" },
          { name: "observationsHash", type: "bytes32" },
          {
            name: "metrics",
            type: "tuple",
            components: [
              { name: "initialMarginBaseUnits", type: "uint128" },
              { name: "maintenanceMarginBaseUnits", type: "uint128" },
              { name: "stressLossBaseUnits", type: "uint128" },
              { name: "concentrationBaseUnits", type: "uint128" },
              { name: "openInterestBaseUnits", type: "uint128" },
              { name: "accountTerminalLiabilityBaseUnits", type: "uint128" },
              { name: "aggregateTerminalLiabilityBaseUnits", type: "uint128" },
              { name: "liquidationDistanceBaseUnits", type: "int256" },
              { name: "availableHeadroomBaseUnits", type: "uint128" },
            ],
          },
        ],
      },
    ],
  },
] as const;

interface ReservationBody {
  order?: SerializedPublicOrder;
  signature?: unknown;
  orderHash?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReservationBody;
    const order = parsePublicOrder(body.order);
    if (
      typeof body.signature !== "string" ||
      !isHex(body.signature, { strict: true }) ||
      typeof body.orderHash !== "string" ||
      !isHex(body.orderHash, { strict: true }) ||
      body.orderHash.length !== 66
    ) {
      return Response.json({ error: "Invalid signed order" }, { status: 400 });
    }

    const setryn = await readLocalRuntime();
    if (
      order.seriesId.toLowerCase() !== setryn.seriesId.toLowerCase() ||
      order.packageId !== ZERO_ID ||
      order.feeScheduleId.toLowerCase() !== setryn.feeScheduleId.toLowerCase() ||
      ![setryn.executionModeId.toLowerCase(), setryn.privateRfqExecutionModeId.toLowerCase()].includes(
        order.executionModeId.toLowerCase(),
      ) ||
      order.actionId.toLowerCase() !== setryn.enterActionId.toLowerCase() ||
      order.permittedExecutor.toLowerCase() !== setryn.atomicClearingEngine.toLowerCase()
    ) {
      return Response.json({ error: "Order is outside the active market" }, { status: 400 });
    }

    const validSignature = await verifyTypedData({
      address: order.signer,
      domain: {
        name: "Setryn",
        version: "1",
        chainId: setryn.chainId,
        verifyingContract: setryn.orderState,
      },
      types: publicOrderTypedData,
      primaryType: "PublicOrder",
      message: order,
      signature: body.signature,
    });
    if (!validSignature) return Response.json({ error: "Invalid order signature" }, { status: 401 });

    const publicClient = createPublicClient({ transport: http(setryn.rpcUrl) });
    const [canonicalOrderHash, canonicalAccountId, block] = await Promise.all([
      publicClient.readContract({
        address: setryn.orderState,
        abi: orderStateAbi,
        functionName: "hashOrder",
        args: [order],
      }),
      publicClient.readContract({
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "deriveAccountId",
        args: [order.signer, ACCOUNT_SALT],
      }),
      publicClient.getBlock({ blockTag: "pending" }),
    ]);
    if (
      canonicalOrderHash.toLowerCase() !== body.orderHash.toLowerCase() ||
      canonicalAccountId.toLowerCase() !== order.accountId.toLowerCase()
    ) {
      return Response.json({ error: "Signed order identity mismatch" }, { status: 400 });
    }
    if (order.deadline <= block.timestamp || order.deadline > block.timestamp + BigInt(300)) {
      return Response.json({ error: "Risk reservation deadline is outside the live window" }, { status: 400 });
    }

    const openInterest = order.lots;
    const liabilityPerLot = BigInt(
      order.side === 1 ? setryn.maxLongDebitMinorPerLot : setryn.maxShortDebitMinorPerLot,
    );
    const terminalLiability = order.lots * liabilityPerLot;
    const positionId = keccak256(
      encodeAbiParameters(
        [
          { name: "namespace", type: "bytes32" },
          { name: "orderHash", type: "bytes32" },
        ],
        [POSITION_NAMESPACE, canonicalOrderHash],
      ),
    );
    const economicsHash = keccak256(
      encodeAbiParameters(
        [
          { name: "namespace", type: "bytes32" },
          { name: "seriesId", type: "bytes32" },
          { name: "side", type: "uint8" },
          { name: "lots", type: "uint128" },
          { name: "priceTicks", type: "int128" },
          { name: "liability", type: "uint128" },
        ],
        [ECONOMICS_NAMESPACE, order.seriesId, order.side, order.lots, order.priceTicks, terminalLiability],
      ),
    );
    const valueHash = keccak256(
      encodeAbiParameters(
        [
          { name: "seriesId", type: "bytes32" },
          { name: "priceTicks", type: "int128" },
          { name: "observedAt", type: "uint64" },
        ],
        [order.seriesId, order.priceTicks, block.timestamp],
      ),
    );
    const riskSalt = keccak256(
      encodeAbiParameters(
        [
          { name: "orderHash", type: "bytes32" },
          { name: "orderSalt", type: "bytes32" },
        ],
        [canonicalOrderHash, order.salt],
      ),
    );
    const riskRequest = {
      accountId: order.accountId,
      riskDomainId: setryn.riskDomainId,
      riskDomainVersion: 1,
      openInterestIncreaseBaseUnits: openInterest,
      terminalLiabilityIncreaseBaseUnits: terminalLiability,
      deadline: order.deadline,
      nonce: order.nonce,
      salt: riskSalt,
    } as const;
    const positions = [
      {
        positionId,
        seriesId: order.seriesId,
        seriesVersion: order.targetVersion,
        signedLots: order.side === 1 ? order.lots : -order.lots,
        entryPriceTicks: order.priceTicks,
        maximumTerminalLiabilityBaseUnits: terminalLiability,
        economicsHash,
      },
    ] as const;
    const observations = [{ observationKey: OBSERVATION_KEY, valueHash, observedAt: block.timestamp }] as const;
    const requestHash = keccak256(
      encodeAbiParameters(
        [
          { name: "typeHash", type: "bytes32" },
          {
            name: "request",
            type: "tuple",
            components: [
              { name: "accountId", type: "bytes32" },
              { name: "riskDomainId", type: "bytes32" },
              { name: "riskDomainVersion", type: "uint32" },
              { name: "openInterestIncreaseBaseUnits", type: "uint128" },
              { name: "terminalLiabilityIncreaseBaseUnits", type: "uint128" },
              { name: "deadline", type: "uint64" },
              { name: "nonce", type: "uint256" },
              { name: "salt", type: "bytes32" },
            ],
          },
          { name: "chainId", type: "uint256" },
          { name: "engine", type: "address" },
        ],
        [REQUEST_TYPEHASH, riskRequest, BigInt(setryn.chainId), setryn.portfolioRiskEngine],
      ),
    );
    const admissionId = keccak256(
      encodeAbiParameters(
        [
          { name: "typeHash", type: "bytes32" },
          { name: "requestHash", type: "bytes32" },
        ],
        [ADMISSION_ID_TYPEHASH, requestHash],
      ),
    );

    const walletClient = createWalletClient({
      account: getAddress(setryn.operator),
      transport: http(setryn.rpcUrl),
    });
    const transactionHash = await walletClient.writeContract({
      account: getAddress(setryn.operator),
      chain: null,
      address: setryn.portfolioRiskEngine,
      abi: riskEngineAbi,
      functionName: "reserveNewRisk",
      args: [riskRequest, positions, observations],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") throw new Error("RISK_RESERVATION_REVERTED");

    return Response.json(
      { admissionId, transactionHash },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Risk reservation failed" }, { status: 422 });
  }
}
