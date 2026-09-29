// Sequential gas estimation for dependent deployment operations on a local Anvil fork.
//
// Each operation is estimated with eth_estimateGas against the fork state produced by every earlier
// operation, then applied to that local fork so the next estimate sees it. Writes only ever reach a
// loopback Anvil process spawned here; the upstream RPC is read-only and only serves forked state.
// Nothing is signed or broadcast, and no key is used: the planning sender is impersonated locally.

import { spawn } from "node:child_process";
import { createServer } from "node:net";

const LOOPBACK = "127.0.0.1";

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, LOOPBACK, () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${method} failed: ${payload.error.message}`);
  return payload.result;
}

async function waitForAnvil(url, child) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Anvil exited before becoming ready.");
    try {
      return await rpc(url, "web3_clientVersion");
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  throw new Error("Anvil fork did not become ready.");
}

// Anvil mines asynchronously while it waits on rate-limited upstream reads, so receipts are polled.
async function waitForReceipt(url, hash) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const receipt = await rpc(url, "eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Local fork did not mine ${hash}.`);
}

/// Estimates and applies every operation in canonical order on a fresh local fork at `forkBlock`.
/// `forkBlock` is a decimal block number or "latest".
export async function estimateSequentiallyOnFork({ forkUrl, forkBlock, from, operations }) {
  const port = await freePort();
  // Public archive RPCs rate-limit, so the fork retries upstream reads with backoff.
  const args = [
    "--fork-url", forkUrl, "--host", LOOPBACK, "--port", String(port), "--silent",
    "--retries", "12", "--fork-retry-backoff", "3000", "--compute-units-per-second", "200",
  ];
  if (forkBlock !== "latest") args.push("--fork-block-number", String(forkBlock));
  const child = spawn("anvil", args, { stdio: "ignore" });
  const url = `http://${LOOPBACK}:${port}`;
  try {
    const client = await waitForAnvil(url, child);
    if (!/anvil/i.test(client)) throw new Error(`Local fork client ${client} is not Anvil; refusing to write.`);
    const chainId = await rpc(url, "eth_chainId");
    if (BigInt(chainId) !== 42161n) throw new Error(`Local fork chain ${chainId} is not an Arbitrum One fork.`);
    const forkedBlock = await rpc(url, "eth_getBlockByNumber", ["latest", false]);
    await rpc(url, "anvil_impersonateAccount", [from]);
    await rpc(url, "anvil_setBalance", [from, "0x3635c9adc5dea00000"]);

    const results = new Map();
    for (const op of [...operations].sort((a, b) => a.order - b.order)) {
      const tx = op.kind === "CREATE"
        ? { from, data: op.initCode, value: op.value ?? "0x0" }
        : { from, to: op.to, data: op.data, value: op.value ?? "0x0" };
      const estimate = BigInt(await rpc(url, "eth_estimateGas", [tx]));
      const hash = await rpc(url, "eth_sendTransaction", [{ ...tx, gas: `0x${estimate.toString(16)}` }]);
      const receipt = await waitForReceipt(url, hash);
      if (BigInt(receipt.status) !== 1n) throw new Error(`Operation ${op.id} reverted on the local fork.`);
      if (op.kind === "CREATE" && op.expectedAddress && receipt.contractAddress?.toLowerCase() !== op.expectedAddress) {
        throw new Error(`Operation ${op.id} deployed at ${receipt.contractAddress}, expected ${op.expectedAddress}.`);
      }
      if (op.create2?.expectedAddress && (await rpc(url, "eth_getCode", [op.create2.expectedAddress, "latest"])) === "0x") {
        throw new Error(`Operation ${op.id} left no code at CREATE2 address ${op.create2.expectedAddress}.`);
      }
      results.set(op.id, { estimate, gasUsed: BigInt(receipt.gasUsed) });
    }
    return { forkedBlock: { number: Number.parseInt(forkedBlock.number, 16), hash: forkedBlock.hash }, results };
  } finally {
    child.kill("SIGTERM");
  }
}
