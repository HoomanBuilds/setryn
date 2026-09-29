import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The landing and the platform use separate root layouts.
    globalNotFound: true,
  },
};

export default nextConfig;
