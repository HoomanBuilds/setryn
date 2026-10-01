/**
 * Server stand-in for `@base-org/account`. wagmi's Base Account connector imports the SDK lazily, only when a user
 * picks that wallet in the browser; the server render never runs a connector. The SDK's Node entry pulls in CDP
 * payment helpers whose optional x402 peers are not installed, so server builds resolve this module instead.
 */
export function createBaseAccountSDK(): never {
  throw new Error("BASE_ACCOUNT_SDK_BROWSER_ONLY");
}
