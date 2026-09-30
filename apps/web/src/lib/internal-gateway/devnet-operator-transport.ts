import { http, type Transport } from "viem";

/**
 * Transport for the local devnet operator's unlocked anvil account. Several routes send as the same operator at once
 * (maker liquidity, RFQ quotes and execution, risk admission, witnesses). viem fills each transaction's nonce from the
 * pending count before sending, so two concurrent sends can read the same nonce and one is rejected. Dropping the nonce
 * from eth_sendTransaction lets anvil assign it atomically when the transaction is accepted.
 */
export function devnetOperatorTransport(url: string): Transport {
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
