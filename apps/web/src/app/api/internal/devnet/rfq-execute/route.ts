import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Hex,
} from "viem";
import {
  atomicClearingAbi,
  privateRfqBookAbi,
  riskBindingAbi,
  riskEngineAbi,
} from "@/lib/internal-gateway/protocol";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZERO_ID = `0x${"0".repeat(64)}` as Hex;

const positionFundingComponents = [
  { name: "lockId", type: "bytes32" },
  { name: "lockReference", type: "bytes32" },
  { name: "expectedRemainingAmount", type: "uint128" },
  { name: "expectedExpiry", type: "uint64" },
] as const;

const positionCreationComponents = [
  { name: "fillIdentity", type: "bytes32" },
  { name: "seriesId", type: "bytes32" },
  { name: "seriesVersion", type: "uint32" },
  { name: "longAccountId", type: "bytes32" },
  { name: "shortAccountId", type: "bytes32" },
  { name: "ordinal", type: "uint32" },
  { name: "lots", type: "uint128" },
  { name: "entryPriceTicks", type: "int128" },
  { name: "longFunding", type: "tuple", components: positionFundingComponents },
  { name: "shortFunding", type: "tuple", components: positionFundingComponents },
  { name: "payoffTerms", type: "bytes" },
] as const;

const positionEngineAbi = [
  {
    type: "function",
    name: "positionEngineId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "derivePositionId",
    stateMutability: "view",
    inputs: [{ name: "creation", type: "tuple", components: positionCreationComponents }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "deriveLiabilityKey",
    stateMutability: "pure",
    inputs: [
      { name: "positionId", type: "bytes32" },
      { name: "side", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const vaultAbi = [
  {
    type: "function",
    name: "getLock",
    stateMutability: "view",
    inputs: [{ name: "lockId", type: "bytes32" }],
    outputs: [{
      name: "lock",
      type: "tuple",
      components: [
        { name: "accountId", type: "bytes32" },
        { name: "collateralId", type: "bytes32" },
        { name: "assetId", type: "bytes32" },
        { name: "lockReference", type: "bytes32" },
        { name: "operator", type: "address" },
        { name: "bindingVersion", type: "uint32" },
        { name: "expiry", type: "uint64" },
        { name: "settlementOperator", type: "address" },
        { name: "status", type: "uint8" },
        { name: "initialAmount", type: "uint128" },
        { name: "remainingAmount", type: "uint128" },
      ],
    }],
  },
  {
    type: "function",
    name: "deriveTerminalLiabilityReservationId",
    stateMutability: "view",
    inputs: [
      { name: "positionEngine", type: "address" },
      { name: "positionEngineId", type: "bytes32" },
      { name: "positionId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

interface ExecuteRfqBody {
  rfqId?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExecuteRfqBody;
    if (typeof body.rfqId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.rfqId)) {
      return Response.json({ error: "Invalid RFQ identifier" }, { status: 400 });
    }
    const rfqId = body.rfqId as Hex;
    const setryn = await readLocalRuntime();
    const operator = getAddress(setryn.operator);
    const publicClient = createPublicClient({ transport: http(setryn.rpcUrl) });
    const walletClient = createWalletClient({ account: operator, transport: http(setryn.rpcUrl) });
    const rfq = await publicClient.readContract({
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "getRfq",
      args: [rfqId],
    });
    if (rfq.status !== 6 || rfq.selectedQuoteId === ZERO_ID) throw new Error("RFQ_NOT_SUBMITTED");
    const [quote, capacity, sourceCommitment] = await Promise.all([
      publicClient.readContract({
        address: setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "getQuote",
        args: [rfq.selectedQuoteId],
      }),
      publicClient.readContract({
        address: setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "getCapacity",
        args: [rfq.selectedQuoteId],
      }),
      publicClient.readContract({
        address: setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "selectedHandoffCommitment",
        args: [rfqId],
      }),
    ]);
    const executionPriceTicks = rfq.request.sidePolicy === 1
      ? quote.quote.askPriceTicks
      : quote.quote.bidPriceTicks;
    if (executionPriceTicks === BigInt(0)) throw new Error("RFQ_PRICE_UNAVAILABLE");

    const [takerAdmissionId, makerAdmissionId, capacityLock, positionEngineId, fillId] = await Promise.all([
      publicClient.readContract({
        address: setryn.riskAdmissionBindingRegistry,
        abi: riskBindingAbi,
        functionName: "admissionForOrder",
        args: [rfq.request.takerOrderHash],
      }),
      publicClient.readContract({
        address: setryn.riskAdmissionBindingRegistry,
        abi: riskBindingAbi,
        functionName: "admissionForOrder",
        args: [quote.quote.makerOrderHash],
      }),
      publicClient.readContract({
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "getLock",
        args: [capacity.lockId],
      }),
      publicClient.readContract({
        address: setryn.positionEngine,
        abi: positionEngineAbi,
        functionName: "positionEngineId",
      }),
      publicClient.readContract({
        address: setryn.atomicClearingEngine,
        abi: atomicClearingAbi,
        functionName: "previewSeriesFillId",
        args: [
          rfq.request.takerOrderHash,
          quote.quote.makerOrderHash,
          rfq.request.lots,
          executionPriceTicks,
          setryn.payoffTerms,
        ],
      }),
    ]);
    if (takerAdmissionId === ZERO_ID || makerAdmissionId === ZERO_ID) throw new Error("RISK_ADMISSION_MISSING");
    if (capacityLock.remainingAmount !== capacity.remainingLiability) throw new Error("CAPACITY_LOCK_MISMATCH");

    const [takerAdmission, makerAdmission] = await Promise.all([
      publicClient.readContract({
        address: setryn.portfolioRiskEngine,
        abi: riskEngineAbi,
        functionName: "getAdmission",
        args: [takerAdmissionId],
      }),
      publicClient.readContract({
        address: setryn.portfolioRiskEngine,
        abi: riskEngineAbi,
        functionName: "getAdmission",
        args: [makerAdmissionId],
      }),
    ]);
    const takerIsLong = rfq.request.sidePolicy === 1;
    const makerSide = takerIsLong ? 2 : 1;
    const longAccountId = takerIsLong ? rfq.request.takerAccountId : quote.quote.makerAccountId;
    const shortAccountId = takerIsLong ? quote.quote.makerAccountId : rfq.request.takerAccountId;
    const reservationAmount = rfq.request.lots * BigInt(
      makerSide === 1 ? setryn.maxLongDebitMinorPerLot : setryn.maxShortDebitMinorPerLot,
    );
    const capacityFunding = {
      lockId: capacity.lockId,
      lockReference: capacityLock.lockReference,
      expectedRemainingAmount: capacity.remainingLiability,
      expectedExpiry: capacity.expiry,
    } as const;
    const emptyPositionFunding = {
      lockId: ZERO_ID,
      lockReference: ZERO_ID,
      expectedRemainingAmount: BigInt(0),
      expectedExpiry: BigInt(0),
    } as const;
    const positionCreation = {
      fillIdentity: fillId,
      seriesId: rfq.request.seriesId,
      seriesVersion: rfq.request.targetVersion,
      longAccountId,
      shortAccountId,
      ordinal: 0,
      lots: rfq.request.lots,
      entryPriceTicks: executionPriceTicks,
      longFunding: makerSide === 1 ? capacityFunding : emptyPositionFunding,
      shortFunding: makerSide === 2 ? capacityFunding : emptyPositionFunding,
      payoffTerms: setryn.payoffTerms,
    } as const;
    const positionId = await publicClient.readContract({
      address: setryn.positionEngine,
      abi: positionEngineAbi,
      functionName: "derivePositionId",
      args: [positionCreation],
    });
    const liabilityKey = await publicClient.readContract({
      address: setryn.positionEngine,
      abi: positionEngineAbi,
      functionName: "deriveLiabilityKey",
      args: [positionId, makerSide],
    });
    const reservationId = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "deriveTerminalLiabilityReservationId",
      args: [setryn.positionEngine, positionEngineId, liabilityKey],
    });

    const zeroOrderFunding = { terminalLiabilityLockId: ZERO_ID, considerationLockId: ZERO_ID } as const;
    const zeroFeeFunding = { consumptionId: ZERO_ID, chargeLockId: ZERO_ID, budgetLockId: ZERO_ID } as const;
    const longAdmissionId = takerIsLong ? takerAdmissionId : makerAdmissionId;
    const shortAdmissionId = takerIsLong ? makerAdmissionId : takerAdmissionId;
    const longAdmissionResultHash = takerIsLong ? takerAdmission.resultHash : makerAdmission.resultHash;
    const shortAdmissionResultHash = takerIsLong ? makerAdmission.resultHash : takerAdmission.resultHash;
    const deadline = rfq.request.deadline < quote.quote.deadline ? rfq.request.deadline : quote.quote.deadline;
    const consumptionId = keccak256(stringToHex(`${rfqId}:${rfq.selectedQuoteId}:${fillId}:handoff`));
    const clearingRequest = {
      matchData: {
        takerOrderHash: rfq.request.takerOrderHash,
        makerOrderHash: quote.quote.makerOrderHash,
        fillLots: rfq.request.lots,
        executionPriceTicks,
        longAdmissionId,
        longAdmissionResultHash,
        shortAdmissionId,
        shortAdmissionResultHash,
        takerFunding: zeroOrderFunding,
        makerFunding: zeroOrderFunding,
        takerFeeFunding: zeroFeeFunding,
        makerFeeFunding: zeroFeeFunding,
      },
      payoffTerms: setryn.payoffTerms,
      channelKind: 2,
    } as const;
    const claim = {
      kind: 1,
      consumptionId,
      sourceId: rfqId,
      sourceVersion: 1,
      sourceCommitment,
      takerOrderHash: rfq.request.takerOrderHash,
      makerOrderHash: quote.quote.makerOrderHash,
      takerAccountId: rfq.request.takerAccountId,
      makerAccountId: quote.quote.makerAccountId,
      takerSide: takerIsLong ? 1 : 2,
      targetKind: 1,
      seriesId: rfq.request.seriesId,
      packageId: ZERO_ID,
      targetVersion: rfq.request.targetVersion,
      selectedQuoteOrRouteId: rfq.selectedQuoteId,
      packageWitnessHash: ZERO_ID,
      packageLegs: [],
      fillLots: rfq.request.lots,
      executionPriceTicks,
      feeScheduleId: rfq.request.feeScheduleId,
      feeScheduleVersion: rfq.request.feeScheduleVersion,
      takerMaximumFeeMinor: rfq.request.maxFeeMinor,
      makerMaximumFeeMinor: quote.quote.maxFeeMinor,
      makerFeeFunding: zeroFeeFunding,
      takerFeeFunding: zeroFeeFunding,
      riskDomainId: rfq.request.riskDomainId,
      riskDomainVersion: rfq.request.riskDomainVersion,
      executionModeId: rfq.request.executionModeId,
      longAdmissionId,
      longAdmissionResultHash,
      shortAdmissionId,
      shortAdmissionResultHash,
      deadline,
      capacityDispositions: [{
        positionOrdinal: 0,
        side: makerSide,
        accountId: quote.quote.makerAccountId,
        funding: capacityFunding,
        reservationAmount,
        capacityDisposition: 1,
        reservationId,
        unusedCapacityPolicy: 2,
      }],
    } as const;
    const hash = await walletClient.writeContract({
      account: operator,
      chain: null,
      address: setryn.atomicClearingEngine,
      abi: atomicClearingAbi,
      functionName: "clearSeriesWithHandoff",
      args: [clearingRequest, claim],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("RFQ_CLEARING_FAILED");
    const positionEvents = parseEventLogs({
      abi: atomicClearingAbi,
      eventName: "FillPositionCreated",
      logs: receipt.logs,
      strict: true,
    });
    const ledgerEvents = parseEventLogs({
      abi: atomicClearingAbi,
      eventName: "FillLedgerEntry",
      logs: receipt.logs,
      strict: true,
    });
    const createdPositionId = positionEvents[0]?.args.positionId;
    if (!createdPositionId || createdPositionId !== positionId) throw new Error("RFQ_CLEARING_EVIDENCE_MISSING");
    const takerFeeMinor = ledgerEvents.find(
      (event) => event.args.fillId === fillId && event.args.kind === 3,
    )?.args.amount ?? BigInt(0);
    return Response.json({
      fillId,
      positionId,
      transactionHash: hash,
      executionPriceTicks: executionPriceTicks.toString(),
      fillLots: rfq.request.lots.toString(),
      takerFeeMinor: takerFeeMinor.toString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RFQ_EXECUTION_FAILED";
    return Response.json({ error: message }, { status: 422 });
  }
}
