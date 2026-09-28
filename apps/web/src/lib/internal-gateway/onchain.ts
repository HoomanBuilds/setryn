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
  stringToHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { executableAction, limitCrosses } from "@/lib/terminal/economics";
import type { PackageMarket } from "@/lib/terminal/types";
import {
  orderStateAbi,
  publicOrderBookAbi,
  publicOrderTypedData,
  riskBindingAbi,
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
    this.publish({
      ...this.snapshot,
      wallet: { status: "CONNECTED", address, chainId: setryn.chainId },
    });
    await this.refreshAccount();
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
    if (!Number.isInteger(intent.lots) || intent.lots < 1 || intent.lots > 10) throw new Error("INVALID_LOTS");
    if (!Number.isFinite(intent.limitPrice)) throw new Error("INVALID_LIMIT_PRICE");
    if (intent.orderType !== "LIMIT" || !["GTC", "GTD"].includes(intent.timeInForce)) {
      throw new Error("ONCHAIN_AGGRESSIVE_ORDER_FLOW_NOT_READY");
    }
    const action = executableAction(intent.side, intent.packageSide);
    if (limitCrosses(intent.limitPrice, intent.executionPrice, action)) {
      throw new Error("ONCHAIN_AGGRESSIVE_ORDER_FLOW_NOT_READY");
    }

    const accountId = await this.accountId(address);
    if (intent.accountId.toLowerCase() !== accountId.toLowerCase()) throw new Error("ACCOUNT_MISMATCH");
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
    const timeInForce = intent.timeInForce === "GTC" ? 1 : 2;
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
      allowPartialFills: true,
      minimumFillLots: BigInt(1),
      remainderPolicy: 1,
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
    _authorization: SignedOrderAuthorization,
    _onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
    throw new Error("ONCHAIN_ORDER_FLOW_NOT_READY");
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
    await this.refreshAccount();
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
    await this.refreshAccount();
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

  private async fundNativeGas(address: Address): Promise<void> {
    const response = await fetch("/api/internal/devnet/fund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!response.ok) throw new Error("DEVNET_GAS_FUNDING_FAILED");
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
        void this.refreshAccount();
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
      if (connected) void this.refreshAccount();
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
