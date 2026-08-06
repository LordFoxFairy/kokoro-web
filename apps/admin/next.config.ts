import { resolve } from "node:path";

import type { NextConfig } from "next";

// 仅应用语义的响应头。传输层（HSTS）与边缘限流归反代/TLS 终结点（nginx/APISIX），不在此。
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 后台无需被任何站点内嵌；frame-ancestors 与 X-Frame-Options 双保险。严格 script-src(nonce) 待专项。
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  allowedDevOrigins: ["127.0.0.1"],
  // 共享窄包以 TS 源码分发（exports→src），需 Next 编译。
  transpilePackages: ["@kokoro/i18n"],
  webpack(config) {
    // Root-owned Protobuf-ES mirrors use ESM-correct `.js` specifiers while checking in TS sources.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return { beforeFiles: [], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
