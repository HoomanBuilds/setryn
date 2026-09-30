import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
