import type { NextConfig } from "next";

// 浏览器同源调 /api/*，由 Next 反代到网关，避免 CORS；dev 模式网关默认 operator=admin@kokoro.local。
const gatewayUrl = process.env.KOKORO_GATEWAY_URL ?? "http://127.0.0.1:4290";

// 被反代到网关的浏览器面路径，逐条枚举（不再用 /api/:path* catch-all 无差别反代）。
// 必须与根仓契约 contract/openapi/admin-web-v1.yaml 的 paths 保持一致：14 条 path item / 16 个
// operation，顺序也照抄契约文档，便于逐条比对。契约增删 path 时必须同步改这里，否则新路由在浏览器面
// 直接 404（这是有意的：代理面可审计，后端加路由不会被前端无声吸收）。
// 路径参数用 Next 语法：契约的 {id} → :id。
const GATEWAY_PROXY_PATHS = [
  "/api/me",
  "/api/manifests",
  "/api/operators",
  "/api/operators/:id/status",
  "/api/roles",
  "/api/sites",
  "/api/billing-overview",
  "/api/user360",
  "/api/resource",
  "/api/action",
  "/api/approvals",
  "/api/approvals/:id/approve",
  "/api/approvals/:id/reject",
  "/api/audit",
] as const;

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
    // 仍放 fallback（而非 afterFiles）：fallback 在 pages 与 dynamic routes 全部落空后才生效，
    // 保证 /api/auth/* 先命中 Auth.js 的 [...nextauth] route。枚举项本身不含 /api/auth/*，
    // 但保留 fallback 让「本地路由优先于反代」这条性质不依赖枚举清单的正确性。
    return {
      fallback: GATEWAY_PROXY_PATHS.map((source) => ({ source, destination: `${gatewayUrl}${source}` })),
    };
  },
};

export default nextConfig;
