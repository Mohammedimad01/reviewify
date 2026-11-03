import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Keep these server-only parsers out of the bundler.
  serverExternalPackages: ["unpdf", "mammoth"],
};

export default nextConfig;
