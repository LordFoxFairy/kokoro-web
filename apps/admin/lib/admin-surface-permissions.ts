import type { CreditNavigation, CreditView } from "./credit-navigation";
import { permits } from "./schemas";

// Keep this one-to-one with Platform AdminCreditService/AdminQueryService operation checks.
export const ADMIN_SURFACE_PERMISSION = Object.freeze({
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
} as const);

export type AdminSurface = keyof typeof ADMIN_SURFACE_PERMISSION;
type CommerceSurface = Extract<AdminSurface, `commerce${string}`>;
export type CreditSurface = Exclude<AdminSurface, "users" | CommerceSurface>;

export interface CreditAccessPlan {
  readonly summary: boolean;
  readonly accounts: boolean;
  readonly accountDetail: boolean;
  readonly grants: boolean;
  readonly holds: boolean;
  readonly holdAllocations: boolean;
  readonly journalTransactions: boolean;
  readonly journalEntries: boolean;
  readonly ratedUsage: boolean;
  readonly ratedUsageSourceAllocations: boolean;
}

const CREDIT_VIEW_SURFACE = Object.freeze({
  accounts: "creditAccounts",
  grants: "creditGrants",
  holds: "creditHolds",
  journal: "creditJournalTransactions",
  usage: "creditRatedUsage",
} as const satisfies Record<CreditView, CreditSurface>);

const CREDIT_VIEW_ORDER = Object.freeze(["accounts", "grants", "holds", "journal", "usage"] as const);

export function canAccessAdminSurface(permissions: readonly string[], surface: AdminSurface): boolean {
  return permits(permissions, ADMIN_SURFACE_PERMISSION[surface]);
}

export function creditAccessPlan(permissions: readonly string[]): CreditAccessPlan {
  const can = (surface: CreditSurface) => canAccessAdminSurface(permissions, surface);
  return Object.freeze({
    summary: can("creditSummary"),
    accounts: can("creditAccounts"),
    accountDetail: can("creditAccountDetail"),
    grants: can("creditGrants"),
    holds: can("creditHolds"),
    holdAllocations: can("creditHoldAllocations"),
    journalTransactions: can("creditJournalTransactions"),
    journalEntries: can("creditJournalEntries"),
    ratedUsage: can("creditRatedUsage"),
    ratedUsageSourceAllocations: can("creditRatedUsageSourceAllocations"),
  });
}

export function firstCreditView(access: CreditAccessPlan): CreditView | null {
  return visibleCreditViews(access)[0] ?? null;
}

export function visibleCreditViews(access: CreditAccessPlan): readonly CreditView[] {
  return CREDIT_VIEW_ORDER.filter((view) => accessForView(access, view));
}

export function authorizedCreditNavigation(
  navigation: CreditNavigation,
  access: CreditAccessPlan,
): CreditNavigation | null {
  return accessForView(access, navigation.view) ? navigation : null;
}

export function canAccessAnyCreditSurface(permissions: readonly string[]): boolean {
  return Object.values(creditAccessPlan(permissions)).some(Boolean);
}

export function adminNavigationAccess(permissions: readonly string[]): Readonly<{ users: boolean; credit: boolean }> {
  return Object.freeze({
    users: canAccessAdminSurface(permissions, "users"),
    credit: canAccessAnyCreditSurface(permissions),
  });
}

export function accessForView(access: CreditAccessPlan, view: CreditView): boolean {
  const surface = CREDIT_VIEW_SURFACE[view];
  const key = surface === "creditAccounts" ? "accounts" : surface === "creditGrants" ? "grants" :
    surface === "creditHolds" ? "holds" : surface === "creditJournalTransactions" ? "journalTransactions" :
      "ratedUsage";
  return access[key];
}
