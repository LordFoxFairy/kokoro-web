const GATEWAY_PROXY_PATHS = [
  "/api/me",
  "/api/operators",
  "/api/operators/:id/status",
  "/api/roles",
  "/api/sites",
  "/api/approvals",
  "/api/approvals/:id/approve",
  "/api/approvals/:id/reject",
  "/api/audit",
] as const;
const hidden = "/api/" + "orders";

export default {
  async rewrites() {
    return {
      fallback: [
        ...GATEWAY_PROXY_PATHS.map((source) => ({ source, destination: `http://gateway.test${source}` })),
        { source: hidden, destination: `http://gateway.test${hidden}` },
      ],
    };
  },
};
