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
  stringToHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { executableAction, limitCrosses } from "@/lib/terminal/economics";
import type { PackageMarket } from "@/lib/terminal/types";
import {
  orderStateAbi,
  atomicClearingAbi,
  publicOrderBookAbi,
  publicOrderTypedData,
  riskBindingAbi,
  riskEngineAbi,
  serializePublicOrder,
  type OnchainPublicOrder,
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
const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
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
    await Promise.all([this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity()]);
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
    if (intent.disclosure !== "PUBLIC") throw new Error("ONCHAIN_RFQ_FLOW_NOT_READY");
    if (intent.side !== "ENTER") throw new Error("ONCHAIN_EXIT_FLOW_NOT_READY");
    if (intent.marketId !== PRIMARY_MARKET_ID) throw new Error("MARKET_NOT_ONCHAIN_ENABLED");
    if (intent.recipient.toLowerCase() !== address.toLowerCase()) throw new Error("RECIPIENT_MISMATCH");
    if (intent.marketId !== PRIMARY_MARKET_ID || intent.packageCode !== PRIMARY_MARKET_ID) {
      throw new Error("UNSUPPORTED_ONCHAIN_MARKET");
    }
    if (!Number.isInteger(intent.lots) || intent.lots < 1 || intent.lots > 10) throw new Error("INVALID_LOTS");
    if (!Number.isFinite(intent.limitPrice)) throw new Error("INVALID_LIMIT_PRICE");
    if (!["GTC", "GTD", "IOC", "FOK"].includes(intent.timeInForce)) throw new Error("INVALID_TIME_IN_FORCE");
    const action = executableAction(intent.side, intent.packageSide);
    const marketable = limitCrosses(intent.limitPrice, intent.executionPrice, action);
    if (intent.orderType === "MARKET" && !marketable) throw new Error("ORDER_NOT_MARKETABLE");

    const accountId = await this.accountId(address);
    if (intent.accountId.toLowerCase() !== accountId.toLowerCase()) throw new Error("ACCOUNT_MISMATCH");
    const clearingApproved = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "isLockOperator",
      args: [accountId, setryn.atomicClearingEngine],
    });
    if (!clearingApproved) {
      const approvalHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "setLockOperator",
        args: [accountId, setryn.atomicClearingEngine, true],
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
      executionModeId: setryn.executionModeId,
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
    const levelId = await publicClient.readContract({
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "bestLevel",
      args: [bookId, makerSide],
    });
    if (levelId === EMPTY_ID) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("NO_ONCHAIN_LIQUIDITY");
    }
    const level = await publicClient.readContract({
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "getPriceLevel",
      args: [levelId],
    });
    const makerOrderHash = level.headOrderHash;
    const makerBookOrder = await publicClient.readContract({
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "getBookOrder",
      args: [makerOrderHash],
    });
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
    if (matchReceipt.status !== "success") throw new Error("MATCH_FAILED");
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
    if (!fillId || !positionId) throw new Error("CLEARING_EVIDENCE_MISSING");
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
    const position = {
      id: positionId,
      marketId: authorization.intent.marketId,
      side: packageSide,
      lots: filledLots,
      entryPrice: executionPrice,
      collateral:
        filledLots *
        Number(packageSide === "LONG" ? setryn.maxLongDebitMinorPerLot : setryn.maxShortDebitMinorPerLot) /
        1_000_000,
      state: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
    const takerFeeMinor = ledgerEvents.find(
      (event) => event.args.fillId === fillId && event.args.kind === 3,
    )?.args.amount ?? BigInt(0);
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
      guarantee: "Atomic onchain settlement",
      evidence: "DEVNET",
      createdAt: new Date().toISOString(),
    };
    const result: PackageExecutionResult = {
      fillId,
      outcome: "OPENED",
      requestedLots,
      filledLots,
      cancelledLots: receipt.cancelledLots,
      position,
      closedPositionId: null,
      closedLots: 0,
      receipt,
    };
    const updates: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "Order authorized", detail: "Signature and risk admission are bound." },
      { step: "SUBMITTED", label: "Order registered", detail: "Signed order registered onchain.", transactionHash: registrationHash },
      { step: "INCLUDED", label: "Match included", detail: "Best public liquidity cleared atomically.", transactionHash: matchHash },
      { step: "FILLED", label: "Package filled", detail: `${filledLots} lots filled at ${executionPrice}.`, transactionHash: matchHash },
      { step: "POSITION_CREATED", label: "Position created", detail: `Position ${positionId} is active.`, transactionHash: matchHash },
      { step: "RECEIPT_READY", label: "Receipt ready", detail: `Fill ${fillId} is verifiable onchain.`, transactionHash: matchHash },
    ];
    const execution = { id: fillId, orderHash: authorization.orderHash, updates, result, createdAt: receipt.createdAt };
    this.publish({
      ...this.snapshot,
      positions: [...this.snapshot.positions, position],
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

  reconcileRestingOrders(_markets: readonly PackageMarket[]): RestingPackageOrder[] {
    return this.snapshot.restingOrders;
  }

  async requestRfq(_authorization: SignedOrderAuthorization): Promise<RfqRequest> {
    throw new Error("ONCHAIN_RFQ_FLOW_NOT_READY");
  }

  async selectRfqQuote(_requestId: string, _quoteId: string): Promise<RfqRequest> {
    throw new Error("ONCHAIN_RFQ_FLOW_NOT_READY");
  }

  async cancelRfq(_requestId: string): Promise<RfqRequest> {
    throw new Error("ONCHAIN_RFQ_FLOW_NOT_READY");
  }

  async completeRfq(_requestId: string, _receiptId: string): Promise<RfqRequest> {
    throw new Error("ONCHAIN_RFQ_FLOW_NOT_READY");
  }

  async submitLocalMakerQuote(_requestId: string, _input: LocalMakerQuoteInput): Promise<RfqRequest> {
    throw new Error("ONCHAIN_RFQ_FLOW_NOT_READY");
  }

  async withdrawLocalMakerQuote(_requestId: string): Promise<RfqRequest> {
    throw new Error("ONCHAIN_RFQ_FLOW_NOT_READY");
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
        contractMultiplier: 2.5,
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
        contractMultiplier: 2.5,
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

  private async refreshActivity(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const accountId = await this.accountId(this.walletAddress);
    const [matches, positionEvents, ledgerEvents] = await Promise.all([
      this.publicClient.getContractEvents({
        address: this.setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        eventName: "DirectMatchExecuted",
        fromBlock: BigInt(0),
        toBlock: "latest",
      }),
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
    ]);
    const positions = [] as GatewaySnapshot["positions"];
    const receipts = [] as GatewaySnapshot["receipts"];
    const executions = [] as GatewaySnapshot["executions"];
    const blockTimes = new Map<bigint, string>();
    for (const match of matches) {
      const fillId = match.args.fillId;
      const makerOrderHash = match.args.makerOrderHash;
      const takerOrderHash = match.args.takerOrderHash;
      if (!fillId || !makerOrderHash || !takerOrderHash) continue;
      const [makerRecord, takerRecord] = await Promise.all([
        this.publicClient.readContract({
          address: this.setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [makerOrderHash],
        }),
        this.publicClient.readContract({
          address: this.setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [takerOrderHash],
        }),
      ]);
      const isTaker = takerRecord.order.accountId.toLowerCase() === accountId.toLowerCase();
      const isMaker = makerRecord.order.accountId.toLowerCase() === accountId.toLowerCase();
      if (!isTaker && !isMaker) continue;
      const ownRecord = isTaker ? takerRecord : makerRecord;
      const ownOrderHash = isTaker ? takerOrderHash : makerOrderHash;
      const positionEvent = positionEvents.find((event) => event.args.fillId === fillId);
      const positionId = positionEvent?.args.positionId;
      if (!positionId) continue;
      const filledLots = Number(match.args.fillLots ?? BigInt(0));
      const requestedLots = isTaker ? Number(ownRecord.order.lots) : filledLots;
      const packageSide: "LONG" | "SHORT" = ownRecord.order.side === 1 ? "LONG" : "SHORT";
      const price = Number(match.args.executionPriceTicks ?? BigInt(0)) / 10;
      const ownFeeKind = isTaker ? 3 : 2;
      const feeMinor = ledgerEvents.find(
        (event) =>
          event.args.fillId === fillId &&
          event.args.kind === ownFeeKind &&
          event.args.payerAccountId?.toLowerCase() === accountId.toLowerCase(),
      )?.args.amount ?? BigInt(0);
      let createdAt = new Date().toISOString();
      if (match.blockNumber != null) {
        const cached = blockTimes.get(match.blockNumber);
        if (cached) {
          createdAt = cached;
        } else {
          const block = await this.publicClient.getBlock({ blockNumber: match.blockNumber });
          createdAt = new Date(Number(block.timestamp) * 1000).toISOString();
          blockTimes.set(match.blockNumber, createdAt);
        }
      }
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
      const receipt: ExecutionReceipt = {
        id: fillId,
        orderHash: ownOrderHash,
        fillId,
        transactionHash: match.transactionHash,
        marketId: PRIMARY_MARKET_ID,
        packageCode: PRIMARY_MARKET_ID,
        packageSide,
        routeLabel: "Direct package book",
        lots: filledLots,
        requestedLots,
        filledLots,
        cancelledLots,
        price,
        fees: Number(formatUnits(feeMinor, 6)),
        guarantee: "Atomic onchain settlement",
        evidence: "DEVNET",
        createdAt,
      };
      const updates: SubmissionUpdate[] = [
        { step: "AUTHORIZED", label: "Order authorized", detail: "Signature and risk admission were bound." },
        { step: "SUBMITTED", label: "Order registered", detail: "Signed order registered onchain." },
        { step: "INCLUDED", label: "Match included", detail: "Public liquidity cleared atomically.", transactionHash: match.transactionHash },
        { step: "FILLED", label: "Package filled", detail: `${filledLots} lots filled at ${price}.`, transactionHash: match.transactionHash },
        { step: "POSITION_CREATED", label: "Position created", detail: `Position ${positionId} is active.`, transactionHash: match.transactionHash },
        { step: "RECEIPT_READY", label: "Receipt ready", detail: `Fill ${fillId} is verifiable onchain.`, transactionHash: match.transactionHash },
      ];
      positions.push(position);
      receipts.push(receipt);
      executions.push({
        id: fillId,
        orderHash: ownOrderHash,
        updates,
        result: {
          fillId,
          outcome: "OPENED",
          requestedLots,
          filledLots,
          cancelledLots,
          position,
          closedPositionId: null,
          closedLots: 0,
          receipt,
        },
        createdAt,
      });
    }
    this.publish({ ...this.snapshot, positions, receipts, executions });
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
        void Promise.all([this.refreshAccount(), this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity()]);
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
        void Promise.all([this.refreshAccount(), this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity()]);
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
