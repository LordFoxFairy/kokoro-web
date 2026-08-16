import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadP0Catalog } from "../../scripts/test/catalog";

const appRoot = resolve(import.meta.dirname, "../..");

const requirements = [
  "WEB-IAM-FR-AUTH-001",
  "WEB-IAM-FR-AUTH-002",
  "WEB-IAM-FR-AUTH-003",
  "WEB-IAM-FR-SESSION-001",
  "WEB-IAM-FR-SESSION-002",
  "WEB-IAM-FR-USER-001",
  "WEB-IAM-FR-ORG-001",
  "WEB-IAM-FR-MEMBER-001",
  "WEB-IAM-FR-RBAC-001",
  "WEB-IAM-FR-RBAC-002",
  "WEB-IAM-FR-IDEM-001",
  "WEB-IAM-FR-AUDIT-001",
  "WEB-IAM-FR-DELETE-001",
  "WEB-IAM-FR-RPC-001",
  "WEB-IAM-FR-MODULE-001",
  "WEB-IAM-FR-I18N-001",
] as const;

const acceptance = [
  "WEB-IAM-ACC-AUTH-001",
  "WEB-IAM-ACC-AUTH-002",
  "WEB-IAM-ACC-AUTH-003",
  "WEB-IAM-ACC-SESSION-001",
  "WEB-IAM-ACC-USER-001",
  "WEB-IAM-ACC-ORG-001",
  "WEB-IAM-ACC-MEMBER-001",
  "WEB-IAM-ACC-RBAC-001",
  "WEB-IAM-ACC-IDEM-001",
  "WEB-IAM-ACC-AUDIT-001",
  "WEB-IAM-ACC-FRESH-001",
] as const;

const sharedPairIds = [
  "IAM-SEC-ENUM-001",
  "IAM-SEC-REDIRECT-001",
  "IAM-E2E-AUTH-001",
  "IAM-E2E-SESSION-001",
  "IAM-E2E-ORG-001",
  "IAM-E2E-MEMBER-001",
  "IAM-E2E-RBAC-001",
  "IAM-E2E-DELETE-001",
  "IAM-E2E-IDEM-001",
  "IAM-E2E-FRESH-001",
] as const;

describe("Admin Web P0 catalog", () => {
  it("WEB-CONTRACT-CATALOG-001 has one unique classified entry for every initial case", async () => {
    const catalog = await loadP0Catalog(resolve(appRoot, "test/catalog/p0.yaml"));
    const ids = catalog.cases.map((entry) => entry.id);
    const adminCases = catalog.cases.filter((entry) => entry.category !== "pair_e2e");
    const pairCases = catalog.cases.filter((entry) => entry.category === "pair_e2e");

    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.acceptance).toEqual({
      retryCount: 0,
      chromiumRounds: 2,
      freshFixturePerRound: true,
      allowSkip: false,
      allowTodo: false,
      realIamRequired: true,
      realPostgresqlRequired: true,
      realMailRequired: true,
    });
    expect(ids).toHaveLength(54);
    expect(new Set(ids).size).toBe(ids.length);
    expect(adminCases).toHaveLength(44);
    expect(adminCases.every((entry) => entry.status === "PLANNED" && entry.retries === 0)).toBe(true);
    expect(pairCases.map((entry) => entry.id)).toEqual(sharedPairIds);
    expect(pairCases.every((entry) => entry.status === "NOT_STARTED" && entry.testFile === null)).toBe(true);
  });

  it("WEB-CONTRACT-CATALOG-001 maps every product requirement and acceptance criterion", async () => {
    const catalog = await loadP0Catalog(resolve(appRoot, "test/catalog/p0.yaml"));
    const mappedRequirements = new Set(catalog.cases.flatMap((entry) => entry.requirements));
    const mappedAcceptance = new Set(catalog.cases.flatMap((entry) => entry.acceptance));

    expect([...mappedRequirements].sort()).toEqual([...requirements].sort());
    expect([...mappedAcceptance].sort()).toEqual([...acceptance].sort());
    for (const entry of catalog.cases) {
      expect(entry.title.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.evidence.length, entry.id).toBeGreaterThan(0);
      if (entry.category !== "pair_e2e") expect(entry.testFile, entry.id).toMatch(/\.test\.tsx?$/u);
    }
  });
});
