import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { AdminIdentityService } from "./admin-identity/kokoro/platform/identity/v1/admin_identity_pb";
import { AdminQueryService } from "./admin-query-v2/kokoro/platform/admin/v2/admin_query_pb";
import { AdminCommerceService } from "./admin-commerce/kokoro/platform/commerce/v1/admin_commerce_pb";
import { AdminCreditService } from "./admin-credit/kokoro/platform/credit/v1/admin_credit_pb";
import { SiteProvisioningService } from "./site-provisioning/kokoro/platform/site/v1/site_provisioning_pb";

const generatedRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(generatedRoot, "../..");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".next", "node_modules"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(?:ts|tsx)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function runtimeImports(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  return source.statements.flatMap((statement) => ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause?.isTypeOnly !== true
    ? [statement.moduleSpecifier.text] : []);
}

const sources = files(appRoot); const sourceSet = new Set(sources);
function resolveImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  let base = specifier.startsWith("@/") ? resolve(appRoot, specifier.slice(2)) : resolve(dirname(importer), specifier);
  if (base.endsWith(".js")) base = base.slice(0, -3);
  return [base, `${base}.ts`, `${base}.tsx`].find((candidate) => sourceSet.has(candidate)) ?? null;
}

describe("typed Admin control-plane mirrors", () => {
  it("exposes the complete Identity, Query, Commerce, Credit and Site provisioning RPC surfaces", () => {
    expect(Object.keys(AdminIdentityService.method)).toEqual(["beginOperatorLogin", "exchangeOidcSession",
      "getOperatorSessionDelivery", "beginStepUp", "completeStepUp", "signOut"]);
    expect(Object.keys(AdminQueryService.method)).toContain("getCurrentOperator");
    expect(Object.keys(AdminQueryService.method)).toContain("listPendingApprovals");
    expect(Object.keys(AdminCommerceService.method)).toEqual(["publishCreditProgramRevision",
      "listCreditProgramRevisions", "getCreditProgramRevision", "publishEntitlementTemplateRevision",
      "listEntitlementTemplateRevisions", "getEntitlementTemplateRevision", "publishOffer", "listOffers", "getOffer",
      "publishRedemptionProgram", "listRedemptionPrograms", "getRedemptionProgram", "issueCodeBatch",
      "listCodeBatches", "getCodeBatch", "approveCodeBatch", "activateCodeBatch", "abandonCodeBatch",
      "suspendCodeBatch", "revokeCodeBatch"]);
    expect(Object.keys(AdminCreditService.method)).toEqual(["getSiteCreditSummary", "listCreditAccounts",
      "getCreditAccount", "listCreditGrants", "listCreditHolds", "listCreditHoldAllocations",
      "listCreditJournalTransactions", "listCreditJournalEntries", "listRatedUsage",
      "listRatedUsageSourceAllocations"]);
    expect(Object.keys(SiteProvisioningService.method)).toEqual(["registerSite", "publishSiteRelease"]);
  });

  it("uses only the server-only HTTP/2 mTLS client boundary", () => {
    const transport = readFileSync(resolve(appRoot, "lib/control-plane/transport.ts"), "utf8");
    const client = readFileSync(resolve(appRoot, "lib/control-plane/client.ts"), "utf8");
    expect(transport).toContain('import "server-only"');
    expect(transport).toContain('httpVersion: "2"');
    expect(transport).toContain("rejectUnauthorized: true");
    expect(client).toContain("AdminCommerceService");
    expect(client).toContain("SiteProvisioningService");
    expect(readFileSync(resolve(appRoot, "lib/control-plane/credit-client.ts"), "utf8")).toContain("AdminCreditService");
    expect(client).not.toContain("/api/action");
    expect(`${transport}\n${client}`).not.toContain("KOKORO_ADMIN_PROXY_SECRET");
  });

  it("keeps generated descriptors and credentials out of client component bundles", () => {
    const roots = sources.filter((path) => readFileSync(path, "utf8").startsWith('"use client"'));
    const reached = new Set(roots); const pending = [...roots];
    while (pending.length > 0) {
      const importer = pending.pop()!;
      for (const specifier of runtimeImports(importer)) {
        const imported = resolveImport(importer, specifier);
        if (imported && !reached.has(imported)) { reached.add(imported); pending.push(imported); }
      }
    }
    const leaked = [...reached].filter((path) => path.includes(`${sep}lib${sep}generated${sep}`) ||
      path.includes(`${sep}lib${sep}control-plane${sep}`)).map((path) => relative(appRoot, path));
    expect(leaked).toEqual([]);
  });
});
