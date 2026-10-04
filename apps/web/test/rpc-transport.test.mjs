import assert from "node:assert/strict";
import test from "node:test";

import { serverRpcUrls } from "../src/lib/internal-gateway/rpc-transport.ts";

test("Arbitrum Sepolia reads keep the private primary first and add public fallbacks", () => {
  const previous = process.env.SETRYN_RPC_FALLBACK_URLS;
  delete process.env.SETRYN_RPC_FALLBACK_URLS;
  try {
    const urls = serverRpcUrls("https://primary.example/v3/key", 421614);
    assert.deepEqual(urls, [
      "https://primary.example/v3/key",
      "https://sepolia-rollup.arbitrum.io/rpc",
      "https://arbitrum-sepolia-rpc.publicnode.com",
      "https://arbitrum-sepolia.drpc.org",
    ]);
  } finally {
    if (previous === undefined) delete process.env.SETRYN_RPC_FALLBACK_URLS;
    else process.env.SETRYN_RPC_FALLBACK_URLS = previous;
  }
});

test("configured fallbacks preserve order, remove duplicates, and stay chain scoped", () => {
  const previous = process.env.SETRYN_RPC_FALLBACK_URLS;
  process.env.SETRYN_RPC_FALLBACK_URLS = "https://one.example, https://primary.example, https://one.example, https://two.example";
  try {
    assert.deepEqual(serverRpcUrls("https://primary.example", 421614), ["https://primary.example", "https://one.example", "https://two.example"]);
    assert.deepEqual(serverRpcUrls("https://primary.example", 42161), ["https://primary.example"]);
  } finally {
    if (previous === undefined) delete process.env.SETRYN_RPC_FALLBACK_URLS;
    else process.env.SETRYN_RPC_FALLBACK_URLS = previous;
  }
});

test("network RPCs require HTTPS", () => {
  assert.throws(() => serverRpcUrls("http://primary.example", 421614), /INVALID_NETWORK_RPC_URL/);
});
