import { describeActionError } from "@/lib/internal-gateway/action-errors";
import { ActionError } from "@/lib/internal-gateway/action-progress";

/**
 * User language for the gateway errors the RFQ builder and competition page can
 * meet. Codes not listed here use the shared gateway copy, which also says which
 * steps of a multi-step action already landed.
 */

const COPY: Record<string, string> = {
  CONNECT_WALLET: "Connect a wallet before signing this request.",
  WRONG_NETWORK: "Switch the wallet to the Setryn network and try again.",
  WALLET_UNAVAILABLE: "The wallet prompt could not open. Reload the page, then connect.",
  WALLET_CONNECTION_REJECTED: "The wallet did not share an account. Approve the connection to continue.",
  RUNTIME_UNAVAILABLE: "The Setryn deployment could not be reached, so nothing can be signed. Retry in a moment.",
  MARKET_NOT_ONCHAIN_ENABLED: "This market is not open for trading right now.",
  UNSUPPORTED_ONCHAIN_MARKET: "This market is not open for trading right now.",
  RECIPIENT_MISMATCH: "The recipient does not match the connected wallet.",
  ACCOUNT_MISMATCH: "The trading account does not match the connected wallet. Reconnect and retry.",
  INVALID_LOTS: "Enter whole lots within the market's per-order maximum.",
  INVALID_LIMIT_PRICE: "Enter a valid price limit.",
  ORDER_NOT_MARKETABLE: "The limit no longer crosses the indicative solver price. Refresh the limit and retry.",
  INVALID_GTD_EXPIRY: "The quote window ended before signing. Choose the window again.",
  CLOSE_POSITION_NOT_FOUND: "The position to close is no longer active in this account.",
  CLOSE_POSITION_MISMATCH: "The position to close does not match this market and side.",
  FULL_POSITION_EXIT_REQUIRED: "An exit must close the complete open quantity.",
  EXIT_REQUIRES_FOK: "An exit uses all-or-none so a partial close cannot strand a hedge.",
  EXIT_REQUIRES_FIRM_QUOTE:
    "Full exits use the atomic firm maker route in the trading terminal. Private RFQ exits are disabled.",
  CLEARING_APPROVAL_FAILED: "The clearing engine approval did not confirm. Nothing was requested.",
  RISK_RESERVATION_FAILED: "Risk admission refused the order, so no request was committed.",
  FEE_SCHEDULE_CHANGED:
    "Protocol fees changed while this request was being reviewed. The estimate now shows the active schedule; review it and sign again.",
  MARKET_FEE_SCHEDULE_PENDING: "This market is moving to the new fee schedule. Nothing was signed; try again in a moment.",
  FEE_SCHEDULE_INACTIVE: "No protocol fee schedule is active right now, so new requests cannot clear. Nothing was signed.",
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
  INSUFFICIENT_WALLET_BALANCE: "The wallet does not hold enough USDC for this. Fund the wallet, deposit, and retry.",
  COUNTERPARTY_CONSENT_REQUIRED: "The counterparty's consent is required for this lifecycle action. Nothing was submitted.",
  MAKER_SIGNER_UNCONFIGURED: "No designated maker is configured on this network, so no house quote can answer. The request stays open for other makers.",
  OPERATOR_SIGNER_UNCONFIGURED: "The operator signer is not configured on this network, so risk admission cannot sign. Nothing was requested.",
  REFERENCE_UNAVAILABLE: "The Chainlink reference could not be read, so the maker cannot price this request. Retry in a moment.",
  QUOTE_OUTSIDE_MAKER_PRICE: "Your limit is outside the price the maker will quote. Widen the limit or wait for other makers.",
  NOT_AVAILABLE_ON_NETWORK: "This action is not available on the connected network.",
  RFQ_QUOTE_EXPIRED: "The quote expired before it could be locked. Select a fresher quote.",
  RFQ_QUOTE_TOO_CLOSE_TO_EXPIRY:
    "Too close to expiry: locking a quote takes several wallet confirmations, and this one has under 20 seconds left. Wait for a fresher quote.",
  RFQ_NOT_COLLECTING: "The request is not collecting quotes, so no quote can be locked on it.",
  RFQ_LOCKED_TO_OTHER_QUOTE:
    "An earlier attempt already locked another quote on this request. Execute that selection, or expire the request after its deadline.",
  RFQ_ALREADY_SETTLED: "This request already cleared in an earlier attempt. Its fill and receipt are in Activity.",
  // The private execution route (/api/internal/operator/rfq-execute).
  RFQ_NOT_SUBMITTED: "The selection has not reached private clearing yet. Execute again to finish it.",
  RFQ_PRICE_UNAVAILABLE: "The selected quote's price could not be read for clearing. No fill is claimed; try again shortly.",
  RISK_ADMISSION_MISSING: "The taker or maker risk admission is no longer bound, so clearing cannot start. No fill is claimed.",
  CAPACITY_LOCK_MISMATCH: "The maker's reserved capacity changed after selection, so clearing cannot start. No fill is claimed.",
  RFQ_CLEARING_FAILED: "The clearing transaction reverted. No fill is claimed; the request stays selected.",
  RFQ_CLEARING_EVIDENCE_MISSING:
    "Clearing confirmed onchain, but its fill evidence could not be read back. Check Activity before trying again.",
  RELAYER_SIGNER_UNCONFIGURED: "The settlement relayer is not configured on this network. No fill is claimed.",
};

/** Why the Setryn maker did not quote when the request opened, for the empty quote board. */
const HOUSE_QUOTE_COPY: Record<string, string> = {
  MAKER_SIGNER_UNCONFIGURED: "No Setryn maker runs on this network, so no house quote will arrive.",
  OPERATOR_SIGNER_UNCONFIGURED: "The Setryn maker cannot sign on this network right now, so it did not quote.",
  REFERENCE_UNAVAILABLE: "The Setryn maker could not read a fresh Chainlink reference, so it did not quote.",
  MARK_UNAVAILABLE: "The Setryn maker has no model inputs for this underlying, so it did not quote.",
  LISTING_UNSUPPORTED: "The Setryn maker has no listing to price this market from, so it did not quote.",
  QUOTE_OUTSIDE_RANGE: "This market has no room between its floor and cap, so the Setryn maker did not quote.",
  QUOTE_OUTSIDE_MAKER_PRICE: "Your limit is better than the price the Setryn maker quotes, so it did not quote.",
  QUOTE_ABOVE_REQUEST_LIMIT: "The Setryn maker's quote would exceed the size or fee cap you set, so it did not quote.",
  PARTIAL_QUOTE_NOT_ALLOWED: "The Setryn maker could only quote part of the size, and this request is all-or-none.",
  FEE_SCHEDULE_CHANGED: "Protocol fees changed after you signed, so the Setryn maker could not quote this request. Request again.",
  MARKET_NOT_ONCHAIN_ENABLED: "This market is not open for trading, so the Setryn maker did not quote.",
  MAKER_RISK_RESERVATION_FAILED: "The Setryn maker's risk capacity is used up, so it did not quote.",
  RFQ_NOT_COLLECTING: "The request was not open for quotes yet when the Setryn maker was asked.",
};

export function houseQuoteCopy(code: string): string {
  return HOUSE_QUOTE_COPY[code] ?? "The Setryn maker did not return a quote.";
}

export function gatewayErrorCopy(error: unknown): string {
  return describeActionError(error, { overrides: COPY });
}

/** The raw code, kept for the expandable diagnostic, with the step that failed. */
export function gatewayErrorCode(error: unknown): string {
  if (error instanceof ActionError) {
    const cause = error.cause instanceof Error && error.cause.message !== error.code ? ` (${error.cause.message.split("\n")[0]})` : "";
    return `${error.code}${error.failedStep ? ` at "${error.failedStep}"` : ""}${cause}`.slice(0, 240);
  }
  if (error instanceof Error) return error.message.slice(0, 160);
  return "UNKNOWN_ERROR";
}
