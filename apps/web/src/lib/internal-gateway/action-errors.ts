import { BaseError, ContractFunctionRevertedError, InsufficientFundsError } from "viem";
import { ActionError, errorCodes, isWalletRejection, type CompletedStep } from "./action-progress";

/*
 * User language for every gateway failure, one map for the ticket, collateral, RFQ and lifecycle surfaces. A failed
 * multi-step action (ActionError) is told from what actually happened: the step the user declined or that reverted, and
 * the steps that had already landed, so the copy never claims "nothing was submitted" after something was.
 */

const MESSAGES: Record<string, string> = {
  CONNECT_WALLET: "Connect a wallet before authorizing this package.",
  WALLET_CONNECTION_REJECTED: "The wallet connection was not completed. Nothing was signed or submitted.",
  WALLET_UNAVAILABLE: "The wallet prompt could not open, so nothing was signed or submitted. Reload the page and try again.",
  GAS_FUNDING_FAILED: "Gas could not be funded for this wallet, so nothing was submitted. Check the chain connection and try again.",
  INSUFFICIENT_AVAILABLE_COLLATERAL: "Available collateral plus released collateral no longer covers the fee cap.",
  AUTHORIZATION_EXPIRED: "The authorization expired before submission. Review and try again.",
  SIGNER_MISMATCH: "The active wallet does not match the package authorization.",
  MAINNET_WRITE_DISABLED: "Mainnet writes are disabled by the current Setryn environment.",
  CLOSE_POSITION_REQUIRED: "Select an active package position to close.",
  CLOSE_POSITION_FORBIDDEN_FOR_ENTRY: "Entry orders cannot reference a position to close.",
  POSITION_NOT_FOUND: "The selected position is no longer active in this account.",
  POSITION_MARKET_MISMATCH: "The selected position does not belong to this market.",
  INVALID_CLOSE_LOTS: "Enter a close quantity above zero.",
  CLOSE_LOTS_EXCEEDS_POSITION: "Quantity exceeds the selected package lots. Reduce quantity to close within the active package.",
  EXIT_REQUIRES_ZERO_COLLATERAL: "Exits require no new collateral. Review the ticket and try again.",
  FULL_POSITION_EXIT_REQUIRED: "Select the complete open quantity for this lifecycle exit.",
  EXIT_REQUIRES_FOK: "Lifecycle exits require fill-or-kill execution.",
  EXIT_REQUIRES_FIRM_QUOTE: "Full exits use the atomic firm maker route. Wait for a firm quote or settle the position at expiry.",
  POST_ONLY_WOULD_CROSS: "The book moved and this post-only order would take liquidity, so it was cancelled without a fill. Reprice behind the touch.",
  RESTING_ORDER_WOULD_CROSS: "The book moved and this limit now crosses, so it was cancelled without a fill. Resubmit to execute against the book.",
  EXIT_REQUIRES_COUNTERPARTY_MAKER: "The close must use the qualified maker that owns the original counterparty position.",
  QUOTE_SIZE_EXCEEDED: "The firm quote covers fewer lots than requested. Reduce the size or use the public book.",
  QUOTE_VERSION_STALE: "The series was re-versioned since this quote was signed. Wait a moment for a fresh quote.",
  FIRM_QUOTES_UNAVAILABLE: "This deployment has no firm-quote router. Use the public book.",
  QUOTE_EXIT_NOT_ALLOWED: "This quote does not allow closing a position with it. Wait a moment for the next quote.",
  EXIT_COUNTERPARTY_NOT_MAKER: "This position's counterparty is not the designated maker, so it cannot be closed against a maker quote in one transaction. It stays open until settlement.",
  CLOSE_POSITION_MISMATCH: "The selected position is not this account's position on this side of this market. Reselect it.",
  CLOSE_POSITION_NOT_FOUND: "The selected position is no longer open.",
  SETTLEMENT_REVERTED: "The settlement transaction reverted onchain. Nothing settled and nothing was left reserved.",
  COUNTERPARTY_CONSENT_REQUIRED: "The counterparty has not consented to this close yet. Nothing was submitted; try again shortly.",
  INSUFFICIENT_WALLET_BALANCE: "The wallet does not hold enough USDC for this deposit or fee. Nothing was submitted.",
  MAKER_SIGNER_UNCONFIGURED: "No designated maker is configured on this network, so no maker quote or counterparty is available.",
  OPERATOR_SIGNER_UNCONFIGURED: "The operator signer is not configured on this network, so the order cannot be admitted. Nothing was submitted.",
  REFERENCE_UNAVAILABLE: "The Chainlink reference could not be read, so the order cannot be priced safely. Nothing was submitted.",
  LISTING_UNSUPPORTED: "This market is not listed on the connected deployment.",
  QUOTE_OUTSIDE_MAKER_PRICE: "The requested price is outside the range the maker quotes. Adjust the limit and try again.",
  GOVERNANCE_TIMELOCK_REQUIRED: "This change needs a governance timelock and cannot be made from the terminal.",
  NOT_AVAILABLE_ON_NETWORK: "This action is not available on the connected network.",
  EXIT_QUANTITY_MISMATCH: "The close fill does not exactly offset the original position. Both positions remain visible for recovery.",
  EXIT_PARTICIPANT_MISMATCH: "The close fill changed the counterparty set and cannot use the direct unwind path.",
  RFQ_NOT_FOUND: "The RFQ request is no longer available. Confirm the ticket again for a fresh quote.",
  RFQ_NOT_OPEN: "The RFQ request is no longer open. Confirm the ticket again for a fresh quote.",
  RFQ_NOT_SELECTED: "The RFQ request is no longer selected. Confirm the ticket again for a fresh quote.",
  RFQ_QUOTE_NOT_FOUND: "The selected RFQ quote is no longer available. Select another quote.",
  RFQ_EXPIRED: "The selected RFQ quote expired before execution. Select another quote.",
  RFQ_REQUIRES_PRIVATE_DISCLOSURE: "The selected route requires a private RFQ disclosure.",
  RFQ_REQUIRES_SOLVER_ROUTE: "The selected route requires the solver RFQ route.",
  RFQ_CAPACITY_EXCEEDED: "The selected RFQ quote no longer has capacity for this size. Select another quote.",
  RFQ_RECEIPT_REQUIRED: "The execution completed but the RFQ receipt was missing.",
  RFQ_RECEIPT_NOT_FOUND: "The execution completed but the RFQ receipt was not found.",
  RFQ_RECEIPT_MARKET_MISMATCH: "The execution completed but the receipt did not match the RFQ market.",
  INVALID_CONTRACT_MULTIPLIER: "The package multiplier is invalid and no package outcome was recorded.",
  INVALID_PACKAGE_SIDE: "The package side is invalid. Select Long or Short and try again.",
  PACKAGE_SIDE_MISMATCH: "The ticket side does not match the selected position side. Reselect the position.",
  INVALID_LOTS: "Enter a package quantity above zero.",
  INVALID_FILL_LOTS: "The expected fill quantity is invalid. Review the ticket and try again.",
  FILL_EXCEEDS_REQUESTED: "The fill quantity cannot exceed the requested quantity.",
  FILL_MUST_EQUAL_REQUESTED: "Only IOC orders may partially fill. Use IOC or reduce to the available route capacity.",
  IOC_PARTIAL_REQUIRES_MARKETABLE: "Only a marketable IOC can partially fill. Adjust the limit to cross or reduce to route capacity.",
  REPLACEMENT_ORDER_NOT_FOUND: "The order to replace is no longer available.",
  REPLACEMENT_ORDER_NOT_WORKING: "The order to replace is no longer working. Amendment discarded.",
  REPLACEMENT_MISMATCH: "Amendment must keep account, market, package, intent, side, and close position.",
  REPLACEMENT_REQUIRES_LIMIT_GTC: "Amendment requires a limit GTC or GTD order.",
  REPLACEMENT_TIF_MISMATCH: "Amendment must keep the same time in force.",
  REPLACEMENT_ID_MISMATCH: "Replacement reference does not match the selected order.",
  GTD_EXPIRY_REQUIRED: "Select a GTD expiry in the future within 30 days.",
  GTD_EXPIRY_PAST: "GTD expiry must be in the future.",
  GTD_EXPIRY_TOO_FAR: "GTD expiry cannot exceed 30 days.",
  GTD_REQUIRES_LIMIT: "GTD requires a limit order.",
  EXPIRY_FORBIDDEN: "Only GTD orders carry an expiry.",
  INVALID_TIME_IN_FORCE: "The time in force is invalid.",
  REPLACE_FLOW_REQUIRED: "Replacement orders require the amend flow.",
  RESTING_ORDER_NOT_FOUND: "The working order is no longer available.",
  RESTING_ORDER_NOT_WORKING: "The working order is no longer working.",
  NO_ONCHAIN_LIQUIDITY: "No executable public-book liquidity is available at this price.",
  ORDER_NOT_MARKETABLE: "The limit does not cross the best public-book price.",
  FOK_NOT_FILLED: "The public book cannot fill the complete FOK quantity.",
  MAKER_RISK_ADMISSION_MISSING: "The best maker quote no longer has valid risk capacity.",
  MAKER_ORDER_EXPIRED: "The best resting maker order expired before it could be matched. No fill was created; try again.",
  MATCH_FAILED: "The public-book match reverted before a fill was created.",
  CLEARING_EVIDENCE_MISSING: "The clearing transaction completed without the required fill evidence.",
  REMAINDER_PLACEMENT_FAILED: "The matched quantity cleared, but the remaining quantity could not be placed on the public book.",
  UNSUPPORTED_ONCHAIN_MARKET: "This market is not open for trading right now.",
  FEE_SCHEDULE_CHANGED: "Protocol fees changed while this order was being reviewed. The estimate now shows the active schedule; review it and submit again.",
  MARKET_FEE_SCHEDULE_PENDING: "This market is moving to the new fee schedule. Nothing was signed; try again in a moment.",
  FEE_SCHEDULE_INACTIVE: "No protocol fee schedule is active right now, so new orders cannot clear. Nothing was signed.",
  QUOTE_UNAVAILABLE: "The firm quote expired or was replaced before you signed. Nothing was submitted; review the new quote and try again.",
  QUOTE_EXPIRED: "The firm quote expired or was replaced before you signed. Nothing was submitted; review the new quote and try again.",
  // Collateral, wallet and lifecycle codes the ticket never met.
  WRONG_NETWORK: "The wallet is on another network. Switch it to the Setryn network and try again.",
  ACCOUNT_MISMATCH: "The trading account does not match the connected wallet. Reconnect and try again.",
  INVALID_COLLATERAL_AMOUNT: "Enter an amount above zero.",
  UNSUPPORTED_COLLATERAL_ASSET: "Only USDC can be deposited as collateral.",
  RUNTIME_UNAVAILABLE: "The Setryn deployment could not be reached, so nothing was signed. Try again in a moment.",
  MARKET_NOT_ONCHAIN_ENABLED: "This market is not open for trading right now.",
  RECIPIENT_MISMATCH: "The recipient does not match the connected wallet.",
  RISK_RESERVATION_FAILED: "Risk admission refused this order, so nothing was submitted.",
  RISK_BINDING_FAILED: "The risk admission could not be bound to the order.",
  ORDER_REGISTRATION_FAILED: "The signed order did not register onchain.",
  CLEARING_APPROVAL_FAILED: "The one-time clearing approval did not confirm, so nothing was traded.",
  ORDER_AUTHORIZATION_UNAVAILABLE: "The order authorization is no longer available. Review the ticket and sign again.",
  INVALID_GTD_EXPIRY: "The order window ended before signing. Choose the expiry again.",
  ORDER_CANCELLATION_FAILED: "The cancel transaction did not confirm; the order may still be working.",
  ORDER_BOOK_SYNC_FAILED: "The order was cancelled, but the book did not update. It will drop off on the next read.",
  RISK_RELEASE_FAILED: "The order was cancelled, but its collateral reservation was not released yet.",
  RFQ_QUOTE_EXPIRED: "The quote expired before it could be locked. Select a fresher quote.",
  RFQ_SELECTION_LOCKED: "A selected quote stays locked until the request deadline, so it cannot be cancelled yet.",
  RFQ_NOT_SUBMITTED: "The selection did not reach private clearing yet. Select the quote again.",
  RFQ_CLEARING_FAILED: "Private clearing did not complete. No fill is claimed; the request stays selected.",
  CAPACITY_LOCK_MISMATCH: "The maker's capacity changed after selection. Request fresh quotes.",
  EXERCISE_WITNESS_FAILED: "The exercise witness could not be built from the final fixing. Try again shortly.",
  FINAL_FIXING_WITNESS_MISMATCH: "The final fixing changed while exercising. Review the position and try again.",
  LIFECYCLE_EXECUTOR_UNAVAILABLE: "Lifecycle execution is not configured on this network.",
  SETTLEMENT_TRANSACTION_FAILED: "The settlement transaction did not confirm.",
  TREASURY_CONTROLLER_REQUIRED: "Only the fee account's controller can withdraw from it.",
  TREASURY_WITHDRAWAL_REVERTED: "The withdrawal would revert onchain, so nothing was signed.",
  TREASURY_WITHDRAWAL_FAILED: "The withdrawal transaction reverted.",
  INSUFFICIENT_GAS: "The wallet does not hold enough ETH for gas. Add ETH from a faucet, then try again.",
};

/** Contract errors worth naming in the user's words, wherever a revert is decoded. */
const REVERTS: Record<string, string> = {
  InsufficientAvailable: "Available collateral does not cover this.",
  InsufficientMargin: "Available collateral does not cover this fill's margin.",
  QuoteAlreadyConsumed: "Another trader took that quote first.",
  QuoteExpired: "The quote expired before it was included.",
  OrderExpired: "The order expired before it was included.",
  NotAccountController: "This wallet does not control the account.",
  AccountMissing: "The trading account does not exist yet. Deposit first.",
};

/** Collateral copy that differs from the trading terminal's. */
export const COLLATERAL_COPY: Readonly<Record<string, string>> = {
  CONNECT_WALLET: "Connect a wallet first.",
  INSUFFICIENT_AVAILABLE_COLLATERAL: "That withdrawal exceeds available collateral: some is reserved by open positions or orders.",
  INSUFFICIENT_WALLET_BALANCE: "The wallet does not hold enough USDC for this deposit. Get test USDC or fund the wallet, then deposit.",
  INVALID_COLLATERAL_AMOUNT: "Enter an amount above zero.",
};

export const GENERIC_FAILURE = "The action did not reach a final outcome. No completion is claimed; check Activity before trying again.";

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function landed(completed: readonly CompletedStep[]): string {
  const labels = completed.map((step) => step.label);
  return labels.length === 1 ? `"${labels[0]}" already confirmed` : `${labels.length} steps already confirmed (${labels.join(", ")})`;
}

/** The decoded contract error name along an error's cause chain, if any. */
export function revertName(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? (reverted.data?.errorName ?? null) : null;
}

function codeMessage(code: string, overrides: Readonly<Record<string, string>>): string | null {
  if (overrides[code]) return overrides[code];
  if (MESSAGES[code]) return MESSAGES[code];
  if (code.startsWith("EXIT_COLLATERAL_REQUIRED")) {
    const amount = Number(code.split(":")[1]);
    return `Closing needs ${Number.isFinite(amount) ? `${amount.toFixed(2)} USDC` : "collateral"} available for a moment: the closing fill is margined before both positions close in the same transaction and release it. Deposit and try again.`;
  }
  if (code.startsWith("SETTLEMENT_REJECTED")) {
    const reason = code.split(":")[1] ?? "REVERTED";
    if (reason === "QuoteAlreadyConsumed") return "Another trader took that quote first. Nothing was submitted; the next quote is already streaming, try again.";
    if (reason === "NotAnOffset" || reason === "PositionIneligible" || reason === "OffsetUnwindNotConsented") {
      return `The router would not close this position against the quote (${reason}), so nothing was submitted and the position is unchanged.`;
    }
    if (reason === "InsufficientMargin") return "Available collateral does not cover this fill's margin, so nothing was submitted.";
    const named = /^0x[0-9a-f]+$/i.test(reason) ? "an undecoded error" : reason;
    return `The settlement router refused this fill (${named}) in simulation, so nothing was submitted. The quote may have been taken; try the next one.`;
  }
  return null;
}

/**
 * The user-facing sentence for a failed action. `overrides` replaces the copy of specific codes for one surface;
 * `fallback` is said when nothing more specific is known.
 */
export function describeActionError(
  error: unknown,
  options: { fallback?: string; overrides?: Readonly<Record<string, string>> } = {},
): string {
  const overrides = options.overrides ?? {};
  const fallback = options.fallback ?? GENERIC_FAILURE;
  if (error instanceof ActionError) {
    const { code, completed, failedStep, transactionHash } = error;
    const step = failedStep ? `"${failedStep}"` : "The next step";
    if (code === "WALLET_REJECTED") {
      if (completed.length === 0) return "The request was rejected in your wallet. Nothing was signed or submitted.";
      return `You declined ${step} in your wallet, so it was not sent; ${landed(completed)}. Nothing else changed.`;
    }
    if (code === "TRANSACTION_PENDING") {
      return `${step} was submitted${transactionHash ? ` (${shortHash(transactionHash)})` : ""} but the chain has not confirmed it yet. It may still land; check Activity or the explorer before trying again.`;
    }
    if (code === "TRANSACTION_REVERTED") {
      const reason = revertName(error.cause);
      const why = reason ? ` ${REVERTS[reason] ?? `The contract refused it (${reason}).`}` : "";
      const before = completed.length > 0 ? ` ${landed(completed)[0].toUpperCase()}${landed(completed).slice(1)}.` : "";
      return `${step} reverted onchain${transactionHash ? ` (${shortHash(transactionHash)})` : ""}.${why}${before}`;
    }
    const base = codeMessage(code, overrides) ?? describeRaw(error.cause, fallback, overrides);
    return completed.length > 0 ? `${base} (${landed(completed)}.)` : base;
  }
  return describeRaw(error, fallback, overrides);
}

function describeRaw(error: unknown, fallback: string, overrides: Readonly<Record<string, string>>): string {
  if (!(error instanceof Error)) return fallback;
  if (isWalletRejection(error)) return "The request was rejected in your wallet. Nothing was signed or submitted.";
  const coded = codeMessage(error.message, overrides);
  if (coded) return coded;
  if (error instanceof BaseError && error.walk((cause) => cause instanceof InsufficientFundsError)) return MESSAGES.INSUFFICIENT_GAS;
  if (/insufficient funds/i.test(error.message)) return MESSAGES.INSUFFICIENT_GAS;
  const reason = revertName(error);
  if (reason) return `${REVERTS[reason] ?? `The contract refused it (${reason}).`} Nothing changed.`;
  // A raw timeout here happened before any transaction existed (steps with a hash report TRANSACTION_PENDING instead).
  if (errorCodes(error).includes(-32603) || /rpc unavailable|fetch failed|failed to fetch|http request failed|took too long|timed out/i.test(error.message)) {
    return "The chain RPC did not respond, so nothing was submitted. Check the connection and try again.";
  }
  return fallback;
}
