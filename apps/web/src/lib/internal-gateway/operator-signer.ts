import {
  createNonceManager,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { jsonRpc } from "viem/nonce";
import { privateKeyToAccount } from "viem/accounts";
import { networkChain as serverChain } from "./network";
import { serverReadTransport } from "./rpc-transport";
import type { SetrynNetwork, SetrynRuntime } from "./runtime";
import { readRuntime } from "./runtime-server";

/*
 * Server-side signers for the platform's own roles (docs/plans/network-runtime-real-data.md, section 5).
 *
 *   operator  risk admission, RFQ handoff execution, lifecycle witness staging, keeper calls
 *   maker     the optional designated maker: signed firm quotes (offchain), quote capacity, RFQ answers, consent
 *   relayer   the optional gasless relayer: submits users' signed quote settlements to the permissionless router
 *
 * Locally all are the runtime operator's unlocked anvil account, sent through the node. On a network each is a
 * configured private key (SETRYN_OPERATOR_PRIVATE_KEY, SETRYN_MAKER_PRIVATE_KEY, SETRYN_RELAYER_PRIVATE_KEY); without
 * one the role is unavailable. Each key is its own account, so each role has its own send queue and nonce sequence and
 * no role's transactions can take another's nonce. Keys are read here only, never logged, never returned.
 */

export type SignerRole = "operator" | "maker" | "relayer";

export type SignerErrorCode = "OPERATOR_SIGNER_UNCONFIGURED" | "MAKER_SIGNER_UNCONFIGURED" | "RELAYER_SIGNER_UNCONFIGURED";

/** A role's signer is not configured on this network. The message is the code, so routes can return it as is. */
export class SignerUnavailableError extends Error {
  readonly code: SignerErrorCode;
  readonly reason: string;

  constructor(code: SignerErrorCode, reason: string) {
    super(code);
    this.name = "SignerUnavailableError";
    this.code = code;
    this.reason = reason;
  }
}

export interface RoleSigner {
  role: SignerRole;
  address: Address;
  /** Sends as the role. On a network, writes from one account are serialized so concurrent routes never share a nonce. */
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient;
  setryn: SetrynRuntime;
}

export interface SignerStatus {
  available: boolean;
  /** The role's public address when it is configured; never a key. */
  address: Address | null;
  /** Why the role is unavailable, or null. */
  reason: string | null;
}

const KEY_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;
const ROLE_ENV: Record<SignerRole, "SETRYN_OPERATOR_PRIVATE_KEY" | "SETRYN_MAKER_PRIVATE_KEY" | "SETRYN_RELAYER_PRIVATE_KEY"> = {
  operator: "SETRYN_OPERATOR_PRIVATE_KEY",
  maker: "SETRYN_MAKER_PRIVATE_KEY",
  relayer: "SETRYN_RELAYER_PRIVATE_KEY",
};
const ROLE_CODE: Record<SignerRole, SignerErrorCode> = {
  operator: "OPERATOR_SIGNER_UNCONFIGURED",
  maker: "MAKER_SIGNER_UNCONFIGURED",
  relayer: "RELAYER_SIGNER_UNCONFIGURED",
};
const ROLE_MISSING: Record<SignerRole, string> = {
  operator: "No operator key is configured (SETRYN_OPERATOR_PRIVATE_KEY).",
  maker: "No designated maker key is configured (SETRYN_MAKER_PRIVATE_KEY).",
  relayer: "No relayer key is configured (SETRYN_RELAYER_PRIVATE_KEY); users submit their own settlements.",
};

/** Arbitrum One sends nothing from the server until mainnet writes are explicitly authorized. */
function mainnetWritesAuthorized(): boolean {
  return process.env.SETRYN_MAINNET_WRITES?.trim() === "authorized";
}

/*
 * Route bundles can load this module separately, so the send queues, the nonce manager and the chain checks live on
 * the server process's global object.
 */
const STATE_KEY = Symbol.for("setryn.operator-signer.state");

interface SignerState {
  queues: Map<string, Promise<unknown>>;
  nonceManager: ReturnType<typeof createNonceManager>;
  checkedChains: Map<string, Promise<void>>;
}

function state(): SignerState {
  const holder = globalThis as unknown as Record<symbol, SignerState | undefined>;
  holder[STATE_KEY] ??= {
    queues: new Map(),
    nonceManager: createNonceManager({ source: jsonRpc() }),
    checkedChains: new Map(),
  };
  return holder[STATE_KEY];
}

/** Runs `work` after every earlier send from the same account has been handed to the node. */
function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const queues = state().queues;
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  queues.set(key, run.catch(() => undefined));
  return run;
}

/**
 * Transport for the local node's unlocked accounts. Several routes send as the same account at once; viem fills each
 * transaction's nonce from the pending count before sending, so two concurrent sends can read the same nonce. Dropping
 * the nonce from eth_sendTransaction lets the node assign it atomically when the transaction is accepted.
 */
function localNodeTransport(url: string): Transport {
  const base = http(url);
  return (config) => {
    const transport = base(config);
    return {
      ...transport,
      async request({ method, params }) {
        if (method === "eth_sendTransaction" && Array.isArray(params) && params[0] && typeof params[0] === "object") {
          const [transaction, ...rest] = params as [Record<string, unknown>, ...unknown[]];
          const { nonce: _nonce, ...withoutNonce } = transaction;
          void _nonce;
          return transport.request({ method, params: [withoutNonce, ...rest] });
        }
        return transport.request({ method, params });
      },
    } as ReturnType<Transport>;
  };
}

function publicClientFor(setryn: SetrynRuntime): PublicClient {
  const network = setryn.network ?? "local";
  const transport =
    network === "local"
      ? http(setryn.rpcUrl)
      : serverReadTransport(setryn.rpcUrl, setryn.chainId, { timeout: 8_000 });
  return createPublicClient({ chain: serverChain(network, setryn.rpcUrl), transport, pollingInterval: network === "local" ? 250 : 1_000 }) as PublicClient;
}

/** A signer for any unlocked account of the local node (the local deployment assigns roles to anvil accounts). */
export function localAccountSigner(setryn: SetrynRuntime, role: SignerRole, address: Address): RoleSigner {
  if ((setryn.network ?? "local") !== "local") throw new Error("LOCAL_ACCOUNTS_ONLY");
  const account = getAddress(address);
  const walletClient = createWalletClient({
    account,
    chain: serverChain("local", setryn.rpcUrl),
    transport: localNodeTransport(setryn.rpcUrl),
  }) as unknown as WalletClient<Transport, Chain, Account>;
  return { role, address: account, walletClient, publicClient: publicClientFor(setryn), setryn };
}

function configuredKey(role: SignerRole): Hex | null {
  const raw = process.env[ROLE_ENV[role]]?.trim();
  if (!raw) return null;
  if (!KEY_PATTERN.test(raw)) {
    // The key itself is never echoed.
    console.error(`[operator-signer] ${ROLE_ENV[role]} is not a 32-byte hex private key; the ${role} role stays unavailable.`);
    return null;
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

/** Why a network role cannot sign, or null when its key is configured and writes are allowed on the network. */
function networkRefusal(network: SetrynNetwork, role: SignerRole): string | null {
  if (network === "arbitrum-one" && !mainnetWritesAuthorized()) {
    return "Server-side writes on Arbitrum One are not authorized (set SETRYN_MAINNET_WRITES=authorized).";
  }
  if (!configuredKey(role)) return ROLE_MISSING[role];
  return null;
}

/** Confirms once per RPC that the node serves the network's chain before anything is signed for it. */
function assertChain(setryn: SetrynRuntime, publicClient: PublicClient): Promise<void> {
  const checks = state().checkedChains;
  const key = `${setryn.rpcUrl}:${setryn.chainId}`;
  let check = checks.get(key);
  if (!check) {
    check = publicClient.getChainId().then((observed) => {
      if (observed !== setryn.chainId) throw new Error("RPC_CHAIN_MISMATCH");
    });
    checks.set(key, check);
    check.catch(() => checks.delete(key));
  }
  return check;
}

function networkSigner(setryn: SetrynRuntime, role: SignerRole, key: Hex): RoleSigner {
  const network = setryn.network ?? "local";
  const { nonceManager } = state();
  const account = privateKeyToAccount(key, { nonceManager });
  const chain = serverChain(network, setryn.rpcUrl);
  const base = createWalletClient({ account, chain, transport: http(setryn.rpcUrl) });
  const queueKey = `${setryn.chainId}:${account.address.toLowerCase()}`;
  // A send that fails after its nonce was taken (estimation, signing or the node refusing it) would leave a gap that
  // stalls every later send, so the account's nonce is re-read from the chain after any failure.
  const guarded = <T>(work: () => Promise<T>) =>
    serialize(queueKey, () =>
      work().catch((error: unknown) => {
        nonceManager.reset({ address: account.address, chainId: setryn.chainId });
        throw error;
      }),
    );
  const walletClient = base.extend((client) => ({
    writeContract: ((parameters: Parameters<typeof client.writeContract>[0]) =>
      guarded(() => client.writeContract(parameters))) as typeof client.writeContract,
    sendTransaction: ((parameters: Parameters<typeof client.sendTransaction>[0]) =>
      guarded(() => client.sendTransaction(parameters))) as typeof client.sendTransaction,
  })) as unknown as WalletClient<Transport, Chain, Account>;
  return { role, address: account.address, walletClient, publicClient: publicClientFor(setryn), setryn };
}

async function roleSigner(role: SignerRole, runtime?: SetrynRuntime): Promise<RoleSigner> {
  const setryn = runtime ?? (await readRuntime());
  const network = setryn.network ?? "local";
  if (network === "local") {
    // The local deployment's operator account rests the house quotes too.
    return localAccountSigner(setryn, role, getAddress(setryn.operator));
  }
  const refusal = networkRefusal(network, role);
  const key = configuredKey(role);
  if (refusal || !key) throw new SignerUnavailableError(ROLE_CODE[role], refusal ?? "Not configured.");
  const signer = networkSigner(setryn, role, key);
  await assertChain(setryn, signer.publicClient);
  return signer;
}

/** The operator role's signer, or SignerUnavailableError("OPERATOR_SIGNER_UNCONFIGURED"). */
export function operatorSigner(runtime?: SetrynRuntime): Promise<RoleSigner> {
  return roleSigner("operator", runtime);
}

/** The designated maker's signer, or SignerUnavailableError("MAKER_SIGNER_UNCONFIGURED"). */
export function makerSigner(runtime?: SetrynRuntime): Promise<RoleSigner> {
  return roleSigner("maker", runtime);
}

/** The optional settlement relayer's signer, or SignerUnavailableError("RELAYER_SIGNER_UNCONFIGURED"). */
export function relayerSigner(runtime?: SetrynRuntime): Promise<RoleSigner> {
  return roleSigner("relayer", runtime);
}

function roleStatus(setryn: SetrynRuntime, role: SignerRole): SignerStatus {
  const network = setryn.network ?? "local";
  if (network === "local") return { available: true, address: getAddress(setryn.operator), reason: null };
  const refusal = networkRefusal(network, role);
  const key = configuredKey(role);
  const address = key ? privateKeyToAccount(key).address : null;
  return { available: refusal === null, address, reason: refusal };
}

/** Which roles can sign on this deployment, with their public addresses, for status reporting. No secrets. */
export function signerAvailability(setryn: SetrynRuntime): Record<SignerRole, SignerStatus> {
  return {
    operator: roleStatus(setryn, "operator"),
    maker: roleStatus(setryn, "maker"),
    relayer: roleStatus(setryn, "relayer"),
  };
}

/** A route's refusal for an unavailable role: 503 with the role's code, nothing else. */
export function signerUnavailableResponse(error: unknown): Response | null {
  if (!(error instanceof SignerUnavailableError)) return null;
  return Response.json({ error: error.code, message: error.reason }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
