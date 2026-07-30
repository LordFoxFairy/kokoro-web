import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@kokoro/account-app", "@kokoro/asset-client", "@kokoro/chat-app"],
};

export default nextConfig;
