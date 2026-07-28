import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const SOURCE_EXTENSIONS = /\.(?:cjs|js|json|mjs|mts|ts|tsx|yaml|yml)$/u;
const SCAN_ROOTS = [
  "apps/user/src",
  "apps/user/.env.example",
  "apps/user/package.json",
  "apps/admin/app",
  "apps/admin/components",
  "apps/admin/lib",
  "apps/admin/.env.example",
  "apps/admin/package.json",
];

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
    rejects(_path, source) {
      return /(?:from\s+|require\s*\(|import\s*\()\s*["'](?:stripe|@stripe\/|paypal|@paypal\/|braintree|adyen|square|@square\/|checkout-sdk-node)|\b(?:new Stripe|loadStripe|paypal\.Buttons)\b/u.test(
        source,
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
