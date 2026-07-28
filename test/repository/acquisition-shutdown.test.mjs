import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { acquisitionShutdownViolations } from "./acquisition-shutdown-gate.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(import.meta.dirname, "fixtures/acquisition-shutdown");

test("production sources expose no Web acquisition channel or Admin payment control surface", async () => {
  const violations = await acquisitionShutdownViolations(root);
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
]) {
  test(`mutation gate rejects ${fixture} independently`, async () => {
    const violations = await acquisitionShutdownViolations(resolve(fixtureRoot, fixture));
    assert.deepEqual(violations.map(({ rule }) => rule), [fixture]);
  });
}
