import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const SOURCE_EXTENSIONS = /\.(?:cjs|js|json|mjs|mts|ts|tsx|yaml|yml)$/u;
const SCAN_ROOTS = [
  "package.json",
  "apps/user",
  "apps/admin",
];

const USER_PLANS_ROUTE = "apps/user/src/app/api/billing/plans/route.ts";
const USER_API_ROUTES = new Set([
  "apps/user/src/app/api/auth/callback/route.ts",
  "apps/user/src/app/api/auth/logout/route.ts",
  "apps/user/src/app/api/auth/magic-link/request/route.ts",
  "apps/user/src/app/api/auth/session-state/route.ts",
  "apps/user/src/app/api/account/[action]/route.ts",
  USER_PLANS_ROUTE,
  "apps/user/src/app/api/dev/status/route.ts",
  "apps/user/src/app/api/hub/[...path]/route.ts",
  "apps/user/src/app/api/session/[...path]/route.ts",
  "apps/user/src/app/api/shared/[id]/route.ts",
  "apps/user/src/app/api/team/[...path]/route.ts",
  "apps/user/src/app/api/team/context/route.ts",
  "apps/user/src/app/api/team/switch/route.ts",
]);
const ALLOWED_USER_CATCH_ALL_ROUTES = new Set([
  "apps/user/src/app/api/hub/[...path]/route.ts",
  "apps/user/src/app/api/session/[...path]/route.ts",
  "apps/user/src/app/api/team/[...path]/route.ts",
]);
const RETIRED_ADMIN_GENERIC_ROUTES = new Set([
  "apps/admin/app/api/manifests/route.ts",
  "apps/admin/app/api/openapi/[moduleId]/route.ts",
  "apps/admin/app/api/resource/route.ts",
  "apps/admin/app/api/action/route.ts",
]);
const ADMIN_CONTROL_ROUTES = new Map([
  ["apps/admin/app/api/control/approvals/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/client", "@/lib/control-plane/http", "@/lib/control-plane/strict-query"],
  }],
  ["apps/admin/app/api/control/audit/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/client", "@/lib/control-plane/http", "@/lib/control-plane/strict-query"],
  }],
  ["apps/admin/app/api/control/auth/callback/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/authority-session", "@/lib/control-plane/identity-client"],
  }],
  ["apps/admin/app/api/control/auth/login/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/authority-session", "@/lib/control-plane/identity-client"],
  }],
  ["apps/admin/app/api/control/auth/logout/route.ts", {
    methods: ["POST"],
    imports: ["@/lib/control-plane/authority-session", "@/lib/control-plane/identity-client"],
  }],
  ["apps/admin/app/api/control/auth/step-up/callback/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/authority-session", "@/lib/control-plane/identity-client"],
  }],
  ["apps/admin/app/api/control/auth/step-up/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/authority-session", "@/lib/control-plane/identity-client"],
  }],
  ["apps/admin/app/api/control/credit/accounts/[accountRef]/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/accounts/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/grants/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/hold-allocations/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/holds/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/journal-entries/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/journal-transactions/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/rated-usage-source-allocations/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/rated-usage/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/credit/summary/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/credit-client", "@/lib/control-plane/credit-route-query", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/users/[userRef]/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/http", "@/lib/control-plane/strict-query", "@/lib/control-plane/user-client"],
  }],
  ["apps/admin/app/api/health/live/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/health"],
  }],
  ["apps/admin/app/api/health/ready/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/health"],
  }],
  ["apps/admin/app/api/control/models/route.ts", {
    methods: ["GET", "POST"],
    imports: ["@/lib/control-plane/client", "@/lib/control-plane/http", "@/lib/control-plane/strict-query"],
  }],
  ["apps/admin/app/api/control/operator/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/client", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/operators/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/client", "@/lib/control-plane/http", "@/lib/control-plane/strict-query"],
  }],
  ["apps/admin/app/api/control/sites/[siteId]/route.ts", {
    methods: ["GET"],
    imports: ["@/lib/control-plane/client", "@/lib/control-plane/http", "@/lib/control-plane/strict-query"],
  }],
  ["apps/admin/app/api/control/sites/releases/route.ts", {
    methods: ["POST"],
    imports: ["@/lib/control-plane/client", "@/lib/control-plane/http"],
  }],
  ["apps/admin/app/api/control/sites/route.ts", {
    methods: ["GET", "POST"],
    imports: ["@/lib/control-plane/client", "@/lib/control-plane/http", "@/lib/control-plane/strict-query"],
  }],
]);

for (const resource of ["credit-programs", "entitlement-templates", "offers", "redemption-programs",
  "code-batches"]) {
  ADMIN_CONTROL_ROUTES.set(`apps/admin/app/api/control/commerce/${resource}/route.ts`, {
    methods: ["GET", "POST"],
    imports: ["@/lib/commerce-contract", "@/lib/control-plane/commerce-client",
      "@/lib/control-plane/commerce-http", "@/lib/control-plane/http"],
  });
}
for (const [resource, parameter] of [["credit-programs", "revisionRef"],
  ["entitlement-templates", "revisionRef"], ["offers", "revisionRef"],
  ["redemption-programs", "revisionRef"], ["code-batches", "batchRef"]]) {
  ADMIN_CONTROL_ROUTES.set(`apps/admin/app/api/control/commerce/${resource}/[${parameter}]/route.ts`, {
    methods: ["GET"],
    imports: ["@/lib/control-plane/commerce-client", "@/lib/control-plane/commerce-http",
      "@/lib/control-plane/http"],
  });
}
for (const action of ["approve", "activate", "abandon", "suspend", "revoke"]) {
  ADMIN_CONTROL_ROUTES.set(
    `apps/admin/app/api/control/commerce/code-batches/[batchRef]/${action}/route.ts`,
    {
      methods: ["POST"],
      imports: ["@/lib/commerce-contract", "@/lib/control-plane/commerce-client",
        "@/lib/control-plane/commerce-http", "@/lib/control-plane/http"],
    },
  );
}
const ADMIN_API_ROUTES = new Set([
  ...ADMIN_CONTROL_ROUTES.keys(),
]);

function foldStaticStringConcatenations(source) {
  let folded = source;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = folded.replace(
      /(["'])([^"'\\]*)\1\s*\+\s*(["'])([^"'\\]*)\3/gu,
      (_match, _leftQuote, left, _rightQuote, right) => JSON.stringify(left + right),
    );
    if (next === folded) break;
    folded = next;
  }
  return folded;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function isNextRouteSource(path) {
  return /(?:^|\/)route\.[cm]?[jt]sx?$/u.test(path);
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}

async function filesUnder(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOTDIR") return [path];
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries
      .filter((entry) => ![".next", "node_modules"].includes(entry.name))
      .map((entry) => {
        const child = resolve(path, entry.name);
        return entry.isDirectory() ? filesUnder(child) : [child];
      }),
  );
  return nested.flat();
}

const RULES = [
  {
    id: "purchase-cta",
    rejects(path, source) {
      if (!path.startsWith("apps/user/src/") || path.includes("/app/api/")) return false;
      return (
        path.includes("/app/billing/pay/") ||
        /(?:pricing\.(?:buy|buying|buyUnavailable|loginRequired)|checkout_url|\.checkout\s*\(|\/billing\/pay\/|window\.location\.assign|MockPay)/u.test(
          source,
        )
      );
    },
  },
  {
    id: "checkout-bff",
    rejects(path, source) {
      return (
        path.startsWith("apps/user/src/app/api/") &&
        (/(?:^|\/)checkout(?:\/|$)/u.test(path) || /\/orders\/checkout|checkoutRequestSchema/u.test(source))
      );
    },
  },
  {
    id: "mock-bff",
    rejects(path, source) {
      return (
        path.startsWith("apps/user/src/app/api/") &&
        (/mock-pay/u.test(path) || /\/payments\/webhooks\/mock|mockPayRequestSchema/u.test(source))
      );
    },
  },
  {
    id: "refund-bff",
    rejects(path, source) {
      return path.startsWith("apps/user/src/app/api/") && /(?:refund|\/refunds?\b)/iu.test(`${path}\n${source}`);
    },
  },
  {
    id: "arbitrary-commerce-proxy",
    rejects(path, source) {
      return (
        path.startsWith("apps/user/src/app/api/") &&
        path.includes("[...") &&
        /(?:paymentBaseUrl|KOKORO_PAYMENT_BASE_URL|commerce|acquisition)/u.test(source)
      );
    },
  },
  {
    id: "admin-payment-surface",
    rejects(path, source) {
      if (!path.startsWith("apps/admin/")) return false;
      return (
        path.includes("/app/payment/") ||
        /(?:admin\.payment|platform\.modules\.payment|nav\.payment|href:\s*["']\/payment["']|moduleId[=:]\s*["']payment["']|payment\.order\.refund|ordersRefunded|ordersPaid|actionId:\s*["']refund["'])/u.test(
          source,
        )
      );
    },
  },
  {
    id: "admin-credit-legacy-surface",
    rejects(path, source) {
      if (!path.startsWith("apps/admin/")) return false;
      return /(?:\/api\/(?:billing-overview|user360)\b|moduleId\s*[:=]\s*["']credit["']|["']credit:[^"']+["']|admin\.credit\.(?:resources|actions)\.|\/admin\/credits?(?:\/|$))/u.test(
        source,
      );
    },
  },
  {
    id: "provider-secret-env",
    rejects(_path, source) {
      return /(?:KOKORO_PAYMENT_(?:MOCK|PROVIDER|WEBHOOK|STRIPE|PAYPAL)[A-Z0-9_]*SECRET|mockWebhookSecret|providerSecret|stripeSecret|paypalSecret)/u.test(
        source,
      );
    },
  },
  {
    id: "payment-sdk-init",
    rejects(path, source) {
      const sdk = "(?:stripe|@stripe/[^\"']+|paypal|@paypal/[^\"']+|braintree|adyen|square|@square/[^\"']+|checkout-sdk-node)";
      return (
        new RegExp(`(?:from\\s+|require\\s*\\(|import\\s*\\()\\s*["']${sdk}`, "u").test(source) ||
        /\b(?:new Stripe|loadStripe|paypal\.Buttons)\b/u.test(source) ||
        (path.endsWith("package.json") && new RegExp(`["']${sdk}["']\\s*:`, "u").test(source))
      );
    },
  },
  {
    id: "direct-payment-post",
    rejects(path, source) {
      if (!path.startsWith("apps/user/src/app/api/billing/")) return false;
      if (path !== USER_PLANS_ROUTE) return true;
      return /export\s+(?:async\s+function|const)\s+(?:POST|PUT|PATCH|DELETE|OPTIONS)\b/u.test(source);
    },
  },
  {
    id: "payment-rewrite",
    rejects(path, source) {
      if (!/(?:^|\/)(?:next\.config\.[cm]?[jt]s|proxy\.[cm]?[jt]s)$/u.test(path)) return false;
      return (
        /["']\/api\/(?:billing|payment)\/:?[^"']*\*/iu.test(source) ||
        /destination\s*:\s*[`"'][^`"']*payment/iu.test(source)
      );
    },
  },
  {
    id: "generic-platform-proxy",
    rejects(path, source) {
      return (
        path.startsWith("apps/user/src/app/api/") &&
        ((path.includes("[...") && !ALLOWED_USER_CATCH_ALL_ROUTES.has(path)) ||
          /(?:KOKORO_PLATFORM_BASE_URL|platformBaseUrl)/u.test(source))
      );
    },
  },
  {
    id: "payment-base-url-boundary",
    rejects(path, source) {
      if (!/(?:paymentBaseUrl|KOKORO_PAYMENT_BASE_URL)/u.test(source)) return false;
      return ![
        "apps/user/src/lib/server/auth.ts",
        USER_PLANS_ROUTE,
        "apps/user/.env.example",
      ].includes(path);
    },
  },
  {
    id: "admin-payment-bff",
    rejects(path, source) {
      if (RETIRED_ADMIN_GENERIC_ROUTES.has(path)) return true;
      if (path === "apps/admin/next.config.ts") {
        return /^\s*["']\/api\/(?:manifests|billing-overview|user360|resource|action)["'],?\s*$/mu.test(source);
      }
      return false;
    },
  },
  {
    id: "plans-post-reexport",
    rejects(path, source) {
      return (
        path === USER_PLANS_ROUTE &&
        (/export\s*\{[^}]*\b(?:POST|PUT|PATCH|DELETE|OPTIONS)\b[^}]*\}/u.test(source) ||
          /export\s*\*/u.test(source))
      );
    },
  },
  {
    id: "admin-proxy-bypass",
    rejects(path, source) {
      return (
        /^apps\/admin\/(?:next\.config|proxy)\.[cm]?[jt]s$/u.test(path) &&
        /["'`]\/api\/(?:manifests|billing-overview|user360|resource|action)["'`]/u.test(source)
      );
    },
  },
  {
    id: "admin-proxy-egress",
    rejects(path, source) {
      return path === "apps/admin/proxy.ts" && /(?:\bfetch\s*\(|KOKORO_(?:GATEWAY|PAYMENT)_BASE_URL|destination\s*:|https?:\/\/)/u.test(source);
    },
  },
];

export async function acquisitionShutdownViolations(root, scanRoots = SCAN_ROOTS) {
  const files = (
    await Promise.all(scanRoots.map((path) => filesUnder(resolve(root, path))))
  )
    .flat()
    .filter(
      (path) =>
        !/\.(?:spec|test)\.[^/]+$/u.test(path) &&
        (SOURCE_EXTENSIONS.test(path) || path.endsWith(".env.example")),
    );
  const violations = [];
  for (const file of files) {
    const path = relative(root, file).replaceAll("\\", "/");
    const source = foldStaticStringConcatenations(await readFile(file, "utf8"));
    for (const rule of RULES) {
      if (rule.rejects(path, source)) violations.push({ rule: rule.id, path });
    }
  }
  return violations.sort((left, right) => `${left.rule}:${left.path}`.localeCompare(`${right.rule}:${right.path}`));
}

export async function acquisitionShutdownTopologyViolations(
  root,
  { includeUserTopology = true } = {},
) {
  const violations = [];
  if (includeUserTopology) {
    const userRouteFiles = (await filesUnder(resolve(root, "apps/user/src/app/api")))
      .filter(isNextRouteSource)
      .map((path) => relative(root, path).replaceAll("\\", "/"));
    if (!sameSet(new Set(userRouteFiles), USER_API_ROUTES)) {
      violations.push({ rule: "user-api-route-inventory", path: "apps/user/src/app/api" });
    }
  }

  const adminRouteFiles = (await filesUnder(resolve(root, "apps/admin/app/api")))
    .filter(isNextRouteSource)
    .map((path) => relative(root, path).replaceAll("\\", "/"));
  if (!sameSet(new Set(adminRouteFiles), ADMIN_API_ROUTES)) {
    violations.push({ rule: "admin-api-route-inventory", path: "apps/admin/app/api" });
  }

  if (includeUserTopology) {
    const billingFiles = (await filesUnder(resolve(root, "apps/user/src/app/api/billing")))
      .filter((path) => SOURCE_EXTENSIONS.test(path))
      .map((path) => relative(root, path).replaceAll("\\", "/"))
      .sort();
    if (billingFiles.length !== 1 || billingFiles[0] !== USER_PLANS_ROUTE) {
      violations.push({ rule: "user-billing-route-allowlist", path: "apps/user/src/app/api/billing" });
    }

    let plansSource = "";
    try {
      plansSource = await readFile(resolve(root, USER_PLANS_ROUTE), "utf8");
    } catch {
      // Missing route is reported by the allowlist shape above.
    }
    if (
      !/export\s+async\s+function\s+GET\b/u.test(plansSource) ||
      /export\s+(?:async\s+function|const)\s+(?:POST|PUT|PATCH|DELETE|OPTIONS)\b/u.test(plansSource) ||
      /export\s*\{[^}]*\b(?:POST|PUT|PATCH|DELETE|OPTIONS)\b[^}]*\}/u.test(plansSource) ||
      /export\s*\*/u.test(plansSource)
    ) {
      violations.push({ rule: "user-plans-get-only", path: USER_PLANS_ROUTE });
    }
  }

  for (const [path, expected] of ADMIN_CONTROL_ROUTES) {
    let source = "";
    try {
      source = await readFile(resolve(root, path), "utf8");
    } catch {
      violations.push({ rule: "admin-control-route-missing", path });
      continue;
    }
    const exportedMethods = new Set(
      [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/gu)]
        .map((match) => match[1]),
    );
    if (
      !sameSet(exportedMethods, new Set(expected.methods)) ||
      !/export\s+const\s+runtime\s*=\s*["']nodejs["']/u.test(source) ||
      /\bfetch\s*\(|\bprocess\.env\b|export\s*\*/u.test(source)
    ) {
      violations.push({ rule: "admin-control-route-shape", path });
    }
    const internalImports = new Set(
      [...source.matchAll(/^\s*(?:import|export)\b[^"']*\bfrom\s*["']([^"']+)["']/gmu)]
        .map((match) => match[1])
        .filter((specifier) => specifier.startsWith("@/")),
    );
    if (!sameSet(internalImports, new Set(expected.imports))) {
      violations.push({ rule: "admin-control-route-import-graph", path });
    }
  }

  let adminNextConfig = "";
  try {
    adminNextConfig = foldStaticStringConcatenations(
      withoutComments(await readFile(resolve(root, "apps/admin/next.config.ts"), "utf8")),
    );
  } catch {
    // Missing configuration is an invalid closed topology too.
  }
  if (
    !/async\s+rewrites\s*\(\s*\)\s*\{\s*return\s*\{\s*beforeFiles\s*:\s*\[\s*\]\s*,\s*afterFiles\s*:\s*\[\s*\]\s*,\s*fallback\s*:\s*\[\s*\]\s*\}\s*;?\s*\}/u.test(adminNextConfig) ||
    /\bdestination\s*:|GATEWAY_PROXY_PATHS|["'`]\/api\//u.test(adminNextConfig)
  ) {
    violations.push({ rule: "admin-rewrite-allowlist", path: "apps/admin/next.config.ts" });
  }

  return violations.sort((left, right) => `${left.rule}:${left.path}`.localeCompare(`${right.rule}:${right.path}`));
}
