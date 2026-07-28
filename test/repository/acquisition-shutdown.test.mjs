import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  acquisitionShutdownTopologyViolations,
  acquisitionShutdownViolations,
  isNextRouteSource,
} from "./acquisition-shutdown-gate.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(import.meta.dirname, "fixtures/acquisition-shutdown");

test("route inventory recognizes every Next.js source extension", () => {
  for (const path of ["route.js", "route.jsx", "route.ts", "route.tsx", "route.mjs", "route.mts", "route.cjs", "route.cts"]) {
    assert.equal(isNextRouteSource(`/app/api/example/${path}`), true, path);
  }
  assert.equal(isNextRouteSource("/app/api/example/helper.ts"), false);
});

test("production sources expose no Web acquisition channel or Admin payment control surface", async () => {
  const violations = [
    ...(await acquisitionShutdownViolations(root)),
    ...(await acquisitionShutdownTopologyViolations(root)),
  ];
  assert.deepEqual(
    violations,
    [],
    `acquisition shutdown violations:\n${violations.map(({ rule, path }) => `- ${rule}: ${path}`).join("\n")}`,
  );
});

for (const fixture of [
  "purchase-cta",
  "checkout-bff",
  "mock-bff",
  "refund-bff",
  "arbitrary-commerce-proxy",
  "admin-payment-surface",
  "provider-secret-env",
  "payment-sdk-init",
  "direct-payment-post",
  "payment-rewrite",
  "generic-platform-proxy",
  "admin-payment-bff",
  "plans-post-reexport",
  "admin-proxy-bypass",
]) {
  test(`mutation gate rejects ${fixture} independently`, async () => {
    const violations = await acquisitionShutdownViolations(resolve(fixtureRoot, fixture));
    const rules = violations.map(({ rule }) => rule);
    assert.ok(rules.includes(fixture), `expected ${fixture}, received ${rules.join(", ") || "no violations"}`);
  });
}

for (const [fixture, expectedRule] of [
  ["user-api-inventory", "user-api-route-inventory"],
  ["admin-api-inventory", "admin-api-route-inventory"],
  ["plans-export-star", "user-plans-get-only"],
  ["admin-computed-rewrite", "admin-rewrite-allowlist"],
  ["admin-generic-proxy", "admin-proxy-egress"],
  ["admin-import-bypass", "admin-filtered-route-import-graph"],
  ["payment-base-concatenation", "payment-base-url-boundary"],
]) {
  test(`topology gate rejects ${fixture} independently`, async () => {
    const violations = [
      ...(await acquisitionShutdownViolations(resolve(fixtureRoot, fixture))),
      ...(await acquisitionShutdownTopologyViolations(resolve(fixtureRoot, fixture))),
    ];
    const rules = violations.map(({ rule }) => rule);
    assert.ok(rules.includes(expectedRule), `expected ${expectedRule}, received ${rules.join(", ") || "no violations"}`);
  });
}
