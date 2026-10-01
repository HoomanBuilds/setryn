import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // One setting drives both sides: the browser bundle is built for SETRYN_NETWORK unless it is overridden explicitly.
    NEXT_PUBLIC_SETRYN_NETWORK: process.env.NEXT_PUBLIC_SETRYN_NETWORK?.trim() || process.env.SETRYN_NETWORK?.trim() || "local",
  },
  // Server routes read the deployment's runtime, manifest and session-day files at request time from the repository's
  // deployments/ directory, outside this app. Tracing from the monorepo root ships them with every server bundle on
  // hosts such as Vercel, which only see traced files.
  outputFileTracingRoot: join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/**": ["../../deployments/*/runtime.json", "../../deployments/*/manifest.json", "../../deployments/*/session-days.json"],
  },
  turbopack: {
    root: join(__dirname, "../.."),
    resolveAlias: {
      // RainbowKit pulls in wagmi's Base Account connector, which lazy-loads this SDK in the browser when a user picks
      // that wallet. The SDK's Node entry adds CDP payment helpers whose optional x402 peers are not installed and break
      // the server compile, so server bundles, which never run a connector, get a stub; browsers get the real SDK.
      "@base-org/account": { browser: "@base-org/account", default: "./src/lib/wallet/base-account-server.ts" },
    },
  },
  experimental: {
    // The landing and the platform use separate root layouts.
    globalNotFound: true,
  },
  async headers() {
    const baseline = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    return [
      {
        // Widgets are built to be framed by partner sites; partner origins are checked by the attribution beacon.
        source: "/embed/:path*",
        headers: [...baseline, { key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        // Everything else, including wallet signing flows, refuses to be framed.
        source: "/:path((?!embed(?:/|$)).*)",
        headers: [
          ...baseline,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
