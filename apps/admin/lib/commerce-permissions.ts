import { permits } from "./schemas";

export interface CommerceAccessPlan {
  readonly creditPrograms: Readonly<{ read: boolean; publish: boolean }>;
  readonly entitlementTemplates: Readonly<{ read: boolean; publish: boolean }>;
  readonly offers: Readonly<{ read: boolean; publish: boolean }>;
  readonly redemptionPrograms: Readonly<{ read: boolean; publish: boolean }>;
  readonly codeBatches: Readonly<{
    read: boolean;
    issue: boolean;
    approve: boolean;
    activate: boolean;
    abandon: boolean;
    suspend: boolean;
    revoke: boolean;
  }>;
}

export interface CodeBatchActionSubject {
  readonly state: "draft" | "active" | "suspended" | "abandoned" | "revoked";
  readonly approvalState: "pending" | "approved";
  readonly createdByOperatorRef: string;
}

export function commerceAccessPlan(permissions: readonly string[]): CommerceAccessPlan {
  const can = (permission: string) => permits(permissions, permission);
  return Object.freeze({
    creditPrograms: Object.freeze({
      read: can("commerce.credit-program.read"),
      publish: can("commerce.credit-program.publish"),
    }),
    entitlementTemplates: Object.freeze({
      read: can("commerce.entitlement-template.read"),
      publish: can("commerce.entitlement-template.publish"),
    }),
    offers: Object.freeze({
      read: can("commerce.offer.read"),
      publish: can("commerce.offer.publish"),
    }),
    redemptionPrograms: Object.freeze({
      read: can("commerce.redemption-program.read"),
      publish: can("commerce.redemption-program.publish"),
    }),
    codeBatches: Object.freeze({
      read: can("commerce.code-batch.read"),
      issue: can("commerce.code-batch.issue"),
      approve: can("commerce.code-batch.approve"),
      activate: can("commerce.code-batch.activate"),
      abandon: can("commerce.code-batch.abandon"),
      suspend: can("commerce.code-batch.suspend"),
      revoke: can("commerce.code-batch.revoke"),
    }),
  });
}

export function codeBatchActionAccess(input: Readonly<{
  permissions: readonly string[];
  operatorRef: string;
  batch: CodeBatchActionSubject;
}>): Readonly<{ approve: boolean; activate: boolean; abandon: boolean; suspend: boolean; revoke: boolean }> {
  const access = commerceAccessPlan(input.permissions).codeBatches;
  const { batch } = input;
  return Object.freeze({
    approve: access.approve && batch.state === "draft" && batch.approvalState === "pending" &&
      batch.createdByOperatorRef !== input.operatorRef,
    activate: access.activate && batch.state === "draft" && batch.approvalState === "approved",
    abandon: access.abandon && batch.state === "draft",
    suspend: access.suspend && batch.state === "active",
    revoke: access.revoke && (batch.state === "active" || batch.state === "suspended"),
  });
}

export function canReadAnyCommerceResource(permissions: readonly string[]): boolean {
  const access = commerceAccessPlan(permissions);
  return access.creditPrograms.read || access.entitlementTemplates.read || access.offers.read ||
    access.redemptionPrograms.read || access.codeBatches.read;
}
