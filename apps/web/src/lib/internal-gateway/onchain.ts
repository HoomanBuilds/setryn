import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  formatUnits,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseUnits,
  parseEventLogs,
  parseAbi,
  stringToHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { executableAction, limitCrosses } from "@/lib/terminal/economics";
import { formatLotCount } from "@/lib/terminal/format";
import {
  accountFeesPaidMinor,
  orderStateAbi,
  atomicClearingAbi,
  fundedFeeLedgerAbi,
  privateRfqBookAbi,
  privateRfqRequestTypedData,
  publicOrderBookAbi,
  publicOrderTypedData,
  rfqSelectionTypedData,
  riskBindingAbi,
  riskEngineAbi,
  serializePublicOrder,
  type OnchainPublicOrder,
  type OnchainPrivateRfqRequest,
  type OnchainRfqSelection,
} from "./protocol";
import { loadSetrynRuntime, type SetrynRuntime } from "./runtime";
import type {
  CollateralIntent,
  CollateralIntentResult,
  ExecutionReceipt,
  GatewaySnapshot,
  InternalTradingGateway,
  LocalMakerQuoteInput,
  PackageExecutionResult,
  PackageOrderIntent,
  RestingPackageOrder,
  RfqRequest,
  SignedOrderAuthorization,
  SubmissionUpdate,
} from "./types";

const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
const EMPTY_ID = `0x${"0".repeat(64)}` as Hex;
const PRIMARY_MARKET_ID = "BTC-YC-24DEC26";
const PRIMARY_CONTRACT_MULTIPLIER = 2.5;
const CONSIDERATION_ENTRY = 1;

interface LedgerFlow {
  args: { fillId?: Hex; kind?: number; payerAccountId?: Hex; receiverAccountId?: Hex; amount?: bigint };
}

/** Consideration the account received minus what it paid on one fill, in USD, read from the clearing ledger. */
function netConsiderationUsd(events: readonly LedgerFlow[], fillId: string, accountId: string): number {
  let net = BigInt(0);
  for (const { args } of events) {
    if (args.fillId?.toLowerCase() !== fillId.toLowerCase() || args.kind !== CONSIDERATION_ENTRY || args.amount == null) continue;
    if (args.receiverAccountId?.toLowerCase() === accountId.toLowerCase()) net += args.amount;
    if (args.payerAccountId?.toLowerCase() === accountId.toLowerCase()) net -= args.amount;
  }
  return Number(formatUnits(net, 6));
}
const LOCAL_CHAIN_ID = 31337;
/** Seconds a maker order must remain live past the latest block so it cannot expire before the match lands. */
const MAKER_DEADLINE_MARGIN_SECONDS = BigInt(15);
const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
const BOOK_ID_TYPEHASH = keccak256(
  stringToHex(
    "SetrynDirectBookV1(uint256 chainId,address book,address orderState,uint8 targetKind,bytes32 targetId,uint32 targetVersion,bytes32 executionModeId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 packageLegsHash)",
  ),
);

const lifecycleInputStruct = "struct LifecycleInput { bytes32 positionId; bytes32 expectedImmutableHash; bytes32 expectedLifecycleHash; uint128 expectedPositionLots; uint128 actionLots; }";
const lifecycleSuccessorStruct = "struct LifecycleSuccessor { bytes32 successorKey; bytes32 seriesId; uint32 seriesVersion; bytes32 longAccountId; bytes32 shortAccountId; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 collateralId; uint128 lots; int128 entryPriceTicks; bytes32 economicsHash; bytes32 packageProvenanceHash; uint128 longTerminalLiabilityBaseUnits; uint128 shortTerminalLiabilityBaseUnits; }";
const lifecycleReplacementStruct = "struct LifecycleCollateralReplacement { bytes32 accountId; bytes32 collateralId; uint128 terminalLiabilityBaseUnits; }";
const lifecycleConsentStruct = "struct LifecycleConsent { bytes32 actionId; bytes32 accountId; address signer; uint256 nonce; uint64 deadline; uint128 maximumLiabilityIncreaseBaseUnits; uint128 maximumCollateralIncreaseBaseUnits; bool allowsPackageBreak; bytes32 salt; }";
const lifecycleActionStruct = "struct LifecycleAction { uint8 kind; address actor; bytes32 actorAccountId; bytes32 policyContextHash; bytes32 inputsHash; bytes32 successorsHash; bytes32 collateralReplacementsHash; bytes32 participantSetHash; bytes32 consentsHash; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 feeScheduleId; uint32 feeScheduleVersion; bytes32 economicTransitionHash; bytes32 compressionPlanId; bool breaksPackageProvenance; bytes32 packageBreakPermissionHash; uint128 actorMaximumLiabilityIncreaseBaseUnits; uint128 actorMaximumCollateralIncreaseBaseUnits; uint16 inputCount; uint16 successorCount; uint16 participantCount; uint64 deadline; uint256 nonce; address permittedExecutor; bytes32 salt; }";
const lifecycleSnapshotStruct = "struct LifecyclePositionSnapshot { bytes32 positionId; bytes32 immutableHash; bytes32 lifecycleHash; bytes32 seriesId; uint32 seriesVersion; bytes32 longAccountId; bytes32 shortAccountId; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 feeScheduleId; uint32 feeScheduleVersion; bytes32 collateralId; uint128 positionLots; uint128 remainingExerciseLots; int128 entryPriceTicks; bytes32 economicsHash; bytes32 packageProvenanceHash; bytes32 exercisePolicyId; uint8 exerciseState; uint128 automaticExerciseThresholdMinor; uint64 expiryAt; uint64 exerciseOpensAt; uint64 exerciseCutoffAt; uint64 lapseEligibleAt; uint128 longTerminalLiabilityBaseUnits; uint128 shortTerminalLiabilityBaseUnits; }";

const positionLifecycleAbi = parseAbi([
  lifecycleSnapshotStruct,
  "function getLifecyclePosition(bytes32 positionId) view returns (LifecyclePositionSnapshot snapshot)",
  "function positionStatus(bytes32 positionId) view returns (uint8)",
  "event PositionQuantityChanged(bytes32 indexed positionId, uint128 remainingLots, uint128 exercisedLots, uint128 closedLots, uint64 lifecycleNonce, bytes32 indexed transitionReference)",
]);
const lifecyclePolicyAbi = parseAbi([
  lifecycleActionStruct,
  lifecycleSnapshotStruct,
  lifecycleSuccessorStruct,
  "function derivePolicyContext(LifecycleAction action, LifecyclePositionSnapshot[] inputs, LifecycleSuccessor[] successors) view returns (bytes32 policyContextHash, bytes32 packageBreakPermissionHash)",
]);
const signedLifecycleAbi = parseAbi([
  lifecycleActionStruct,
  lifecycleInputStruct,
  lifecycleSuccessorStruct,
  lifecycleReplacementStruct,
  lifecycleConsentStruct,
  "function hashLifecycleInputs(LifecycleInput[] inputs) pure returns (bytes32)",
  "function hashLifecycleSuccessors(LifecycleSuccessor[] successors) pure returns (bytes32)",
  "function hashLifecycleCollateralReplacements(LifecycleCollateralReplacement[] replacements) pure returns (bytes32)",
  "function hashLifecycleParticipantSet(bytes32 actorAccountId, LifecycleConsent[] consents) pure returns (bytes32)",
  "function hashLifecycleConsentTerms(LifecycleConsent[] consents) pure returns (bytes32)",
  "function hashLifecycleAction(LifecycleAction action) view returns (bytes32 actionHash, bytes32 actionId, bytes32 digest)",
  "function authorizeAction(LifecycleAction action, LifecycleInput[] inputs, LifecycleSuccessor[] successors, LifecycleCollateralReplacement[] collateralReplacements, LifecycleConsent[] consents, bytes[] consentSignatures, bytes actorSignature) returns (bytes32 actionId)",
  "function executeAction(LifecycleAction action, LifecycleInput[] inputs, LifecycleSuccessor[] successors, LifecycleCollateralReplacement[] collateralReplacements, LifecycleConsent[] consents) returns (bytes32 outcomeHash)",
]);

const lifecycleActionTypes = {
  SetrynLifecycleActionV1: [
    { name: "kind", type: "uint8" },
    { name: "actor", type: "address" },
    { name: "actorAccountId", type: "bytes32" },
    { name: "policyContextHash", type: "bytes32" },
    { name: "inputsHash", type: "bytes32" },
    { name: "successorsHash", type: "bytes32" },
    { name: "collateralReplacementsHash", type: "bytes32" },
    { name: "participantSetHash", type: "bytes32" },
    { name: "consentsHash", type: "bytes32" },
    { name: "riskDomainId", type: "bytes32" },
    { name: "riskDomainVersion", type: "uint32" },
    { name: "feeScheduleId", type: "bytes32" },
    { name: "feeScheduleVersion", type: "uint32" },
    { name: "economicTransitionHash", type: "bytes32" },
    { name: "compressionPlanId", type: "bytes32" },
    { name: "breaksPackageProvenance", type: "bool" },
    { name: "packageBreakPermissionHash", type: "bytes32" },
    { name: "actorMaximumLiabilityIncreaseBaseUnits", type: "uint128" },
    { name: "actorMaximumCollateralIncreaseBaseUnits", type: "uint128" },
    { name: "inputCount", type: "uint16" },
    { name: "successorCount", type: "uint16" },
    { name: "participantCount", type: "uint16" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "permittedExecutor", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "engine", type: "address" },
  ],
} as const;

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
    name: "deriveCollateralId",
    stateMutability: "view",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
    ],
    outputs: [{ name: "collateralId", type: "bytes32" }],
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "collateralId", type: "bytes32" },
    ],
    outputs: [
      { name: "total", type: "uint128" },
      { name: "locked", type: "uint128" },
      { name: "available", type: "uint128" },
    ],
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
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
      { name: "accountId", type: "bytes32" },
      { name: "amount", type: "uint128" },
      { name: "recipient", type: "address" },
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
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
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

function initialSnapshot(): GatewaySnapshot {
  return {
    environment: { id: "LOCAL_DEVNET", label: "Local devnet", chainId: 31337, evidence: "DEVNET" },
    wallet: { status: "DISCONNECTED", address: null, chainId: null },
    account: {
      id: EMPTY_ID,
      label: "Primary account",
      riskDomain: "BTC/USD isolated",
      collateralAsset: "sUSD",
      posted: 0,
      eligible: 0,
      reserved: 0,
      available: 0,
      equity: 0,
    },
    positions: [],
    receipts: [],
    executions: [],
    restingOrders: [],
    publicBookMarketId: PRIMARY_MARKET_ID,
    publicBookEconomics: null,
    publicBookOrders: [],
    rfqRequests: [],
  };
}

function errorCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "number" ? error.code : null;
}

export class OnchainTradingGateway implements InternalTradingGateway {
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private runtimePromise: Promise<SetrynRuntime> | null = null;
  private setryn: SetrynRuntime | null = null;
  private provider: EIP1193Provider | null = null;
  private publicClient: ReturnType<typeof createPublicClient> | null = null;
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private walletAddress: Address | null = null;
  private readonly authorizations = new Map<string, SignedOrderAuthorization>();
  private pollingTimer: number | null = null;
  private polling = false;

  getSnapshot = (): GatewaySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async connectWallet(): Promise<void> {
    const setryn = await this.runtime();
    const injected = window.ethereum as EIP1193Provider | undefined;
    if (!injected) throw new Error("WALLET_UNAVAILABLE");
    this.publish({ ...this.snapshot, wallet: { status: "CONNECTING", address: null, chainId: null } });

    const chainHex = `0x${setryn.chainId.toString(16)}`;
    try {
      await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (error) {
      if (errorCode(error) !== 4902) {
        this.publish({ ...this.snapshot, wallet: { status: "WRONG_NETWORK", address: null, chainId: null } });
        throw error;
      }
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainHex,
            chainName: "Setryn Local Devnet",
            nativeCurrency: { name: "Devnet Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [setryn.rpcUrl],
          },
        ],
      });
    }

    const accounts = (await injected.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts[0]) throw new Error("WALLET_CONNECTION_REJECTED");
    const address = getAddress(accounts[0]);
    this.provider = injected;
    this.walletAddress = address;
    this.walletClient = createWalletClient({ account: address, chain: this.chain(setryn), transport: custom(injected) });
    await this.fundNativeGas(address);
    this.bindProvider(injected);
    this.startPolling();
    this.publish({
      ...this.snapshot,
      wallet: { status: "CONNECTED", address, chainId: setryn.chainId },
    });
    await fetch("/api/internal/devnet/liquidity", { method: "POST" });
    await this.refreshAccount();
    await Promise.all([this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity(), this.refreshRfqs()]);
  }

  async submitCollateralIntent(intent: CollateralIntent): Promise<CollateralIntentResult> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    if (!Number.isFinite(intent.amount) || intent.amount <= 0) throw new Error("INVALID_COLLATERAL_AMOUNT");
    if (intent.asset !== "sUSD") throw new Error("UNSUPPORTED_COLLATERAL_ASSET");
    const accountId = await this.accountId(address);
    if (intent.accountId.toLowerCase() !== accountId.toLowerCase()) throw new Error("ACCOUNT_MISMATCH");
    const amount = parseUnits(intent.amount.toString(), 6);
    await this.fundNativeGas(address);

    const exists = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "accountExists",
      args: [accountId],
    });
    if (!exists) {
      const createHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "createAccount",
        args: [ACCOUNT_SALT],
      });
      await publicClient.waitForTransactionReceipt({ hash: createHash });
    }

    let transactionHash: Hex;
    if (intent.kind === "DEPOSIT") {
      const tokenBalance = await publicClient.readContract({
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [address],
      });
      if (tokenBalance < amount) {
        const mintHash = await walletClient.writeContract({
          account: address,
          chain: this.chain(setryn),
          address: setryn.settlementToken,
          abi: tokenAbi,
          functionName: "mint",
          args: [amount - tokenBalance],
        });
        await publicClient.waitForTransactionReceipt({ hash: mintHash });
      }
      const allowance = await publicClient.readContract({
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "allowance",
        args: [address, setryn.collateralVault],
      });
      if (allowance < amount) {
        const approvalHash = await walletClient.writeContract({
          account: address,
          chain: this.chain(setryn),
          address: setryn.settlementToken,
          abi: tokenAbi,
          functionName: "approve",
          args: [setryn.collateralVault, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      }
      transactionHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "deposit",
        args: [setryn.settlementAssetId, 1, accountId, amount],
      });
    } else {
      const recipient = getAddress(intent.recipient);
      const available = parseUnits(this.snapshot.account.available.toString(), 6);
      if (amount > available) throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      transactionHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "withdraw",
        args: [setryn.settlementAssetId, 1, accountId, amount, recipient],
      });
    }

    await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    await this.refreshAccount();
    return { intentId: transactionHash, kind: intent.kind, amount: intent.amount, status: "COMPLETED" };
  }

  async authorizeOrder(intent: PackageOrderIntent): Promise<SignedOrderAuthorization> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    if (intent.marketId !== PRIMARY_MARKET_ID) throw new Error("MARKET_NOT_ONCHAIN_ENABLED");
    if (intent.recipient.toLowerCase() !== address.toLowerCase()) throw new Error("RECIPIENT_MISMATCH");
    if (intent.marketId !== PRIMARY_MARKET_ID || intent.packageCode !== PRIMARY_MARKET_ID) {
      throw new Error("UNSUPPORTED_ONCHAIN_MARKET");
    }
    if (!Number.isInteger(intent.lots) || intent.lots < 1 || intent.lots > 10) throw new Error("INVALID_LOTS");
    if (intent.side === "EXIT") {
      const closing = this.snapshot.positions.find((position) => position.id === intent.closePositionId);
      if (!closing) throw new Error("CLOSE_POSITION_NOT_FOUND");
      if (closing.marketId !== intent.marketId || closing.side !== intent.packageSide) {
        throw new Error("CLOSE_POSITION_MISMATCH");
      }
      if (closing.lots !== intent.lots) throw new Error("FULL_POSITION_EXIT_REQUIRED");
      if (intent.timeInForce !== "FOK") throw new Error("EXIT_REQUIRES_FOK");
    }
    if (!Number.isFinite(intent.limitPrice)) throw new Error("INVALID_LIMIT_PRICE");
    if (!["GTC", "GTD", "IOC", "FOK"].includes(intent.timeInForce)) throw new Error("INVALID_TIME_IN_FORCE");
    const action = executableAction(intent.side, intent.packageSide);
    const marketable = limitCrosses(intent.limitPrice, intent.executionPrice, action);
    if (intent.orderType === "MARKET" && !marketable) throw new Error("ORDER_NOT_MARKETABLE");

    const accountId = await this.accountId(address);
    if (intent.accountId.toLowerCase() !== accountId.toLowerCase()) throw new Error("ACCOUNT_MISMATCH");
    // A match locks the taker's collateral twice: the clearing engine reserves consideration and the position
    // engine reserves terminal liability. Both must be approved lock operators on the account, as for the maker.
    for (const operator of [setryn.atomicClearingEngine, setryn.positionEngine]) {
      const approved = await publicClient.readContract({
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "isLockOperator",
        args: [accountId, operator],
      });
      if (approved) continue;
      const approvalHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "setLockOperator",
        args: [accountId, operator, true],
      });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      if (approvalReceipt.status !== "success") throw new Error("CLEARING_APPROVAL_FAILED");
    }
    const block = await publicClient.getBlock();
    let lifetime = BigInt(240);
    if (intent.timeInForce === "GTD") {
      const requestedExpiry = intent.expiresAt ? Date.parse(intent.expiresAt) : Number.NaN;
      if (!Number.isFinite(requestedExpiry) || requestedExpiry <= Date.now()) throw new Error("INVALID_GTD_EXPIRY");
      const requestedLifetime = BigInt(Math.max(1, Math.floor((requestedExpiry - Date.now()) / 1000)));
      lifetime = requestedLifetime < lifetime ? requestedLifetime : lifetime;
    }
    const deadline = block.timestamp + lifetime;
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const salt = keccak256(stringToHex(`${address}:${nonce}:${intent.marketId}:${crypto.randomUUID()}`));
    const policyContextHash = keccak256(
      stringToHex(
        `${intent.marketId}:${intent.routeId}:${intent.packageSide}:${intent.timeInForce}:${intent.settlementGuarantee}`,
      ),
    );
    const priceTicks = BigInt(Math.round(intent.limitPrice * 10));
    const int128Min = -(BigInt(1) << BigInt(127));
    const int128Max = (BigInt(1) << BigInt(127)) - BigInt(1);
    if (priceTicks < int128Min || priceTicks > int128Max) throw new Error("INVALID_LIMIT_PRICE");
    const feeMinor = this.toMinorUnits(intent.feeCap);
    const timeInForce =
      intent.timeInForce === "GTC" ? 1 : intent.timeInForce === "GTD" ? 2 : intent.timeInForce === "IOC" ? 3 : 4;
    const order: OnchainPublicOrder = {
      signer: address,
      accountId,
      policyId: PUBLIC_SERIES_POLICY,
      policyContextHash,
      actionId: setryn.enterActionId,
      targetKind: 1,
      seriesId: setryn.seriesId,
      packageId: EMPTY_ID,
      targetVersion: 1,
      side: action === "BUY" ? 1 : 2,
      lots: BigInt(intent.lots),
      priceTicks,
      timeInForce,
      deadline,
      executionModeId:
        intent.disclosure === "PRIVATE_RFQ" ? setryn.privateRfqExecutionModeId : setryn.executionModeId,
      feeScheduleId: setryn.feeScheduleId,
      feeScheduleVersion: 1,
      maxFeeMinor: feeMinor > BigInt(0) ? feeMinor : BigInt(1),
      recipient: address,
      permittedExecutor: setryn.atomicClearingEngine,
      nonce,
      salt,
      allowPartialFills: intent.timeInForce !== "FOK",
      minimumFillLots: BigInt(1),
      remainderPolicy: intent.timeInForce === "IOC" || intent.timeInForce === "FOK" ? 2 : 1,
      postOnly: false,
      reduceOnly: false,
    };
    const signature = await walletClient.signTypedData({
      account: address,
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
    const reservation = await fetch("/api/internal/orders/reserve-risk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: serializePublicOrder(order), signature, orderHash }),
    });
    const reservationResult = (await reservation.json()) as { admissionId?: unknown };
    if (
      !reservation.ok ||
      typeof reservationResult.admissionId !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(reservationResult.admissionId)
    ) {
      throw new Error("RISK_RESERVATION_FAILED");
    }
    const riskAdmissionId = reservationResult.admissionId as Hex;
    const bindingHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "bindOrderRisk",
      args: [order, riskAdmissionId],
    });
    const bindingReceipt = await publicClient.waitForTransactionReceipt({ hash: bindingHash });
    if (bindingReceipt.status !== "success") throw new Error("RISK_BINDING_FAILED");

    const authorization: SignedOrderAuthorization = {
      orderHash,
      signature,
      signer: address,
      nonce: nonce.toString(),
      deadline: new Date(Number(deadline) * 1000).toISOString(),
      intent,
      onchainOrder: order,
      riskAdmissionId,
    };
    this.authorizations.set(orderHash.toLowerCase(), authorization);
    return authorization;
  }

  async submitAuthorizedOrder(
    authorization: SignedOrderAuthorization,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const order = authorization.onchainOrder;
    if (!order || !authorization.riskAdmissionId) throw new Error("INVALID_ONCHAIN_AUTHORIZATION");
    if (authorization.signer.toLowerCase() !== address.toLowerCase()) throw new Error("SIGNER_MISMATCH");

    onUpdate({ step: "AUTHORIZED", label: "Order authorized", detail: "Signature and risk admission are bound." });
    const registrationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "registerSignedOrder",
      args: [order, authorization.signature as Hex],
    });
    const registrationReceipt = await publicClient.waitForTransactionReceipt({ hash: registrationHash });
    if (registrationReceipt.status !== "success") throw new Error("ORDER_REGISTRATION_FAILED");
    onUpdate({
      step: "SUBMITTED",
      label: "Order registered",
      detail: "The signed order is registered onchain and ready for matching.",
      transactionHash: registrationHash,
    });

    const bookId = this.deriveBookId(setryn);
    const makerSide = order.side === 1 ? 2 : 1;
    // The book prunes an expired maker order during matching instead of filling it, so the head order must still be
    // live on the chain clock. On the local devnet an expired head is refreshed once through the devnet maker.
    const readHead = async () => {
      const levelId = await publicClient.readContract({
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "bestLevel",
        args: [bookId, makerSide],
      });
      if (levelId === EMPTY_ID) return null;
      const level = await publicClient.readContract({
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "getPriceLevel",
        args: [levelId],
      });
      const [bookOrder, orderRecord, latest] = await Promise.all([
        publicClient.readContract({
          address: setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "getBookOrder",
          args: [level.headOrderHash],
        }),
        publicClient.readContract({
          address: setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [level.headOrderHash],
        }),
        publicClient.getBlock(),
      ]);
      const live =
        (orderRecord.status === 1 || orderRecord.status === 2) &&
        orderRecord.order.deadline > latest.timestamp + MAKER_DEADLINE_MARGIN_SECONDS;
      return { hash: level.headOrderHash, bookOrder, orderRecord, live };
    };
    let head = await readHead();
    if ((!head || !head.live) && setryn.chainId === LOCAL_CHAIN_ID) {
      await fetch("/api/internal/devnet/liquidity", { method: "POST" }).catch(() => undefined);
      head = await readHead();
    }
    if (!head) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("NO_ONCHAIN_LIQUIDITY");
    }
    if (!head.live) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("MAKER_ORDER_EXPIRED");
    }
    const makerOrderHash = head.hash;
    const makerBookOrder = head.bookOrder;
    const makerOrderRecord = head.orderRecord;
    if (
      authorization.intent.side === "EXIT" &&
      makerOrderRecord.order.signer.toLowerCase() !== setryn.operator.toLowerCase()
    ) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("EXIT_REQUIRES_DEVNET_MAKER");
    }
    const crosses = order.side === 1 ? order.priceTicks >= makerBookOrder.priceTicks : order.priceTicks <= makerBookOrder.priceTicks;
    if (!crosses) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("ORDER_NOT_MARKETABLE");
    }
    const fillLots = order.lots < makerBookOrder.remainingLots ? order.lots : makerBookOrder.remainingLots;
    if (order.timeInForce === 4 && fillLots !== order.lots) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("FOK_NOT_FILLED");
    }

    const makerAdmissionId = await publicClient.readContract({
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "admissionForOrder",
      args: [makerOrderHash],
    });
    if (makerAdmissionId === EMPTY_ID) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("MAKER_RISK_ADMISSION_MISSING");
    }
    const [takerAdmission, makerAdmission] = await Promise.all([
      publicClient.readContract({
        address: setryn.portfolioRiskEngine,
        abi: riskEngineAbi,
        functionName: "getAdmission",
        args: [authorization.riskAdmissionId as Hex],
      }),
      publicClient.readContract({
        address: setryn.portfolioRiskEngine,
        abi: riskEngineAbi,
        functionName: "getAdmission",
        args: [makerAdmissionId],
      }),
    ]);
    const takerIsLong = order.side === 1;
    const zeroOrderFunding = { terminalLiabilityLockId: EMPTY_ID, considerationLockId: EMPTY_ID } as const;
    const zeroFeeFunding = { consumptionId: EMPTY_ID, chargeLockId: EMPTY_ID, budgetLockId: EMPTY_ID } as const;
    const proposal = {
      matchData: {
        takerOrderHash: authorization.orderHash as Hex,
        makerOrderHash,
        fillLots,
        executionPriceTicks: makerBookOrder.priceTicks,
        longAdmissionId: takerIsLong ? (authorization.riskAdmissionId as Hex) : makerAdmissionId,
        longAdmissionResultHash: takerIsLong ? takerAdmission.resultHash : makerAdmission.resultHash,
        shortAdmissionId: takerIsLong ? makerAdmissionId : (authorization.riskAdmissionId as Hex),
        shortAdmissionResultHash: takerIsLong ? makerAdmission.resultHash : takerAdmission.resultHash,
        takerFunding: zeroOrderFunding,
        makerFunding: zeroOrderFunding,
        takerFeeFunding: zeroFeeFunding,
        makerFeeFunding: zeroFeeFunding,
      },
      payoffTerms: setryn.payoffTerms,
      channelKind: 1,
    } as const;
    const matchHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "matchSeries",
      args: [bookId, [proposal]],
    });
    const matchReceipt = await publicClient.waitForTransactionReceipt({ hash: matchHash });
    if (matchReceipt.status !== "success") {
      // Nothing filled, so the registered taker order and its risk reservation must not be left behind.
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("MATCH_FAILED");
    }
    onUpdate({
      step: "INCLUDED",
      label: "Match included",
      detail: "The public book cleared the best resting order atomically.",
      transactionHash: matchHash,
    });

    const matchEvents = parseEventLogs({
      abi: publicOrderBookAbi,
      eventName: "DirectMatchExecuted",
      logs: matchReceipt.logs,
      strict: true,
    });
    const positionEvents = parseEventLogs({
      abi: atomicClearingAbi,
      eventName: "FillPositionCreated",
      logs: matchReceipt.logs,
      strict: true,
    });
    const ledgerEvents = parseEventLogs({
      abi: atomicClearingAbi,
      eventName: "FillLedgerEntry",
      logs: matchReceipt.logs,
      strict: true,
    });
    const fillId = matchEvents[0]?.args.fillId;
    const positionId = positionEvents[0]?.args.positionId;
    if (!fillId || !positionId) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("CLEARING_EVIDENCE_MISSING");
    }
    const filledLots = Number(fillLots);
    const requestedLots = Number(order.lots);
    const remainingLots = requestedLots - filledLots;
    if (remainingLots > 0 && (order.timeInForce === 1 || order.timeInForce === 2)) {
      const hint = await this.levelHint(bookId, order.side, order.priceTicks);
      const placementHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "placeSeriesOrder",
        args: [authorization.orderHash as Hex, hint],
      });
      const placementReceipt = await publicClient.waitForTransactionReceipt({ hash: placementHash });
      if (placementReceipt.status !== "success") throw new Error("REMAINDER_PLACEMENT_FAILED");
    } else if (remainingLots > 0 && order.timeInForce === 3) {
      await this.releaseRiskReservation(authorization);
    }
    const executionPrice = Number(makerBookOrder.priceTicks) / 10;
    const packageSide = authorization.intent.packageSide;
    const createdPositionSide: "LONG" | "SHORT" = order.side === 1 ? "LONG" : "SHORT";
    let lifecycleHash: Hex | null = null;
    if (authorization.intent.side === "EXIT") {
      if (!authorization.intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
      onUpdate({
        step: "POSITION_UPDATED",
        label: "Close hedge filled",
        detail: "The opposite-side fill is complete. Releasing both position liabilities.",
        transactionHash: matchHash,
      });
      lifecycleHash = await this.completeFullExit(
        authorization.intent.closePositionId as Hex,
        positionId,
      );
    }
    const position = {
      id: positionId,
      marketId: authorization.intent.marketId,
      side: createdPositionSide,
      lots: filledLots,
      entryPrice: executionPrice,
      collateral:
        filledLots *
        Number(createdPositionSide === "LONG" ? setryn.maxLongDebitMinorPerLot : setryn.maxShortDebitMinorPerLot) /
        1_000_000,
      state: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
    const feeEvents = parseEventLogs({
      abi: fundedFeeLedgerAbi,
      eventName: "FeeLedgerEntryRecorded",
      logs: matchReceipt.logs,
      strict: true,
    });
    const takerFeeMinor = (ledgerEvents.find(
      (event) => event.args.fillId === fillId && event.args.kind === 3,
    )?.args.amount ?? BigInt(0)) + accountFeesPaidMinor(feeEvents, order.accountId);
    const closedPosition = authorization.intent.side === "EXIT"
      ? this.snapshot.positions.find((candidate) => candidate.id === authorization.intent.closePositionId) ?? null
      : null;
    const realizedPnlUsd = closedPosition ? await this.exitRealizedPnlUsd(closedPosition.id, fillId) : undefined;
    const receipt: ExecutionReceipt = {
      id: fillId,
      orderHash: authorization.orderHash,
      fillId,
      transactionHash: matchHash,
      marketId: authorization.intent.marketId,
      packageCode: authorization.intent.packageCode,
      packageSide,
      routeLabel: "Direct package book",
      lots: filledLots,
      requestedLots,
      filledLots,
      cancelledLots: order.timeInForce === 3 || order.timeInForce === 4 ? requestedLots - filledLots : 0,
      price: executionPrice,
      fees: Number(formatUnits(takerFeeMinor, 6)),
      realizedPnlUsd,
      collateralReleasedUsd: closedPosition ? closedPosition.collateral + position.collateral : undefined,
      guarantee: "Atomic onchain settlement",
      evidence: "DEVNET",
      createdAt: new Date().toISOString(),
    };
    const result: PackageExecutionResult = {
      fillId,
      outcome: authorization.intent.side === "EXIT" ? "CLOSED" : "OPENED",
      requestedLots,
      filledLots,
      cancelledLots: receipt.cancelledLots,
      position: authorization.intent.side === "EXIT" ? null : position,
      closedPositionId: authorization.intent.side === "EXIT" ? authorization.intent.closePositionId : null,
      closedLots: authorization.intent.side === "EXIT" ? filledLots : 0,
      receipt,
    };
    const updates: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "Order authorized", detail: "Signature and risk admission are bound." },
      { step: "SUBMITTED", label: "Order registered", detail: "Signed order registered onchain.", transactionHash: registrationHash },
      { step: "INCLUDED", label: "Match included", detail: "Best public liquidity cleared atomically.", transactionHash: matchHash },
      { step: "FILLED", label: "Package filled", detail: `${formatLotCount(filledLots)} filled at ${executionPrice.toFixed(1)}.`, transactionHash: matchHash },
      authorization.intent.side === "EXIT"
        ? { step: "POSITION_CLOSED", label: "Position closed", detail: "Original and close-fill positions were fully unwound onchain.", transactionHash: lifecycleHash ?? matchHash }
        : { step: "POSITION_CREATED", label: "Position created", detail: `Position ${positionId} is active.`, transactionHash: matchHash },
      { step: "RECEIPT_READY", label: "Receipt ready", detail: `Fill ${fillId} is verifiable onchain.`, transactionHash: matchHash },
    ];
    const execution = { id: fillId, orderHash: authorization.orderHash, updates, result, createdAt: receipt.createdAt };
    this.publish({
      ...this.snapshot,
      positions: authorization.intent.side === "EXIT"
        ? this.snapshot.positions.filter((candidate) => candidate.id !== authorization.intent.closePositionId)
        : [...this.snapshot.positions, position],
      receipts: [...this.snapshot.receipts, receipt],
      executions: [...this.snapshot.executions, execution],
    });
    await Promise.all([this.refreshAccount(), this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity()]);
    return result;
  }

  async placeRestingOrder(authorization: SignedOrderAuthorization): Promise<RestingPackageOrder> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const order = authorization.onchainOrder;
    if (!order || !authorization.riskAdmissionId) throw new Error("INVALID_ONCHAIN_AUTHORIZATION");
    if (authorization.signer.toLowerCase() !== address.toLowerCase()) throw new Error("SIGNER_MISMATCH");
    if (order.timeInForce !== 1 && order.timeInForce !== 2) throw new Error("RESTING_TIME_IN_FORCE_REQUIRED");

    const registrationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "registerSignedOrder",
      args: [order, authorization.signature as Hex],
    });
    const registrationReceipt = await publicClient.waitForTransactionReceipt({ hash: registrationHash });
    if (registrationReceipt.status !== "success") throw new Error("ORDER_REGISTRATION_FAILED");

    const bookId = this.deriveBookId(setryn);
    const hint = await this.levelHint(bookId, order.side, order.priceTicks);
    const placementHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "placeSeriesOrder",
      args: [authorization.orderHash as Hex, hint],
    });
    const placementReceipt = await publicClient.waitForTransactionReceipt({ hash: placementHash });
    if (placementReceipt.status !== "success") throw new Error("ORDER_PLACEMENT_FAILED");

    const now = new Date().toISOString();
    const restingOrder: RestingPackageOrder = {
      id: authorization.orderHash,
      orderHash: authorization.orderHash,
      accountId: authorization.intent.accountId,
      marketId: authorization.intent.marketId,
      packageCode: authorization.intent.packageCode,
      routeId: authorization.intent.routeId,
      routeLabel: authorization.intent.routeLabel,
      side: authorization.intent.side,
      packageSide: authorization.intent.packageSide,
      lots: authorization.intent.lots,
      filledLots: 0,
      remainingLots: authorization.intent.lots,
      limitPrice: authorization.intent.limitPrice,
      timeInForce: authorization.intent.timeInForce,
      expiresAt: authorization.deadline,
      collateralReservation: authorization.intent.collateralRequired,
      remainingCollateralReservation: authorization.intent.collateralRequired,
      feeCap: authorization.intent.feeCap,
      remainingFeeCap: authorization.intent.feeCap,
      fillIds: [],
      receiptIds: [],
      closePositionId: authorization.intent.closePositionId,
      replacesOrderId: authorization.intent.replacesOrderId,
      createdAt: now,
      state: "WORKING",
      orderType: authorization.intent.orderType,
      contractMultiplier: authorization.intent.contractMultiplier,
      settlementGuarantee: authorization.intent.settlementGuarantee,
      disclosure: authorization.intent.disclosure,
      recipient: authorization.intent.recipient,
      collateralRequired: authorization.intent.collateralRequired,
    };
    this.publish({ ...this.snapshot, restingOrders: [...this.snapshot.restingOrders, restingOrder] });
    await Promise.all([this.refreshAccount(), this.refreshPublicBook()]);
    return restingOrder;
  }

  async replaceRestingOrder(
    oldOrderId: string,
    authorization: SignedOrderAuthorization,
  ): Promise<RestingPackageOrder> {
    const cancelled = await this.cancelRestingOrder(oldOrderId);
    const replacement = await this.placeRestingOrder(authorization);
    const replacedAt = new Date().toISOString();
    const replaced = { ...cancelled, state: "REPLACED" as const, replacedByOrderId: replacement.id, replacedAt };
    this.publish({
      ...this.snapshot,
      restingOrders: this.snapshot.restingOrders.map((order) => (order.id === oldOrderId ? replaced : order)),
    });
    return replacement;
  }

  async cancelRestingOrder(orderId: string): Promise<RestingPackageOrder> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const current = this.snapshot.restingOrders.find((order) => order.id === orderId);
    if (!current) throw new Error("RESTING_ORDER_NOT_FOUND");
    if (current.state !== "WORKING" && current.state !== "PARTIALLY_FILLED") {
      throw new Error("RESTING_ORDER_NOT_WORKING");
    }
    const authorization = this.authorizations.get(current.orderHash.toLowerCase());
    if (!authorization?.onchainOrder || !authorization.riskAdmissionId) {
      throw new Error("ORDER_AUTHORIZATION_UNAVAILABLE");
    }
    const orderHash = current.orderHash as Hex;
    const cancelHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "cancelOrder",
      args: [orderHash],
    });
    const cancelReceipt = await publicClient.waitForTransactionReceipt({ hash: cancelHash });
    if (cancelReceipt.status !== "success") throw new Error("ORDER_CANCELLATION_FAILED");
    const syncHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "syncOrder",
      args: [orderHash],
    });
    const syncReceipt = await publicClient.waitForTransactionReceipt({ hash: syncHash });
    if (syncReceipt.status !== "success") throw new Error("ORDER_BOOK_SYNC_FAILED");
    await this.releaseRiskReservation(authorization);

    const cancelled: RestingPackageOrder = {
      ...current,
      state: "CANCELLED",
      remainingCollateralReservation: 0,
      remainingFeeCap: 0,
      cancelledAt: new Date().toISOString(),
    };
    this.publish({
      ...this.snapshot,
      restingOrders: this.snapshot.restingOrders.map((order) => (order.id === orderId ? cancelled : order)),
    });
    await Promise.all([this.refreshAccount(), this.refreshPublicBook()]);
    return cancelled;
  }

  reconcileRestingOrders(): RestingPackageOrder[] {
    return this.snapshot.restingOrders;
  }

  async requestRfq(authorization: SignedOrderAuthorization): Promise<RfqRequest> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    if (authorization.intent.disclosure !== "PRIVATE_RFQ") throw new Error("PRIVATE_RFQ_AUTHORIZATION_REQUIRED");
    if (authorization.signer.toLowerCase() !== address.toLowerCase()) throw new Error("SIGNER_MISMATCH");
    const order = authorization.onchainOrder;
    const registrationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "registerSignedOrder",
      args: [order, authorization.signature as Hex],
    });
    const registrationReceipt = await publicClient.waitForTransactionReceipt({ hash: registrationHash });
    if (registrationReceipt.status !== "success") throw new Error("ORDER_REGISTRATION_FAILED");

    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const request: OnchainPrivateRfqRequest = {
      taker: address,
      takerAccountId: order.accountId,
      takerOrderHash: authorization.orderHash as Hex,
      targetKind: 1,
      seriesId: setryn.seriesId,
      packageId: EMPTY_ID,
      targetVersion: 1,
      hasPackageLegCommitment: false,
      packageLegsHash: EMPTY_ID,
      sidePolicy: order.side === 1 ? 1 : 2,
      lots: order.lots,
      allowPartialFills: order.allowPartialFills,
      minimumFillLots: order.minimumFillLots,
      remainderPolicy: order.remainderPolicy,
      feeScheduleId: setryn.feeScheduleId,
      feeScheduleVersion: 1,
      maxFeeMinor: order.maxFeeMinor,
      riskDomainId: setryn.riskDomainId,
      riskDomainVersion: 1,
      privacyModeId: setryn.privateRfqPrivacyModeId,
      executionModeId: setryn.privateRfqExecutionModeId,
      disclosurePolicyHash: setryn.privateRfqDisclosurePolicyHash,
      eligibleMakerSetHash: setryn.privateRfqEligibleMakerSetHash,
      deadline: order.deadline,
      permittedExecutor: setryn.atomicClearingEngine,
      nonce,
      salt: keccak256(stringToHex(`${authorization.orderHash}:${nonce}:rfq`)),
    };
    const signature = await walletClient.signTypedData({
      account: address,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook },
      types: privateRfqRequestTypedData,
      primaryType: "PrivateRfqRequest",
      message: request,
    });
    const rfqId = await publicClient.readContract({
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "hashRequest",
      args: [request],
    });
    const registerHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "registerRequest",
      args: [request, [], signature],
    });
    await publicClient.waitForTransactionReceipt({ hash: registerHash });
    const openHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "openCollection",
      args: [rfqId],
    });
    await publicClient.waitForTransactionReceipt({ hash: openHash });
    const quoteResponse = await fetch("/api/internal/devnet/rfq-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqId }),
    });
    const quoteBody = (await quoteResponse.json()) as {
      quoteId?: string;
      packagePrice?: number;
      feeCap?: number;
      capacityLots?: number;
      expiresAt?: string;
    };
    if (!quoteResponse.ok || !quoteBody.quoteId || !quoteBody.expiresAt) throw new Error("RFQ_QUOTE_FAILED");
    const created: RfqRequest = {
      id: rfqId,
      authorization,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Number(request.deadline) * 1000).toISOString(),
      state: "OPEN",
      selectedQuoteId: null,
      receiptId: null,
      quotes: [{
        id: quoteBody.quoteId,
        solverLabel: "Setryn Devnet MM",
        packagePrice: quoteBody.packagePrice ?? authorization.intent.executionPrice,
        feeCap: quoteBody.feeCap ?? authorization.intent.feeCap,
        capacityLots: quoteBody.capacityLots ?? authorization.intent.lots,
        expiresAt: quoteBody.expiresAt,
        settlementGuarantee: "Firm capacity, atomic onchain settlement",
        provenance: "SEEDED_SOLVER",
      }],
    };
    this.publish({ ...this.snapshot, rfqRequests: [...this.snapshot.rfqRequests, created] });
    return created;
  }

  async selectRfqQuote(requestId: string, quoteId: string): Promise<RfqRequest> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const current = this.snapshot.rfqRequests.find((request) => request.id === requestId);
    if (!current || current.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    if (!current.quotes.some((quote) => quote.id === quoteId)) throw new Error("RFQ_QUOTE_NOT_FOUND");
    const block = await publicClient.getBlock();
    const deadline = block.timestamp + BigInt(90) < BigInt(Math.floor(Date.parse(current.expiresAt) / 1000))
      ? block.timestamp + BigInt(90)
      : BigInt(Math.floor(Date.parse(current.expiresAt) / 1000));
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const selection: OnchainRfqSelection = {
      rfqId: requestId as Hex,
      quoteId: quoteId as Hex,
      taker: address,
      executor: setryn.atomicClearingEngine,
      nonce,
      deadline,
      salt: keccak256(stringToHex(`${requestId}:${quoteId}:${nonce}`)),
    };
    const signature = await walletClient.signTypedData({
      account: address,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook },
      types: rfqSelectionTypedData,
      primaryType: "RfqSelectionAuthorization",
      message: selection,
    });
    const selectionHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "lockSelection",
      args: [selection, signature],
    });
    await publicClient.waitForTransactionReceipt({ hash: selectionHash });
    const capacityHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "confirmSelectedCapacity",
      args: [requestId as Hex],
    });
    await publicClient.waitForTransactionReceipt({ hash: capacityHash });
    const authorizationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "authorizeSubmission",
      args: [requestId as Hex],
    });
    await publicClient.waitForTransactionReceipt({ hash: authorizationHash });
    const submissionHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "submitSelectedRfq",
      args: [requestId as Hex, keccak256(stringToHex(`${requestId}:submitted`))],
    });
    const submissionReceipt = await publicClient.waitForTransactionReceipt({ hash: submissionHash });
    if (submissionReceipt.status !== "success") throw new Error("RFQ_SELECTION_FAILED");
    const selected = { ...current, state: "SELECTED" as const, selectedQuoteId: quoteId };
    this.publish({
      ...this.snapshot,
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === requestId ? selected : request),
    });
    return selected;
  }

  async executeSelectedRfq(
    requestId: string,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
    const current = this.snapshot.rfqRequests.find((request) => request.id === requestId);
    if (!current || current.state !== "SELECTED" || !current.selectedQuoteId) throw new Error("RFQ_NOT_SELECTED");
    const quote = current.quotes.find((candidate) => candidate.id === current.selectedQuoteId);
    if (!quote) throw new Error("RFQ_QUOTE_NOT_FOUND");
    onUpdate({
      step: "AUTHORIZED",
      label: "RFQ authorized",
      detail: "The selected firm quote and capacity reservation are locked onchain.",
    });
    onUpdate({
      step: "SUBMITTED",
      label: "Private handoff submitted",
      detail: "The selected RFQ is being cleared through the private execution channel.",
    });
    const response = await fetch("/api/internal/devnet/rfq-execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqId: requestId }),
    });
    const body = (await response.json()) as {
      fillId?: string;
      positionId?: string;
      transactionHash?: string;
      executionPriceTicks?: string;
      fillLots?: string;
      takerFeeMinor?: string;
      error?: string;
    };
    if (
      !response.ok ||
      !body.fillId ||
      !body.positionId ||
      !body.transactionHash ||
      body.executionPriceTicks === undefined ||
      body.fillLots === undefined ||
      body.takerFeeMinor === undefined
    ) {
      throw new Error(body.error ?? "RFQ_EXECUTION_FAILED");
    }
    const authorization = current.authorization;
    const setryn = await this.runtime();
    const packageSide = authorization.intent.packageSide;
    const createdPositionSide: "LONG" | "SHORT" = authorization.onchainOrder.side === 1 ? "LONG" : "SHORT";
    const filledLots = Number(body.fillLots);
    const executionPrice = Number(body.executionPriceTicks) / 10;
    let lifecycleHash: Hex | null = null;
    if (authorization.intent.side === "EXIT") {
      if (!authorization.intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
      onUpdate({
        step: "POSITION_UPDATED",
        label: "Close hedge filled",
        detail: "The private close fill is complete. Releasing both position liabilities.",
        transactionHash: body.transactionHash,
      });
      lifecycleHash = await this.completeFullExit(
        authorization.intent.closePositionId as Hex,
        body.positionId as Hex,
      );
    }
    const position = {
      id: body.positionId,
      marketId: authorization.intent.marketId,
      side: createdPositionSide,
      lots: filledLots,
      entryPrice: executionPrice,
      collateral:
        filledLots *
        Number(createdPositionSide === "LONG" ? setryn.maxLongDebitMinorPerLot : setryn.maxShortDebitMinorPerLot) /
        1_000_000,
      state: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
    const closedPosition = authorization.intent.side === "EXIT"
      ? this.snapshot.positions.find((candidate) => candidate.id === authorization.intent.closePositionId) ?? null
      : null;
    const realizedPnlUsd = closedPosition ? await this.exitRealizedPnlUsd(closedPosition.id, body.fillId as Hex) : undefined;
    const receipt: ExecutionReceipt = {
      id: body.fillId,
      orderHash: authorization.orderHash,
      fillId: body.fillId,
      transactionHash: body.transactionHash,
      marketId: authorization.intent.marketId,
      packageCode: authorization.intent.packageCode,
      packageSide,
      routeLabel: "Private firm RFQ",
      lots: filledLots,
      requestedLots: authorization.intent.lots,
      filledLots,
      cancelledLots: authorization.intent.lots - filledLots,
      price: executionPrice,
      fees: Number(formatUnits(BigInt(body.takerFeeMinor), 6)),
      realizedPnlUsd,
      collateralReleasedUsd: closedPosition ? closedPosition.collateral + position.collateral : undefined,
      guarantee: "Firm capacity, atomic onchain settlement",
      evidence: "DEVNET",
      createdAt: new Date().toISOString(),
    };
    const result: PackageExecutionResult = {
      fillId: body.fillId,
      outcome: authorization.intent.side === "EXIT" ? "CLOSED" : "OPENED",
      requestedLots: authorization.intent.lots,
      filledLots,
      cancelledLots: receipt.cancelledLots,
      position: authorization.intent.side === "EXIT" ? null : position,
      closedPositionId: authorization.intent.side === "EXIT" ? authorization.intent.closePositionId : null,
      closedLots: authorization.intent.side === "EXIT" ? filledLots : 0,
      receipt,
    };
    const updates: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "RFQ authorized", detail: "Selected quote and capacity were locked onchain." },
      { step: "SUBMITTED", label: "Private handoff submitted", detail: "The RFQ entered private channel clearing." },
      { step: "INCLUDED", label: "Handoff included", detail: "The RFQ handoff cleared atomically.", transactionHash: body.transactionHash },
      { step: "FILLED", label: "Package filled", detail: `${formatLotCount(filledLots)} filled at ${executionPrice.toFixed(1)}.`, transactionHash: body.transactionHash },
      authorization.intent.side === "EXIT"
        ? { step: "POSITION_CLOSED", label: "Position closed", detail: "Original and close-fill positions were fully unwound onchain.", transactionHash: lifecycleHash ?? body.transactionHash }
        : { step: "POSITION_CREATED", label: "Position created", detail: `Position ${body.positionId} is active.`, transactionHash: body.transactionHash },
      { step: "RECEIPT_READY", label: "Receipt ready", detail: `Fill ${body.fillId} is verifiable onchain.`, transactionHash: body.transactionHash },
    ];
    for (const update of updates.slice(2)) onUpdate(update);
    const executed = { ...current, state: "EXECUTED" as const, receiptId: receipt.id };
    const execution = {
      id: body.fillId,
      orderHash: authorization.orderHash,
      updates,
      result,
      createdAt: receipt.createdAt,
    };
    this.publish({
      ...this.snapshot,
      positions: authorization.intent.side === "EXIT"
        ? this.snapshot.positions.filter((candidate) => candidate.id !== authorization.intent.closePositionId)
        : [...this.snapshot.positions, position],
      receipts: [...this.snapshot.receipts, receipt],
      executions: [...this.snapshot.executions, execution],
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === requestId ? executed : request),
    });
    await Promise.all([this.refreshAccount(), this.refreshOrders(), this.refreshActivity()]);
    return result;
  }

  async cancelRfq(requestId: string): Promise<RfqRequest> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const current = this.snapshot.rfqRequests.find((request) => request.id === requestId);
    if (!current || (current.state !== "OPEN" && current.state !== "SELECTED")) throw new Error("RFQ_NOT_OPEN");
    const expired = Date.parse(current.expiresAt) <= Date.now();
    if (current.state === "SELECTED" && !expired) throw new Error("RFQ_SELECTION_LOCKED");
    const hash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: expired ? "expireRfq" : "cancelRfq",
      args: [requestId as Hex],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await this.releaseRiskReservation(current.authorization);
    const cancelled = { ...current, state: "CANCELLED" as const };
    this.publish({
      ...this.snapshot,
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === requestId ? cancelled : request),
    });
    return cancelled;
  }

  async submitLocalMakerQuote(_requestId: string, _input: LocalMakerQuoteInput): Promise<RfqRequest> {
    const current = this.snapshot.rfqRequests.find((request) => request.id === _requestId);
    if (!current) throw new Error("RFQ_NOT_FOUND");
    if (current.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    const response = await fetch("/api/internal/devnet/rfq-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqId: _requestId, ..._input }),
    });
    const body = (await response.json()) as {
      quoteId?: string;
      packagePrice?: number;
      feeCap?: number;
      capacityLots?: number;
      expiresAt?: string;
      error?: string;
    };
    if (!response.ok || !body.quoteId || body.packagePrice === undefined || body.feeCap === undefined || body.capacityLots === undefined || !body.expiresAt) {
      throw new Error(body.error ?? "RFQ_QUOTE_FAILED");
    }
    const quote = {
      id: body.quoteId,
      solverLabel: "Setryn Devnet MM",
      packagePrice: body.packagePrice,
      feeCap: body.feeCap,
      capacityLots: body.capacityLots,
      expiresAt: body.expiresAt,
      settlementGuarantee: "Firm capacity, atomic onchain settlement",
      provenance: "DEVNET_MAKER" as const,
    };
    const updated = { ...current, quotes: [...current.quotes, quote] };
    this.publish({
      ...this.snapshot,
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === _requestId ? updated : request),
    });
    return updated;
  }

  async withdrawLocalMakerQuote(_requestId: string): Promise<RfqRequest> {
    const current = this.snapshot.rfqRequests.find((request) => request.id === _requestId);
    if (!current) throw new Error("RFQ_NOT_FOUND");
    if (current.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    const quote = [...current.quotes].reverse().find((candidate) => candidate.provenance === "DEVNET_MAKER");
    if (!quote) throw new Error("RFQ_QUOTE_NOT_FOUND");
    const response = await fetch("/api/internal/devnet/rfq-withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId: quote.id }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "QUOTE_WITHDRAWAL_FAILED");
    const updated = { ...current, quotes: current.quotes.filter((candidate) => candidate.id !== quote.id) };
    this.publish({
      ...this.snapshot,
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === _requestId ? updated : request),
    });
    return updated;
  }

  getReceipt(receiptId: string): ExecutionReceipt | null {
    return this.snapshot.receipts.find((receipt) => receipt.id === receiptId) ?? null;
  }

  private async initialize(): Promise<SetrynRuntime> {
    const setryn = await loadSetrynRuntime();
    this.setryn = setryn;
    this.publicClient = createPublicClient({ chain: this.chain(setryn), transport: http(setryn.rpcUrl) });
    this.publish({
      ...this.snapshot,
      environment: {
        id: "LOCAL_DEVNET",
        label: "Local devnet",
        chainId: setryn.chainId,
        evidence: "DEVNET",
      },
      publicBookEconomics: {
        // Package prices carry one decimal onchain, so one price unit is ten ticks.
        considerationPerPriceUnit: (setryn.tickSizeMinor * 10) / 1_000_000,
        longCollateralPerLot: setryn.maxLongDebitMinorPerLot / 1_000_000,
        shortCollateralPerLot: setryn.maxShortDebitMinorPerLot / 1_000_000,
        maxOrderLots: setryn.maxOrderLots,
        makerFeeBps: setryn.makerFeeRatePpm / 100,
        takerFeeBps: setryn.takerFeeRatePpm / 100,
      },
    });
    return setryn;
  }

  private runtime(): Promise<SetrynRuntime> {
    this.runtimePromise ??= this.initialize();
    return this.runtimePromise;
  }

  private chain(setryn: SetrynRuntime) {
    return defineChain({
      id: setryn.chainId,
      name: "Setryn Local Devnet",
      nativeCurrency: { name: "Devnet Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [setryn.rpcUrl] } },
    });
  }

  private async connected() {
    const setryn = await this.runtime();
    if (!this.walletAddress || !this.walletClient || !this.publicClient) throw new Error("CONNECT_WALLET");
    if (this.snapshot.wallet.status !== "CONNECTED") throw new Error("WRONG_NETWORK");
    return {
      setryn,
      address: this.walletAddress,
      walletClient: this.walletClient,
      publicClient: this.publicClient,
    };
  }

  private async accountId(address: Address): Promise<Hex> {
    if (!this.setryn || !this.publicClient) throw new Error("RUNTIME_UNAVAILABLE");
    return this.publicClient.readContract({
      address: this.setryn.collateralVault,
      abi: vaultAbi,
      functionName: "deriveAccountId",
      args: [address, ACCOUNT_SALT],
    });
  }

  private async refreshAccount(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const accountId = await this.accountId(this.walletAddress);
    const collateralId = await this.publicClient.readContract({
      address: this.setryn.collateralVault,
      abi: vaultAbi,
      functionName: "deriveCollateralId",
      args: [this.setryn.settlementAssetId, 1],
    });
    const exists = await this.publicClient.readContract({
      address: this.setryn.collateralVault,
      abi: vaultAbi,
      functionName: "accountExists",
      args: [accountId],
    });
    const [total, locked, available] = exists
      ? await this.publicClient.readContract({
          address: this.setryn.collateralVault,
          abi: vaultAbi,
          functionName: "balanceOf",
          args: [accountId, collateralId],
        })
      : ([BigInt(0), BigInt(0), BigInt(0)] as const);
    const posted = Number(formatUnits(total, 6));
    const reserved = Number(formatUnits(locked, 6));
    const free = Number(formatUnits(available, 6));
    this.publish({
      ...this.snapshot,
      account: {
        id: accountId,
        label: "Primary account",
        riskDomain: "BTC/USD isolated",
        collateralAsset: "sUSD",
        posted,
        eligible: posted,
        reserved,
        available: free,
        equity: posted,
      },
    });
  }

  private async refreshOrders(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const logs = await this.publicClient.getContractEvents({
      address: this.setryn.orderState,
      abi: orderStateAbi,
      eventName: "OrderRegistered",
      args: { signer: this.walletAddress },
      fromBlock: BigInt(0),
      toBlock: "latest",
    });
    const orders: RestingPackageOrder[] = [];
    for (const log of logs) {
      const orderHash = log.args.orderHash;
      if (!orderHash) continue;
      const record = await this.publicClient.readContract({
        address: this.setryn.orderState,
        abi: orderStateAbi,
        functionName: "getOrder",
        args: [orderHash],
      });
      if (record.order.seriesId.toLowerCase() !== this.setryn.seriesId.toLowerCase()) continue;
      const admissionId = await this.publicClient.readContract({
        address: this.setryn.riskAdmissionBindingRegistry,
        abi: riskBindingAbi,
        functionName: "admissionForOrder",
        args: [orderHash],
      });
      const admission = admissionId === EMPTY_ID
        ? null
        : await this.publicClient.readContract({
            address: this.setryn.portfolioRiskEngine,
            abi: riskEngineAbi,
            functionName: "getAdmission",
            args: [admissionId],
          });
      const now = BigInt(Math.floor(Date.now() / 1000));
      const state = this.restingState(record.status, record.order.deadline <= now);
      const packageSide = record.order.side === 1 ? "LONG" : "SHORT";
      const timeInForce = record.order.timeInForce === 2
        ? "GTD"
        : record.order.timeInForce === 3
          ? "IOC"
          : record.order.timeInForce === 4
            ? "FOK"
            : "GTC";
      const lots = Number(record.order.lots);
      const filledLots = Number(record.filledLots);
      const limitPrice = Number(record.order.priceTicks) / 10;
      const collateralRequired = admission
        ? Number(formatUnits(admission.terminalLiabilityBaseUnits, 6))
        : 0;
      const feeCap = Number(formatUnits(record.order.maxFeeMinor, 6));
      const intent: PackageOrderIntent = {
        accountId: record.order.accountId,
        marketId: PRIMARY_MARKET_ID,
        packageCode: PRIMARY_MARKET_ID,
        routeId: "native-public-book",
        routeLabel: "Native public book",
        side: "ENTER",
        packageSide,
        lots,
        fillLots: lots,
        limitPrice,
        executionPrice: limitPrice,
        contractMultiplier: PRIMARY_CONTRACT_MULTIPLIER,
        orderType: "LIMIT",
        timeInForce,
        expiresAt: new Date(Number(record.order.deadline) * 1000).toISOString(),
        feeCap,
        collateralRequired,
        closePositionId: null,
        replacesOrderId: null,
        recipient: record.order.recipient,
        disclosure: "PUBLIC",
        settlementGuarantee: "Package atomic",
      };
      const authorization: SignedOrderAuthorization = {
        orderHash,
        signature: "0x",
        signer: record.order.signer,
        nonce: record.order.nonce.toString(),
        deadline: new Date(Number(record.order.deadline) * 1000).toISOString(),
        intent,
        onchainOrder: record.order as OnchainPublicOrder,
        riskAdmissionId: admissionId,
      };
      this.authorizations.set(orderHash.toLowerCase(), authorization);
      orders.push({
        id: orderHash,
        orderHash,
        accountId: record.order.accountId,
        marketId: PRIMARY_MARKET_ID,
        packageCode: PRIMARY_MARKET_ID,
        routeId: intent.routeId,
        routeLabel: intent.routeLabel,
        side: "ENTER",
        packageSide,
        lots,
        filledLots,
        remainingLots: lots - filledLots,
        limitPrice,
        timeInForce,
        expiresAt: intent.expiresAt,
        collateralReservation: collateralRequired,
        remainingCollateralReservation: state === "WORKING" || state === "PARTIALLY_FILLED" ? collateralRequired : 0,
        feeCap,
        remainingFeeCap: state === "WORKING" || state === "PARTIALLY_FILLED" ? feeCap : 0,
        fillIds: [],
        receiptIds: [],
        closePositionId: null,
        replacesOrderId: null,
        createdAt: new Date(Number(record.registeredAt) * 1000).toISOString(),
        state,
        orderType: "LIMIT",
        contractMultiplier: PRIMARY_CONTRACT_MULTIPLIER,
        settlementGuarantee: intent.settlementGuarantee,
        disclosure: "PUBLIC",
        recipient: record.order.recipient,
        collateralRequired,
      });
    }
    orders.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    this.publish({ ...this.snapshot, restingOrders: orders });
  }

  private async refreshPublicBook(): Promise<void> {
    if (!this.setryn || !this.publicClient) return;
    const bookId = this.deriveBookId(this.setryn);
    const [events, block] = await Promise.all([
      this.publicClient.getContractEvents({
        address: this.setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        eventName: "DirectOrderRested",
        args: { bookId },
        fromBlock: BigInt(0),
        toBlock: "latest",
      }),
      this.publicClient.getBlock(),
    ]);
    const latestHashes = [...new Set(events.map((event) => event.args.orderHash).filter((value) => value != null))];
    const rows = [] as GatewaySnapshot["publicBookOrders"];
    for (const orderHash of latestHashes) {
      const [bookOrder, orderRecord] = await Promise.all([
        this.publicClient.readContract({
          address: this.setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "getBookOrder",
          args: [orderHash],
        }),
        this.publicClient.readContract({
          address: this.setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [orderHash],
        }),
      ]);
      if (
        bookOrder.status !== 1 ||
        (orderRecord.status !== 1 && orderRecord.status !== 2) ||
        orderRecord.order.deadline <= block.timestamp
      ) continue;
      rows.push({
        id: `onchain-${orderHash}`,
        side: bookOrder.side === 1 ? "BID" : "ASK",
        source: "DIRECT",
        price: Number(bookOrder.priceTicks) / 10,
        lots: Number(bookOrder.remainingLots),
        firmness: "FIRM",
        executable: true,
        origin: "Setryn public book",
      });
    }
    rows.sort((left, right) => left.side === right.side
      ? left.side === "BID" ? right.price - left.price : left.price - right.price
      : left.side === "ASK" ? -1 : 1);
    this.publish({ ...this.snapshot, publicBookMarketId: PRIMARY_MARKET_ID, publicBookOrders: rows });
  }

  /** Realized PnL of a full exit: the account's net consideration over the fill that opened the position and the close fill. */
  private async exitRealizedPnlUsd(closePositionId: string, exitFillId: Hex): Promise<number | undefined> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return undefined;
    const entryFillId = this.snapshot.executions.find((execution) => execution.result?.position?.id === closePositionId)
      ?.result?.fillId as Hex | undefined;
    if (!entryFillId) return undefined;
    const accountId = await this.accountId(this.walletAddress);
    const events = await this.publicClient.getContractEvents({
      address: this.setryn.atomicClearingEngine,
      abi: atomicClearingAbi,
      eventName: "FillLedgerEntry",
      args: { fillId: [entryFillId, exitFillId], kind: CONSIDERATION_ENTRY },
      fromBlock: BigInt(0),
      toBlock: "latest",
    });
    return netConsiderationUsd(events, entryFillId, accountId) + netConsiderationUsd(events, exitFillId, accountId);
  }

  private async refreshActivity(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const accountId = await this.accountId(this.walletAddress);
    const [positionEvents, ledgerEvents, quantityEvents, feeEvents] = await Promise.all([
      this.publicClient.getContractEvents({
        address: this.setryn.atomicClearingEngine,
        abi: atomicClearingAbi,
        eventName: "FillPositionCreated",
        fromBlock: BigInt(0),
        toBlock: "latest",
      }),
      this.publicClient.getContractEvents({
        address: this.setryn.atomicClearingEngine,
        abi: atomicClearingAbi,
        eventName: "FillLedgerEntry",
        fromBlock: BigInt(0),
        toBlock: "latest",
      }),
      this.publicClient.getContractEvents({
        address: this.setryn.positionEngine,
        abi: positionLifecycleAbi,
        eventName: "PositionQuantityChanged",
        fromBlock: BigInt(0),
        toBlock: "latest",
      }),
      this.publicClient.getContractEvents({
        address: this.setryn.fundedFeeEngine,
        abi: fundedFeeLedgerAbi,
        eventName: "FeeLedgerEntryRecorded",
        fromBlock: BigInt(0),
        toBlock: "latest",
      }),
    ]);
    // A full exit closes the original position and the close-fill position in one lifecycle action, so both carry the
    // same transition reference on the event that takes them to zero remaining lots.
    const closings = new Map<string, { reference: Hex; transactionHash: Hex }>();
    const closedByReference = new Map<string, string[]>();
    for (const event of quantityEvents) {
      const { positionId, remainingLots, transitionReference } = event.args;
      if (!positionId || !transitionReference || remainingLots !== BigInt(0)) continue;
      const key = positionId.toLowerCase();
      closings.set(key, { reference: transitionReference, transactionHash: event.transactionHash });
      closedByReference.set(transitionReference, [...(closedByReference.get(transitionReference) ?? []), key]);
    }
    const fills = [];
    for (const positionEvent of positionEvents) {
      const fillId = positionEvent.args.fillId;
      const positionId = positionEvent.args.positionId;
      if (!fillId || !positionId) continue;
      const fill = await this.publicClient.readContract({
        address: this.setryn.atomicClearingEngine,
        abi: atomicClearingAbi,
        functionName: "getFill",
        args: [fillId],
      });
      const positionStatus = await this.publicClient.readContract({
        address: this.setryn.positionEngine,
        abi: positionLifecycleAbi,
        functionName: "positionStatus",
        args: [positionId],
      });
      const positionLive = positionStatus === 1;
      const [makerRecord, takerRecord] = await Promise.all([
        this.publicClient.readContract({
          address: this.setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [fill.makerOrderHash],
        }),
        this.publicClient.readContract({
          address: this.setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [fill.takerOrderHash],
        }),
      ]);
      const isTaker = takerRecord.order.accountId.toLowerCase() === accountId.toLowerCase();
      const isMaker = makerRecord.order.accountId.toLowerCase() === accountId.toLowerCase();
      if (!isTaker && !isMaker) continue;
      const ownRecord = isTaker ? takerRecord : makerRecord;
      const ownOrderHash = isTaker ? fill.takerOrderHash : fill.makerOrderHash;
      const filledLots = Number(fill.fillLots);
      const requestedLots = isTaker ? Number(ownRecord.order.lots) : filledLots;
      const packageSide: "LONG" | "SHORT" = ownRecord.order.side === 1 ? "LONG" : "SHORT";
      const price = Number(fill.executionPriceTicks) / 10;
      const ownFeeKind = isTaker ? 3 : 2;
      // Fees are charged by the funded fee engine in the fill's transaction, or on the clearing ledger when funded
      // from a direct fee lock.
      const feeMinor = (ledgerEvents.find(
        (event) =>
          event.args.fillId === fillId &&
          event.args.kind === ownFeeKind &&
          event.args.payerAccountId?.toLowerCase() === accountId.toLowerCase(),
      )?.args.amount ?? BigInt(0)) + accountFeesPaidMinor(
        feeEvents.filter((event) => event.transactionHash === positionEvent.transactionHash),
        accountId,
      );
      const createdAt = new Date(Number(fill.clearedAt) * 1000).toISOString();
      const position = {
        id: positionId,
        marketId: PRIMARY_MARKET_ID,
        side: packageSide,
        lots: filledLots,
        entryPrice: price,
        collateral:
          filledLots *
          Number(packageSide === "LONG" ? this.setryn.maxLongDebitMinorPerLot : this.setryn.maxShortDebitMinorPerLot) /
          1_000_000,
        state: "ACTIVE" as const,
        createdAt,
      };
      const cancelledLots = isTaker && (ownRecord.order.timeInForce === 3 || ownRecord.order.timeInForce === 4)
        ? requestedLots - Number(ownRecord.filledLots)
        : 0;
      fills.push({
        fillId,
        positionId,
        positionLive,
        ownOrderHash,
        requestedLots,
        filledLots,
        cancelledLots,
        packageSide,
        price,
        feeMinor,
        createdAt,
        position,
        channelKind: fill.channelKind,
        transactionHash: positionEvent.transactionHash,
      });
    }
    // Pair each exit fill with the position it closed: the earlier fill opened it, the later one hedged it out.
    const fillByPosition = new Map(fills.map((record, index) => [record.positionId.toLowerCase(), { record, index }]));
    const closedBy = new Map<string, { exit: (typeof fills)[number]; transactionHash: Hex }>();
    const closes = new Map<string, { entry: (typeof fills)[number]; transactionHash: Hex }>();
    for (const [positionKey, closing] of closings) {
      const own = fillByPosition.get(positionKey);
      if (!own || closedBy.has(positionKey) || closes.has(positionKey)) continue;
      const peerKey = closedByReference.get(closing.reference)?.find((candidate) => candidate !== positionKey);
      const peer = peerKey ? fillByPosition.get(peerKey) : undefined;
      if (!peer || peer.record.packageSide === own.record.packageSide) continue;
      const [entry, exit] = own.index < peer.index ? [own.record, peer.record] : [peer.record, own.record];
      closedBy.set(entry.positionId.toLowerCase(), { exit, transactionHash: closing.transactionHash });
      closes.set(exit.positionId.toLowerCase(), { entry, transactionHash: closing.transactionHash });
    }
    const positions = [] as GatewaySnapshot["positions"];
    const receipts = [] as GatewaySnapshot["receipts"];
    const executions = [] as GatewaySnapshot["executions"];
    for (const record of fills) {
      const { fillId, positionId, positionLive, filledLots, price, position, transactionHash } = record;
      const closedEntry = closes.get(positionId.toLowerCase());
      const openedAndClosed = closedBy.has(positionId.toLowerCase());
      const entry = closedEntry?.entry;
      const receipt: ExecutionReceipt = {
        id: fillId,
        orderHash: record.ownOrderHash,
        fillId,
        transactionHash,
        marketId: PRIMARY_MARKET_ID,
        packageCode: PRIMARY_MARKET_ID,
        packageSide: record.packageSide,
        routeLabel: record.channelKind === 2 ? "Private firm RFQ" : "Direct package book",
        lots: filledLots,
        requestedLots: record.requestedLots,
        filledLots,
        cancelledLots: record.cancelledLots,
        price,
        fees: Number(formatUnits(record.feeMinor, 6)),
        realizedPnlUsd: entry
          ? netConsiderationUsd(ledgerEvents, entry.fillId, accountId) + netConsiderationUsd(ledgerEvents, fillId, accountId)
          : undefined,
        collateralReleasedUsd: entry ? entry.position.collateral + position.collateral : undefined,
        guarantee: "Atomic onchain settlement",
        evidence: "DEVNET",
        createdAt: record.createdAt,
      };
      const positionUpdate: SubmissionUpdate = closedEntry
        ? { step: "POSITION_CLOSED", label: "Position closed", detail: "Original and close-fill positions were fully unwound onchain.", transactionHash: closedEntry.transactionHash }
        : positionLive || openedAndClosed
          ? { step: "POSITION_CREATED", label: "Position created", detail: `Position ${positionId} ${positionLive ? "is active" : "was opened"}.`, transactionHash }
          : { step: "POSITION_CLOSED", label: "Position closed", detail: `Position ${positionId} reached a terminal lifecycle state.`, transactionHash };
      const updates: SubmissionUpdate[] = [
        { step: "AUTHORIZED", label: "Order authorized", detail: "Signature and risk admission were bound." },
        { step: "SUBMITTED", label: "Order registered", detail: "Signed order registered onchain." },
        { step: "INCLUDED", label: "Match included", detail: `${receipt.routeLabel} cleared atomically.`, transactionHash },
        { step: "FILLED", label: "Package filled", detail: `${formatLotCount(filledLots)} filled at ${price.toFixed(1)}.`, transactionHash },
        positionUpdate,
        { step: "RECEIPT_READY", label: "Receipt ready", detail: `Fill ${fillId} is verifiable onchain.`, transactionHash },
      ];
      if (positionLive) positions.push(position);
      receipts.push(receipt);
      const opened = !closedEntry && (positionLive || openedAndClosed);
      executions.push({
        id: fillId,
        orderHash: record.ownOrderHash,
        updates,
        result: {
          fillId,
          outcome: opened ? "OPENED" : "CLOSED",
          requestedLots: record.requestedLots,
          filledLots,
          cancelledLots: record.cancelledLots,
          position: opened ? position : null,
          closedPositionId: opened ? null : entry?.positionId ?? positionId,
          closedLots: opened ? 0 : filledLots,
          receipt,
        },
        createdAt: record.createdAt,
      });
    }
    this.publish({ ...this.snapshot, positions, receipts, executions });
  }

  private async refreshRfqs(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const committed = await this.publicClient.getContractEvents({
      address: this.setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      eventName: "PrivateRfqCommitted",
      fromBlock: BigInt(0),
      toBlock: "latest",
    });
    const requests: RfqRequest[] = [];
    for (const event of committed) {
      const rfqId = event.args.rfqId;
      if (!rfqId) continue;
      const rfq = await this.publicClient.readContract({
        address: this.setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "getRfq",
        args: [rfqId],
      });
      if (rfq.request.taker.toLowerCase() !== this.walletAddress.toLowerCase()) continue;
      const orderRecord = await this.publicClient.readContract({
        address: this.setryn.orderState,
        abi: orderStateAbi,
        functionName: "getOrder",
        args: [rfq.request.takerOrderHash],
      });
      const admissionId = await this.publicClient.readContract({
        address: this.setryn.riskAdmissionBindingRegistry,
        abi: riskBindingAbi,
        functionName: "admissionForOrder",
        args: [rfq.request.takerOrderHash],
      });
      const admission = admissionId === EMPTY_ID
        ? null
        : await this.publicClient.readContract({
            address: this.setryn.portfolioRiskEngine,
            abi: riskEngineAbi,
            functionName: "getAdmission",
            args: [admissionId],
          });
      const quoteEvents = await this.publicClient.getContractEvents({
        address: this.setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        eventName: "MakerQuoteCommitted",
        args: { rfqId },
        fromBlock: BigInt(0),
        toBlock: "latest",
      });
      const quotes = [] as RfqRequest["quotes"];
      for (const quoteEvent of quoteEvents) {
        const quoteId = quoteEvent.args.quoteId;
        if (!quoteId) continue;
        const quoteRecord = await this.publicClient.readContract({
          address: this.setryn.privateRfqBook,
          abi: privateRfqBookAbi,
          functionName: "getQuote",
          args: [quoteId],
        });
        if (quoteRecord.status >= 5) continue;
        const priceTicks = rfq.request.sidePolicy === 1
          ? quoteRecord.quote.askPriceTicks
          : quoteRecord.quote.bidPriceTicks;
        quotes.push({
          id: quoteId,
          solverLabel: "Setryn Devnet MM",
          packagePrice: Number(priceTicks) / 10,
          feeCap: Number(formatUnits(quoteRecord.quote.maxFeeMinor, 6)),
          capacityLots: Number(quoteRecord.quote.lots - quoteRecord.cumulativeFilledLots),
          expiresAt: new Date(Number(quoteRecord.quote.deadline) * 1000).toISOString(),
          settlementGuarantee: "Firm capacity, atomic onchain settlement",
          provenance: "DEVNET_MAKER",
        });
      }
      const settled = rfq.status === 8
        ? await this.publicClient.getContractEvents({
            address: this.setryn.privateRfqBook,
            abi: privateRfqBookAbi,
            eventName: "RfqSettled",
            args: { rfqId },
            fromBlock: BigInt(0),
            toBlock: "latest",
          })
        : [];
      const packageSide = orderRecord.order.side === 1 ? "LONG" : "SHORT";
      const timeInForce = orderRecord.order.timeInForce === 2
        ? "GTD"
        : orderRecord.order.timeInForce === 3
          ? "IOC"
          : orderRecord.order.timeInForce === 4
            ? "FOK"
            : "GTC";
      const lots = Number(orderRecord.order.lots);
      const limitPrice = Number(orderRecord.order.priceTicks) / 10;
      const intent: PackageOrderIntent = {
        accountId: orderRecord.order.accountId,
        marketId: PRIMARY_MARKET_ID,
        packageCode: PRIMARY_MARKET_ID,
        routeId: "private-rfq",
        routeLabel: "Private firm RFQ",
        side: "ENTER",
        packageSide,
        lots,
        fillLots: lots,
        limitPrice,
        executionPrice: limitPrice,
        contractMultiplier: PRIMARY_CONTRACT_MULTIPLIER,
        orderType: "LIMIT",
        timeInForce,
        expiresAt: new Date(Number(orderRecord.order.deadline) * 1000).toISOString(),
        feeCap: Number(formatUnits(orderRecord.order.maxFeeMinor, 6)),
        collateralRequired: admission ? Number(formatUnits(admission.terminalLiabilityBaseUnits, 6)) : 0,
        closePositionId: null,
        replacesOrderId: null,
        recipient: orderRecord.order.recipient,
        disclosure: "PRIVATE_RFQ",
        settlementGuarantee: "Firm capacity, atomic onchain settlement",
      };
      const authorization: SignedOrderAuthorization = {
        orderHash: rfq.request.takerOrderHash,
        signature: "0x",
        signer: orderRecord.order.signer,
        nonce: orderRecord.order.nonce.toString(),
        deadline: new Date(Number(orderRecord.order.deadline) * 1000).toISOString(),
        intent,
        onchainOrder: orderRecord.order as OnchainPublicOrder,
        riskAdmissionId: admissionId,
      };
      const state: RfqRequest["state"] = rfq.status === 8
        ? "EXECUTED"
        : rfq.status >= 9
          ? "CANCELLED"
          : rfq.status >= 3
            ? "SELECTED"
            : "OPEN";
      requests.push({
        id: rfqId,
        authorization,
        createdAt: new Date(Number(rfq.registeredAt) * 1000).toISOString(),
        expiresAt: new Date(Number(rfq.request.deadline) * 1000).toISOString(),
        state,
        selectedQuoteId: rfq.selectedQuoteId === EMPTY_ID ? null : rfq.selectedQuoteId,
        receiptId: settled[settled.length - 1]?.args.settlementReference ?? null,
        quotes,
      });
    }
    requests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    this.publish({ ...this.snapshot, rfqRequests: requests });
  }

  private restingState(status: number, expired: boolean): RestingPackageOrder["state"] {
    if ((status === 1 || status === 2) && expired) return "EXPIRED";
    if (status === 1) return "WORKING";
    if (status === 2) return "PARTIALLY_FILLED";
    if (status === 3) return "FILLED";
    if (status === 4) return "CANCELLED";
    if (status === 5) return "EXPIRED";
    return "CANCELLED";
  }

  private toMinorUnits(value: number): bigint {
    if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_MINOR_UNIT_AMOUNT");
    return parseUnits(value.toFixed(6), 6);
  }

  private deriveBookId(setryn: SetrynRuntime): Hex {
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
          EMPTY_ID,
        ],
      ),
    );
  }

  private async levelHint(bookId: Hex, side: 1 | 2, priceTicks: bigint) {
    if (!this.setryn || !this.publicClient) throw new Error("RUNTIME_UNAVAILABLE");
    let current: Hex;
    try {
      current = await this.publicClient.readContract({
        address: this.setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "bestLevel",
        args: [bookId, side],
      });
    } catch {
      return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };
    }
    if (current === EMPTY_ID) return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };

    let previous = EMPTY_ID;
    for (let depth = 0; depth < 256 && current !== EMPTY_ID; depth += 1) {
      const level = await this.publicClient.readContract({
        address: this.setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "getPriceLevel",
        args: [current],
      });
      if (level.priceTicks === priceTicks) {
        return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };
      }
      const currentBeforeIncoming = side === 1 ? level.priceTicks > priceTicks : level.priceTicks < priceTicks;
      if (!currentBeforeIncoming) return { previousLevelId: previous, nextLevelId: current };
      previous = current;
      current = level.nextLevelId;
    }
    if (current !== EMPTY_ID) throw new Error("ORDER_BOOK_DEPTH_LIMIT");
    return { previousLevelId: previous, nextLevelId: EMPTY_ID };
  }

  private async releaseRiskReservation(authorization: SignedOrderAuthorization): Promise<void> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    if (!authorization.onchainOrder || !authorization.riskAdmissionId) {
      throw new Error("ORDER_AUTHORIZATION_UNAVAILABLE");
    }
    const block = await publicClient.getBlock();
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const cancellationReference = keccak256(
      encodeAbiParameters(
        [
          { name: "orderHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
        ],
        [authorization.orderHash as Hex, nonce],
      ),
    );
    const cancellation = {
      admissionId: authorization.riskAdmissionId as Hex,
      orderHash: authorization.orderHash as Hex,
      accountId: authorization.onchainOrder.accountId,
      signer: address,
      nonce,
      deadline: block.timestamp + BigInt(240),
      cancellationReference,
    } as const;
    const signature = await walletClient.signTypedData({
      account: address,
      domain: {
        name: "Setryn",
        version: "1",
        chainId: setryn.chainId,
        verifyingContract: setryn.riskAdmissionBindingRegistry,
      },
      types: {
        SetrynRiskAdmissionCancellationV1: [
          { name: "admissionId", type: "bytes32" },
          { name: "orderHash", type: "bytes32" },
          { name: "accountId", type: "bytes32" },
          { name: "signer", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "cancellationReference", type: "bytes32" },
        ],
      },
      primaryType: "SetrynRiskAdmissionCancellationV1",
      message: cancellation,
    });
    const releaseHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "cancelBoundAdmission",
      args: [cancellation, signature],
    });
    const releaseReceipt = await publicClient.waitForTransactionReceipt({ hash: releaseHash });
    if (releaseReceipt.status !== "success") throw new Error("RISK_RELEASE_FAILED");
  }

  private async completeFullExit(sourcePositionId: Hex, closePositionId: Hex): Promise<Hex> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const actorAccountId = await this.accountId(address);
    if (sourcePositionId.toLowerCase() === closePositionId.toLowerCase()) throw new Error("DUPLICATE_EXIT_POSITION");
    const snapshots = await Promise.all(
      [sourcePositionId, closePositionId].map((positionId) =>
        publicClient.readContract({
          address: setryn.positionEngine,
          abi: positionLifecycleAbi,
          functionName: "getLifecyclePosition",
          args: [positionId],
        }),
      ),
    );
    snapshots.sort((left, right) => left.positionId.toLowerCase().localeCompare(right.positionId.toLowerCase()));
    if (snapshots.some((snapshot) => snapshot.positionLots === BigInt(0))) throw new Error("EMPTY_EXIT_POSITION");
    if (snapshots[0].positionLots !== snapshots[1].positionLots) throw new Error("EXIT_QUANTITY_MISMATCH");
    if (snapshots.some((snapshot) => snapshot.packageProvenanceHash !== EMPTY_ID)) {
      throw new Error("PACKAGE_COMPRESSION_EXIT_REQUIRED");
    }
    const participantAccounts = [...new Set(
      snapshots.flatMap((snapshot) => [snapshot.longAccountId.toLowerCase(), snapshot.shortAccountId.toLowerCase()]),
    )];
    if (participantAccounts.length !== 2 || !participantAccounts.includes(actorAccountId.toLowerCase())) {
      throw new Error("EXIT_PARTICIPANT_MISMATCH");
    }
    const makerAccountId = participantAccounts.find((accountId) => accountId !== actorAccountId.toLowerCase()) as Hex;
    const inputs = snapshots.map((snapshot) => ({
      positionId: snapshot.positionId,
      expectedImmutableHash: snapshot.immutableHash,
      expectedLifecycleHash: snapshot.lifecycleHash,
      expectedPositionLots: snapshot.positionLots,
      actionLots: snapshot.positionLots,
    }));
    const replacements = participantAccounts
      .sort((left, right) => left.localeCompare(right))
      .map((accountId) => ({
        accountId: accountId as Hex,
        collateralId: snapshots[0].collateralId,
        terminalLiabilityBaseUnits: BigInt(0),
      }));
    const block = await publicClient.getBlock();
    const deadline = block.timestamp + BigInt(240);
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const consentNonce = nonce + BigInt(1);
    const salt = keccak256(stringToHex(`${address}:${sourcePositionId}:${closePositionId}:${nonce}`));
    const consentSalt = keccak256(stringToHex(`${setryn.operator}:${sourcePositionId}:${closePositionId}:${consentNonce}`));
    const consentBase = {
      actionId: EMPTY_ID,
      accountId: makerAccountId,
      signer: setryn.operator,
      nonce: consentNonce,
      deadline,
      maximumLiabilityIncreaseBaseUnits: BigInt(0),
      maximumCollateralIncreaseBaseUnits: BigInt(0),
      allowsPackageBreak: false,
      salt: consentSalt,
    } as const;
    const [inputsHash, successorsHash, collateralReplacementsHash, participantSetHash, consentsHash] =
      await Promise.all([
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleInputs", args: [inputs] }),
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleSuccessors", args: [[]] }),
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleCollateralReplacements", args: [replacements] }),
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleParticipantSet", args: [actorAccountId, [consentBase]] }),
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleConsentTerms", args: [[consentBase]] }),
      ]);
    let action = {
      kind: 4,
      actor: address,
      actorAccountId,
      policyContextHash: EMPTY_ID,
      inputsHash,
      successorsHash,
      collateralReplacementsHash,
      participantSetHash,
      consentsHash,
      riskDomainId: snapshots[0].riskDomainId,
      riskDomainVersion: snapshots[0].riskDomainVersion,
      feeScheduleId: snapshots[0].feeScheduleId,
      feeScheduleVersion: snapshots[0].feeScheduleVersion,
      economicTransitionHash: EMPTY_ID,
      compressionPlanId: EMPTY_ID,
      breaksPackageProvenance: false,
      packageBreakPermissionHash: EMPTY_ID,
      actorMaximumLiabilityIncreaseBaseUnits: BigInt(0),
      actorMaximumCollateralIncreaseBaseUnits: BigInt(0),
      inputCount: inputs.length,
      successorCount: 0,
      participantCount: 2,
      deadline,
      nonce,
      permittedExecutor: address,
      salt,
    } as const;
    const [policyContextHash] = await publicClient.readContract({
      address: setryn.lifecyclePolicyValidator,
      abi: lifecyclePolicyAbi,
      functionName: "derivePolicyContext",
      args: [action, snapshots, []],
    });
    action = { ...action, policyContextHash };
    const [, actionId] = await publicClient.readContract({
      address: setryn.signedLifecycleEngine,
      abi: signedLifecycleAbi,
      functionName: "hashLifecycleAction",
      args: [action],
    });
    const consent = { ...consentBase, actionId };
    const consentResponse = await fetch("/api/internal/devnet/lifecycle-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId,
        accountId: makerAccountId,
        nonce: consentNonce.toString(),
        deadline: deadline.toString(),
        salt: consentSalt,
        allowsPackageBreak: false,
      }),
    });
    const consentResult = (await consentResponse.json()) as { signature?: Hex; error?: string };
    if (!consentResponse.ok || !consentResult.signature) {
      throw new Error(consentResult.error ?? "MAKER_LIFECYCLE_CONSENT_FAILED");
    }
    const actorSignature = await walletClient.signTypedData({
      account: address,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.signedLifecycleEngine },
      types: lifecycleActionTypes,
      primaryType: "SetrynLifecycleActionV1",
      message: { ...action, chainId: BigInt(setryn.chainId), engine: setryn.signedLifecycleEngine },
    });
    const authorizationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.signedLifecycleEngine,
      abi: signedLifecycleAbi,
      functionName: "authorizeAction",
      args: [action, inputs, [], replacements, [consent], [consentResult.signature], actorSignature],
    });
    const authorizationReceipt = await publicClient.waitForTransactionReceipt({ hash: authorizationHash });
    if (authorizationReceipt.status !== "success") throw new Error("EXIT_AUTHORIZATION_FAILED");
    const executionHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.signedLifecycleEngine,
      abi: signedLifecycleAbi,
      functionName: "executeAction",
      args: [action, inputs, [], replacements, [consent]],
    });
    const executionReceipt = await publicClient.waitForTransactionReceipt({ hash: executionHash });
    if (executionReceipt.status !== "success") throw new Error("EXIT_EXECUTION_FAILED");
    return executionHash;
  }

  private async cancelUnmatchedOrder(authorization: SignedOrderAuthorization): Promise<void> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const cancelHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "cancelOrder",
      args: [authorization.orderHash as Hex],
    });
    const cancelReceipt = await publicClient.waitForTransactionReceipt({ hash: cancelHash });
    if (cancelReceipt.status !== "success") throw new Error("ORDER_CANCELLATION_FAILED");
    await this.releaseRiskReservation(authorization);
  }

  private async fundNativeGas(address: Address): Promise<void> {
    const response = await fetch("/api/internal/devnet/fund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!response.ok) throw new Error("DEVNET_GAS_FUNDING_FAILED");
  }

  private startPolling(): void {
    if (this.pollingTimer !== null) return;
    this.pollingTimer = window.setInterval(() => {
      if (this.polling || this.snapshot.wallet.status !== "CONNECTED") return;
      this.polling = true;
      void fetch("/api/internal/devnet/liquidity", { method: "POST" })
        .then(() => Promise.all([
          this.refreshAccount(),
          this.refreshOrders(),
          this.refreshPublicBook(),
          this.refreshActivity(),
          this.refreshRfqs(),
        ]))
        .catch(() => undefined)
        .finally(() => {
          this.polling = false;
        });
    }, 20_000);
  }

  private bindProvider(provider: EIP1193Provider): void {
    const eventProvider = provider as EIP1193Provider & {
      on?: (event: string, listener: (value: unknown) => void) => void;
    };
    eventProvider.on?.("accountsChanged", (value) => {
      const accounts = Array.isArray(value) ? value : [];
      if (typeof accounts[0] !== "string") {
        this.walletAddress = null;
        this.walletClient = null;
        this.publish({ ...this.snapshot, wallet: { status: "DISCONNECTED", address: null, chainId: null } });
        return;
      }
      const address = getAddress(accounts[0]);
      this.walletAddress = address;
      if (this.setryn) {
        this.walletClient = createWalletClient({
          account: address,
          chain: this.chain(this.setryn),
          transport: custom(provider),
        });
        this.publish({
          ...this.snapshot,
          wallet: { status: "CONNECTED", address, chainId: this.setryn.chainId },
        });
        void Promise.all([this.refreshAccount(), this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity(), this.refreshRfqs()]);
      }
    });
    eventProvider.on?.("chainChanged", (value) => {
      const chainId = typeof value === "string" ? Number.parseInt(value, 16) : null;
      const connected = chainId === this.setryn?.chainId && this.walletAddress !== null;
      this.publish({
        ...this.snapshot,
        wallet: {
          status: connected ? "CONNECTED" : "WRONG_NETWORK",
          address: this.walletAddress,
          chainId,
        },
      });
      if (connected) {
        void Promise.all([this.refreshAccount(), this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity(), this.refreshRfqs()]);
      }
    });
  }

  private publish(snapshot: GatewaySnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
