/**
 * User language for the gateway errors the RFQ builder and competition page can
 * meet. Anything unrecognised falls back to a message that claims no outcome.
 */

const COPY: Record<string, string> = {
  CONNECT_WALLET: "Connect a wallet before signing this request.",
  WRONG_NETWORK: "Switch the wallet to the Setryn network and try again.",
  WALLET_UNAVAILABLE: "No browser wallet was found. Install or unlock a wallet, then connect.",
  WALLET_CONNECTION_REJECTED: "The wallet did not share an account. Approve the connection to continue.",
  RUNTIME_UNAVAILABLE:
    "The local Setryn runtime is not running, so nothing can be signed. Start the local chain and deployment, then retry.",
  MARKET_NOT_ONCHAIN_ENABLED: "This market is not open for trading right now.",
  UNSUPPORTED_ONCHAIN_MARKET: "This market is not open for trading right now.",
  RECIPIENT_MISMATCH: "The recipient does not match the connected wallet.",
  ACCOUNT_MISMATCH: "The trading account does not match the connected wallet. Reconnect and retry.",
  INVALID_LOTS: "The local runtime authorizes 1 to 10 whole lots per order.",
  INVALID_LIMIT_PRICE: "Enter a valid package-price limit.",
  ORDER_NOT_MARKETABLE: "The limit no longer crosses the indicative solver price. Refresh the limit and retry.",
  INVALID_GTD_EXPIRY: "The quote window ended before signing. Choose the window again.",
  CLOSE_POSITION_NOT_FOUND: "The position to close is no longer active in this account.",
  CLOSE_POSITION_MISMATCH: "The position to close does not match this market and side.",
  FULL_POSITION_EXIT_REQUIRED: "An exit must close the complete open quantity.",
  EXIT_REQUIRES_FOK: "An exit uses all-or-none so a partial close cannot strand a hedge.",
  CLEARING_APPROVAL_FAILED: "The clearing engine approval did not confirm. Nothing was requested.",
  RISK_RESERVATION_FAILED: "Risk admission refused the order, so no request was committed.",
  RISK_BINDING_FAILED: "The risk admission could not be bound to the order. Nothing was requested.",
  PRIVATE_RFQ_AUTHORIZATION_REQUIRED: "The authorization was not signed for private RFQ disclosure.",
  SIGNER_MISMATCH: "The active wallet does not match the order authorization.",
  ORDER_REGISTRATION_FAILED: "The signed order did not register onchain, so no request was committed.",
  RFQ_QUOTE_FAILED:
    "The request is committed, but the maker did not return a quote. It stays open until its deadline in the RFQ ledger.",
  RFQ_NOT_FOUND: "The request is no longer available.",
  RFQ_NOT_OPEN: "The request is no longer open for selection.",
  RFQ_NOT_SELECTED: "The request has no selected quote to execute.",
  RFQ_QUOTE_NOT_FOUND: "The selected quote is no longer available. Select another quote.",
  RFQ_EXPIRED: "The quote or request expired before execution. Request fresh quotes.",
  RFQ_CAPACITY_EXCEEDED: "The quote no longer has capacity for the full size. Select another quote.",
  RFQ_SELECTION_LOCKED: "A selected quote stays locked until the request deadline, so it cannot be cancelled yet.",
  RFQ_SELECTION_FAILED: "The selection did not submit onchain. The quote was not locked.",
  RFQ_EXECUTION_FAILED: "Clearing did not complete. No fill is claimed; the request remains selected.",
  MAINNET_WRITE_DISABLED: "Mainnet writes are disabled in this environment.",
};

export function gatewayErrorCopy(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 4001) {
    return "The wallet request was rejected. Nothing was signed or submitted.";
  }
  if (!(error instanceof Error)) return "The gateway did not reach a final outcome. No request or fill is claimed.";
  if (/user rejected|user denied|rejected the request/i.test(error.message)) {
    return "The wallet request was rejected. Nothing was signed or submitted.";
  }
  return COPY[error.message] ?? "The gateway did not reach a final outcome. No request or fill is claimed.";
}

/** The raw code, kept for the expandable diagnostic. */
export function gatewayErrorCode(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 160);
  return "UNKNOWN_ERROR";
}
