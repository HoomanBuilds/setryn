import { encodeAbiParameters, keccak256, stringToHex, verifyTypedData, type Hex } from "viem";
import { operatorSigner } from "./operator-signer";
import { orderStateAbi, publicOrderTypedData, type OnchainPublicOrder } from "./protocol";
import type { SetrynRuntime } from "./runtime";
import { runtimeMarketBySeries } from "./runtime-markets";

/*
 * Operator-side portfolio risk admission for one signed order (PortfolioRiskEngine.reserveNewRisk, RISK_CONSUMER_ROLE).
 * The admission commits to the order's own series liability bound, so the order can be bound to it and cleared.
 */

const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
/*
 * Namespace and observation preimages are protocol constants shared with services/operator-runtime and the risk
 * adapter's evidence, so they keep their original wording.
 */
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
/** The latest deadline a reservation admits, relative to the chain clock. */
const MAX_ORDER_WINDOW_SECONDS = BigInt(300);

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

const riskRequestComponents = [
  { name: "accountId", type: "bytes32" },
  { name: "riskDomainId", type: "bytes32" },
  { name: "riskDomainVersion", type: "uint32" },
  { name: "openInterestIncreaseBaseUnits", type: "uint128" },
  { name: "terminalLiabilityIncreaseBaseUnits", type: "uint128" },
  { name: "deadline", type: "uint64" },
  { name: "nonce", type: "uint256" },
  { name: "salt", type: "bytes32" },
] as const;

const riskEngineAbi = [
  {
    type: "error",
    name: "RiskRequestExpired",
    inputs: [
      { name: "deadline", type: "uint64" },
      { name: "currentTimestamp", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "reserveNewRisk",
    stateMutability: "nonpayable",
    inputs: [
      { name: "request", type: "tuple", components: riskRequestComponents },
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

/** A refusal the caller can show as is: the order is outside the market, misidentified, or mis-signed. */
export class RiskAdmissionRefusal extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RiskAdmissionRefusal";
    this.status = status;
  }
}

/**
 * Reserves portfolio risk for one signed order as the operator and returns the admission id. Throws
 * RiskAdmissionRefusal for an order the platform will not admit, SignerUnavailableError when no operator can sign, and
 * the chain's error when the risk engine refuses.
 */
export async function reserveOrderRisk(
  setryn: SetrynRuntime,
  order: OnchainPublicOrder,
  signature: Hex,
  orderHash: Hex,
): Promise<{ admissionId: Hex; transactionHash: Hex }> {
  // The order's series names its market; every liability bound below is that series' own.
  const market = runtimeMarketBySeries(setryn, order.seriesId);
  if (
    !market ||
    order.packageId !== ZERO_ID ||
    order.feeScheduleId.toLowerCase() !== setryn.feeScheduleId.toLowerCase() ||
    ![setryn.executionModeId.toLowerCase(), setryn.privateRfqExecutionModeId.toLowerCase()].includes(order.executionModeId.toLowerCase()) ||
    order.actionId.toLowerCase() !== setryn.enterActionId.toLowerCase() ||
    order.permittedExecutor.toLowerCase() !== setryn.atomicClearingEngine.toLowerCase()
  ) {
    throw new RiskAdmissionRefusal(400, "Order is outside the active market");
  }
  const validSignature = await verifyTypedData({
    address: order.signer,
    domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.orderState },
    types: publicOrderTypedData,
    primaryType: "PublicOrder",
    message: order,
    signature,
  });
  if (!validSignature) throw new RiskAdmissionRefusal(401, "Invalid order signature");

  const operator = await operatorSigner(setryn);
  const { publicClient, walletClient } = operator;
  const [canonicalOrderHash, canonicalAccountId, block] = await Promise.all([
    publicClient.readContract({ address: setryn.orderState, abi: orderStateAbi, functionName: "hashOrder", args: [order] }),
    publicClient.readContract({ address: setryn.collateralVault, abi: vaultAbi, functionName: "deriveAccountId", args: [order.signer, ACCOUNT_SALT] }),
    publicClient.getBlock({ blockTag: "pending" }),
  ]);
  if (canonicalOrderHash.toLowerCase() !== orderHash.toLowerCase() || canonicalAccountId.toLowerCase() !== order.accountId.toLowerCase()) {
    throw new RiskAdmissionRefusal(400, "Signed order identity mismatch");
  }
  if (order.deadline <= block.timestamp || order.deadline > block.timestamp + MAX_ORDER_WINDOW_SECONDS) {
    throw new RiskAdmissionRefusal(400, "Risk reservation deadline is outside the live window");
  }

  const liabilityPerLot = BigInt(order.side === 1 ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot);
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
    openInterestIncreaseBaseUnits: order.lots,
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
        { name: "request", type: "tuple", components: riskRequestComponents },
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

  // Simulate first so a refusal carries the risk engine's revert reason into the server log.
  await publicClient.simulateContract({
    account: operator.address,
    blockTag: "pending",
    address: setryn.portfolioRiskEngine,
    abi: riskEngineAbi,
    functionName: "reserveNewRisk",
    args: [riskRequest, positions, observations],
  });
  const transactionHash = await walletClient.writeContract({
    chain: null,
    address: setryn.portfolioRiskEngine,
    abi: riskEngineAbi,
    functionName: "reserveNewRisk",
    args: [riskRequest, positions, observations],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error("RISK_RESERVATION_REVERTED");
  return { admissionId, transactionHash };
}
