import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Admin typed control-plane boundary", () => {
  it("derives Site scope from operator authority instead of a deployment default", () => {
    expect(source("lib/env.ts")).not.toContain("KOKORO_ADMIN_SITE_ID");
    expect(source("lib/control-plane/config.ts")).not.toMatch(/readonly siteId: string/u);
    const session = source("lib/control-plane/authority-session.ts");
    expect(session).toContain("matchingSites");
    expect(session).not.toContain("scope.site_id === config.siteId");
  });

  it("replaces the rotated session epoch and attestation after step-up", () => {
    const identity = source("lib/control-plane/identity-client.ts");
    const session = source("lib/control-plane/authority-session.ts");
    expect(identity).toContain("BigInt(session.sessionEpoch) + 1n");
    expect(identity).toContain("operatorAttestationDigest");
    expect(session).toContain("sessionEpoch: input.sessionEpoch");
  });

  it("uses typed Site and Audit control planes without a generic gateway fallback", () => {
    const client = source("lib/control-plane/client.ts");
    const sites = source("app/sites/page.tsx");
    const audit = source("app/audit/page.tsx");
    const provider = source("lib/refine/admin-data-provider.ts");
    const shell = source("components/shell/app-shell.tsx");
    expect(client).toContain("listSites");
    expect(client).toContain("getSite");
    expect(client).toContain("registerSiteRequestDigest");
    expect(client).toContain("publishSiteReleaseRequestDigest");
    expect(client).toContain("getAuditWithinScope");
    expect(provider).toContain("/api/control/sites");
    expect(sites).toContain("/api/control/sites/releases");
    expect(sites).not.toContain("ResourceTable");
    expect(sites).not.toContain("/api/resource");
    expect(provider).toContain("/api/control/audit");
    expect(audit).not.toContain("EndpointTable");
    expect(audit).not.toContain("/api/audit");
    expect(shell).toContain("/api/control/sites");
  });

  it("retains global authority for Site registration and narrows Site release authority", () => {
    const client = source("lib/control-plane/client.ts");
    const session = source("lib/control-plane/authority-session.ts");
    expect(session).toContain("globalScope");
    expect(client).toContain('commandContext(session, { kind: "global" })');
    expect(client).toContain('commandContext(session, { kind: "site", siteId: input.siteId })');
    expect(client).toContain("CandidateAuthorityBindingSchema");
    expect(client).toContain("candidateAuthorizationEpoch: strictPositiveUint64(input.candidateAuthorizationEpoch)");
    expect(client).not.toContain("certification.signatureBase64");
    expect(client).not.toContain("SiteLocalePolicySchema");
  });

  it("hard-cuts Commerce to its dedicated generated client and exact same-origin routes", () => {
    const client = source("lib/control-plane/client.ts");
    const commerce = source("lib/control-plane/commerce-client.ts");
    expect(client).not.toContain("AdminCommerceService");
    expect(commerce).toContain("AdminCommerceService");
    expect(commerce).toContain("issueCodeBatch");
    expect(commerce).toContain("approveCodeBatch");
    expect(commerce).not.toContain("commerceHardCut");
    expect(source("app/api/control/commerce/offers/route.ts")).toContain("publishOffer");
    expect(source("app/api/control/commerce/code-batches/[batchRef]/suspend/route.ts"))
      .toContain("suspendCodeBatch");
  });

  it("loads bounded cursor collections through the Site selector and Refine resources", () => {
    const shell = source("components/shell/app-shell.tsx");
    const sites = source("app/sites/page.tsx");
    const audit = source("app/audit/page.tsx");
    const approvals = source("app/approvals/page.tsx");
    const operators = source("app/operators/page.tsx");
    const overview = source("app/page.tsx");
    const provider = source("lib/refine/admin-data-provider.ts");
    expect(shell).toContain("collectCursorPages");
    expect(shell).toContain("maxItems: 1000");
    expect(shell).toContain("timeoutMs: 5_000");
    expect(shell).toContain("LatestRequest");
    expect(provider).toContain("max(1024)");
    expect(provider).toContain("cursor: { next:");
    expect(provider).toContain("pageToken");
    expect(provider).toContain("adminInfiniteResult");
    expect(provider).toContain("maxPages: 20");
    expect(provider).toContain("maxItems: 1000");
    for (const page of [overview, sites, approvals, audit, operators]) {
      expect(page).toContain("useInfiniteList<");
      expect(page).toContain('pageSize: 100');
      expect(page).toContain("getNextPageParam: adminNextPageParam");
    }
    for (const page of [sites, approvals, audit, operators]) {
      expect(page).toContain("fetchNextPage");
      expect(page).toContain("加载更多");
      expect(page).toContain("adminInfiniteResult");
      expect(page).not.toContain("pages.flatMap");
      expect(page).not.toContain("appendCursorPage");
      expect(page).not.toContain("LatestRequest");
    }
    expect(shell).toContain("adminSiteListSchema");
    expect(shell).toContain("operatorSchema");
    expect(shell).not.toContain("const currentOperatorSchema = z.object");
    expect(shell).not.toContain("const siteListSchema = z.object");
  });

  it("uses the owner-qualified Approval identity at the Refine boundary", () => {
    const client = source("lib/control-plane/client.ts");
    const provider = source("lib/refine/admin-data-provider.ts");
    const approvals = source("app/approvals/page.tsx");
    expect(client).toContain("PendingApprovalOwner");
    expect(provider).toContain("${item.owner}:${item.approvalRef}");
    expect(approvals).toContain('rowKey="id"');
    expect(approvals).not.toContain('rowKey="approvalRef"');
  });
});
