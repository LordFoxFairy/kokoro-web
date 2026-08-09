import { describe, expect, it } from "vitest";

import {
  ADMIN_SURFACE_PERMISSION,
  adminNavigationAccess,
  authorizedCreditNavigation,
  canAccessAdminSurface,
  creditAccessPlan,
  firstCreditView,
  visibleCreditViews,
} from "./admin-surface-permissions";

describe("signed Admin surface permission matrix", () => {
  it("matches the Platform operation contract exactly", () => {
    expect(ADMIN_SURFACE_PERMISSION).toEqual({
      commerceCreditProgramsRead: "commerce.credit-program.read",
      commerceCreditProgramsPublish: "commerce.credit-program.publish",
      commerceEntitlementTemplatesRead: "commerce.entitlement-template.read",
      commerceEntitlementTemplatesPublish: "commerce.entitlement-template.publish",
      commerceOffersRead: "commerce.offer.read",
      commerceOffersPublish: "commerce.offer.publish",
      commerceRedemptionProgramsRead: "commerce.redemption-program.read",
      commerceRedemptionProgramsPublish: "commerce.redemption-program.publish",
      commerceCodeBatchesRead: "commerce.code-batch.read",
      commerceCodeBatchesIssue: "commerce.code-batch.issue",
      commerceCodeBatchesApprove: "commerce.code-batch.approve",
      commerceCodeBatchesActivate: "commerce.code-batch.activate",
      commerceCodeBatchesAbandon: "commerce.code-batch.abandon",
      commerceCodeBatchesSuspend: "commerce.code-batch.suspend",
      commerceCodeBatchesRevoke: "commerce.code-batch.revoke",
      creditSummary: "credit.summary.read",
      creditAccounts: "credit.account.read",
      creditAccountDetail: "credit.account.read",
      creditGrants: "credit.grant.read",
      creditHolds: "credit.hold.read",
      creditHoldAllocations: "credit.hold.read",
      creditJournalTransactions: "credit.journal.read",
      creditJournalEntries: "credit.journal.read",
      creditRatedUsage: "credit.rated-usage.read",
      creditRatedUsageSourceAllocations: "credit.rated-usage.read",
      users: "admin.user.read",
    });
  });

  it("keeps the Commerce maker/checker and terminal batch action matrix explicit", async () => {
    const { codeBatchActionAccess, commerceAccessPlan } = await import("./commerce-permissions");
    const permissions = [
      "commerce.credit-program.read",
      "commerce.offer.publish",
      "commerce.code-batch.*",
    ];

    expect(commerceAccessPlan(permissions)).toMatchObject({
      creditPrograms: { read: true, publish: false },
      offers: { read: false, publish: true },
      codeBatches: { read: true, issue: true, approve: true, activate: true },
    });
    expect(codeBatchActionAccess({
      permissions,
      operatorRef: "operator:maker",
      batch: { state: "draft", approvalState: "pending", createdByOperatorRef: "operator:maker" },
    })).toEqual({ approve: false, activate: false, abandon: true, suspend: false, revoke: false });
    expect(codeBatchActionAccess({
      permissions,
      operatorRef: "operator:checker",
      batch: { state: "draft", approvalState: "pending", createdByOperatorRef: "operator:maker" },
    })).toEqual({ approve: true, activate: false, abandon: true, suspend: false, revoke: false });
    expect(codeBatchActionAccess({
      permissions,
      operatorRef: "operator:checker",
      batch: { state: "suspended", approvalState: "approved", createdByOperatorRef: "operator:maker" },
    })).toEqual({ approve: false, activate: false, abandon: false, suspend: false, revoke: true });
  });

  it("gives account-only operators only the account list and detail", () => {
    const access = creditAccessPlan(["credit.account.read"]);
    expect(access).toEqual({
      summary: false,
      accounts: true,
      accountDetail: true,
      grants: false,
      holds: false,
      holdAllocations: false,
      journalTransactions: false,
      journalEntries: false,
      ratedUsage: false,
      ratedUsageSourceAllocations: false,
    });
    expect(firstCreditView(access)).toBe("accounts");
    expect(visibleCreditViews(access)).toEqual(["accounts"]);
    expect(authorizedCreditNavigation({ view: "grants", filters: {} }, access)).toBeNull();
  });

  it("allows summary-only without enabling any table request", () => {
    const access = creditAccessPlan(["credit.summary.read"]);
    expect(access.summary).toBe(true);
    expect(firstCreditView(access)).toBeNull();
    expect(visibleCreditViews(access)).toEqual([]);
    expect(Object.entries(access).filter(([key, allowed]) => key !== "summary" && allowed)).toEqual([]);
  });

  it("starts grant-only operators on Grant and blocks Hold drilldown", () => {
    const access = creditAccessPlan(["credit.grant.read"]);
    expect(firstCreditView(access)).toBe("grants");
    expect(visibleCreditViews(access)).toEqual(["grants"]);
    expect(authorizedCreditNavigation({ view: "grants", filters: { creditGrantId: "grant-1" } }, access))
      .toEqual({ view: "grants", filters: { creditGrantId: "grant-1" } });
    expect(authorizedCreditNavigation({ view: "holds", filters: { creditGrantId: "grant-1" } }, access))
      .toBeNull();
  });

  it("keeps users-only and no-permission operators outside Credit", () => {
    const usersOnly = ["admin.user.read"];
    expect(canAccessAdminSurface(usersOnly, "users")).toBe(true);
    expect(firstCreditView(creditAccessPlan(usersOnly))).toBeNull();
    expect(Object.values(creditAccessPlan(usersOnly)).some(Boolean)).toBe(false);
    expect(canAccessAdminSurface([], "users")).toBe(false);
    expect(Object.values(creditAccessPlan([])).some(Boolean)).toBe(false);
    expect(adminNavigationAccess(usersOnly)).toEqual({ users: true, credit: false });
    expect(adminNavigationAccess([])).toEqual({ users: false, credit: false });
  });

  it("shows Credit navigation for any one Credit read surface", () => {
    for (const permission of ["credit.summary.read", "credit.account.read", "credit.grant.read",
      "credit.hold.read", "credit.journal.read", "credit.rated-usage.read"]) {
      expect(adminNavigationAccess([permission])).toEqual({ users: false, credit: true });
    }
  });

  it("preserves the Platform exact, prefix-wildcard and global-wildcard semantics", () => {
    expect(canAccessAdminSurface(["credit.*"], "creditRatedUsageSourceAllocations")).toBe(true);
    expect(canAccessAdminSurface(["*"], "users")).toBe(true);
    expect(canAccessAdminSurface(["credit.grant.read"], "creditGrants")).toBe(true);
    expect(canAccessAdminSurface(["credit.grant"], "creditGrants")).toBe(false);
  });
});
