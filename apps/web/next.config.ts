import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@recruitintel/db", "@recruitintel/shared", "@recruitintel/types"],
  poweredByHeader: false,
};

export default nextConfig;
