import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
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
import type { PackageMarket } from "@/lib/terminal/types";
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
const EMPTY_ID = `0x${"0".repeat(64)}`;

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

  async authorizeOrder(_intent: PackageOrderIntent): Promise<SignedOrderAuthorization> {
    throw new Error("ONCHAIN_ORDER_FLOW_NOT_READY");
  }

  async submitAuthorizedOrder(
    _authorization: SignedOrderAuthorization,
    _onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
    throw new Error("ONCHAIN_ORDER_FLOW_NOT_READY");
  }

  async placeRestingOrder(_authorization: SignedOrderAuthorization): Promise<RestingPackageOrder> {
    throw new Error("ONCHAIN_ORDER_FLOW_NOT_READY");
  }

  async replaceRestingOrder(
    _oldOrderId: string,
    _authorization: SignedOrderAuthorization,
  ): Promise<RestingPackageOrder> {
    throw new Error("ONCHAIN_ORDER_FLOW_NOT_READY");
  }

  async cancelRestingOrder(_orderId: string): Promise<RestingPackageOrder> {
    throw new Error("ONCHAIN_ORDER_FLOW_NOT_READY");
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
