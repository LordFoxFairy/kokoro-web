import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@kokoro/chat-app"],
};

export default nextConfig;
