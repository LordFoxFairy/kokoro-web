import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const SOURCE_EXTENSIONS = /\.(?:cjs|js|json|mjs|mts|ts|tsx|yaml|yml)$/u;
const SCAN_ROOTS = [
  "package.json",
  "apps/user",
  "apps/admin",
];

const USER_PLANS_ROUTE = "apps/user/src/app/api/billing/plans/route.ts";
const ALLOWED_USER_CATCH_ALL_ROUTES = new Set([
  "apps/user/src/app/api/hub/[...path]/route.ts",
  "apps/user/src/app/api/session/[...path]/route.ts",
  "apps/user/src/app/api/team/[...path]/route.ts",
]);
const ADMIN_FILTERED_ROUTES = new Map([
  ["apps/admin/app/api/manifests/route.ts", { method: "GET", handler: "getFilteredManifests" }],
  ["apps/admin/app/api/billing-overview/route.ts", { method: "GET", handler: "getCreditBillingOverview" }],
  ["apps/admin/app/api/user360/route.ts", { method: "GET", handler: "getAccountUser360" }],
  ["apps/admin/app/api/resource/route.ts", { method: "GET", handler: "getFilteredResource" }],
  ["apps/admin/app/api/action/route.ts", { method: "POST", handler: "postFilteredAction" }],
]);

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
      const expected = ADMIN_FILTERED_ROUTES.get(path);
      if (expected !== undefined) {
        return (
          !source.includes(`@/lib/admin-gateway`) ||
          !source.includes(expected.handler) ||
          !new RegExp(`export\\s+async\\s+function\\s+${expected.method}\\b`, "u").test(source) ||
          /\bfetch\s*\(/u.test(source)
        );
      }
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
        /export\s*\{[^}]*\b(?:POST|PUT|PATCH|DELETE|OPTIONS)\b[^}]*\}/u.test(source)
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
];

export async function acquisitionShutdownViolations(root) {
  const files = (
    await Promise.all(SCAN_ROOTS.map((path) => filesUnder(resolve(root, path))))
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
    const source = await readFile(file, "utf8");
    for (const rule of RULES) {
      if (rule.rejects(path, source)) violations.push({ rule: rule.id, path });
    }
  }
  return violations.sort((left, right) => `${left.rule}:${left.path}`.localeCompare(`${right.rule}:${right.path}`));
}

export async function acquisitionShutdownTopologyViolations(root) {
  const violations = [];
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
    /export\s*\{[^}]*\b(?:POST|PUT|PATCH|DELETE|OPTIONS)\b[^}]*\}/u.test(plansSource)
  ) {
    violations.push({ rule: "user-plans-get-only", path: USER_PLANS_ROUTE });
  }

  for (const [path, expected] of ADMIN_FILTERED_ROUTES) {
    let source = "";
    try {
      source = await readFile(resolve(root, path), "utf8");
    } catch {
      violations.push({ rule: "admin-filtered-route-missing", path });
      continue;
    }
    if (
      !source.includes("@/lib/admin-gateway") ||
      !source.includes(expected.handler) ||
      !new RegExp(`export\\s+async\\s+function\\s+${expected.method}\\b`, "u").test(source)
    ) {
      violations.push({ rule: "admin-filtered-route-shape", path });
    }
  }

  return violations.sort((left, right) => `${left.rule}:${left.path}`.localeCompare(`${right.rule}:${right.path}`));
}
