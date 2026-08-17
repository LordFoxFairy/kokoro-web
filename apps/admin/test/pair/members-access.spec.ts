import { zh } from "../../i18n/messages";
import { test, expect, uniqueValue } from "./journey";
import { addMember, confirmCommand, createOrganization, evaluateAccess, selectAntOption, tableRow } from "./ui";

test("IAM-E2E-MEMBER-001 complete Member lifecycle and protect the last owner", async ({ journey }) => {
  const administrator = journey.state.identities.administrator;
  const target = journey.state.identities.memberTarget;
  await journey.authenticate("login", administrator.email);
  const slug = uniqueValue(`member-${journey.state.roundId}`).toLowerCase();
  let organizationId = "";
  await journey.step("create-member-organization", "membership Organization is ready", async () => {
    organizationId = await createOrganization(journey.page, {
      slug,
      name: `Member Lifecycle ${slug}`,
      reason: "Pair acceptance Member Organization",
    });
  });
  await journey.step("add-member", "active member is added", async () => {
    await addMember(journey.page, {
      userId: target.id,
      userLabel: target.email,
      roleKey: "member",
      reason: "Pair acceptance add Member",
    });
    const row = tableRow(journey.page, target.email);
    await expect(row.getByText("member", { exact: true })).toBeVisible();
    await expect(row.getByText(zh["status.active"], { exact: true })).toBeVisible();
  });
  await journey.step("change-member-role", "member role changes to administrator", async () => {
    const row = tableRow(journey.page, target.email);
    await selectAntOption(journey.page, row.getByLabel(zh["member.currentRole"]), "Admin");
    await row.getByRole("button", { name: zh["member.changeRole"] }).click();
    await confirmCommand(journey.page, "Pair acceptance change Member role");
    await expect(tableRow(journey.page, target.email).getByText("admin", { exact: true })).toBeVisible();
  });
  await journey.step("suspend-member", "member is suspended", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["member.suspend"] }).click();
    await confirmCommand(journey.page, "Pair acceptance suspend Member");
    await expect(tableRow(journey.page, target.email).getByText(zh["status.suspended"], { exact: true })).toBeVisible();
  });
  await journey.step("reactivate-member", "member is reactivated", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["member.reactivate"] }).click();
    await confirmCommand(journey.page, "Pair acceptance reactivate Member");
    await expect(tableRow(journey.page, target.email).getByText(zh["status.active"], { exact: true })).toBeVisible();
  });
  await journey.step("remove-member", "member is soft removed", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["member.remove"] }).click();
    await confirmCommand(journey.page, "Pair acceptance remove Member");
    await journey.page.goto(`/organizations/${organizationId}?includeDeletedMembers=true`);
    await expect(tableRow(journey.page, target.email).getByText(zh["status.deleted"], { exact: true })).toBeVisible();
  });
  await journey.step("restore-member", "member is restored", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["member.restore"] }).click();
    await confirmCommand(journey.page, "Pair acceptance restore Member");
    await expect(tableRow(journey.page, target.email).getByText(zh["status.active"], { exact: true })).toBeVisible();
  });
  await journey.step("protect-last-owner", "last owner removal is rejected", async () => {
    await tableRow(journey.page, administrator.email).getByRole("button", { name: zh["member.remove"] }).click();
    await confirmCommand(journey.page, "Pair acceptance last owner guard", { expectError: zh["error.lastOwner"] });
  });
});

test("IAM-E2E-RBAC-001 grant allow revoke deny and cross-Organization denial", async ({ journey }) => {
  const target = journey.state.identities.rbacTarget;
  await journey.authenticate("login", journey.state.identities.administrator.email);
  const firstSlug = uniqueValue(`rbac-a-${journey.state.roundId}`).toLowerCase();
  const secondSlug = uniqueValue(`rbac-b-${journey.state.roundId}`).toLowerCase();
  let firstOrganizationId = "";
  await journey.step("create-rbac-organizations", "two isolated Organizations are ready", async () => {
    firstOrganizationId = await createOrganization(journey.page, {
      slug: firstSlug,
      name: `RBAC A ${firstSlug}`,
      reason: "Pair acceptance RBAC Organization A",
    });
    await createOrganization(journey.page, {
      slug: secondSlug,
      name: `RBAC B ${secondSlug}`,
      reason: "Pair acceptance RBAC Organization B",
    });
  });
  await journey.step("grant-membership", "membership grants organization read", async () => {
    await journey.page.goto(`/organizations/${firstOrganizationId}`);
    await addMember(journey.page, {
      userId: target.id,
      userLabel: target.email,
      roleKey: "member",
      reason: "Pair acceptance RBAC grant",
    });
    await expect(tableRow(journey.page, target.email)).toBeVisible();
  });
  await journey.step("allow-in-organization", "selected User is allowed in its Organization", async () => {
    await evaluateAccess(journey.page, {
      organizationLabel: firstSlug,
      userLabel: target.email,
      permissionKey: "organization:read",
      expected: "allowed",
    });
  });
  await journey.step("deny-cross-organization", "selected User is denied in another Organization", async () => {
    await evaluateAccess(journey.page, {
      organizationLabel: secondSlug,
      userLabel: target.email,
      permissionKey: "organization:read",
      expected: "denied",
    });
  });
  await journey.step("revoke-membership", "membership is revoked", async () => {
    await journey.page.goto(`/organizations/${firstOrganizationId}`);
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["member.remove"] }).click();
    await confirmCommand(journey.page, "Pair acceptance RBAC revoke");
  });
  await journey.step("deny-after-revoke", "selected User is denied after revocation", async () => {
    await evaluateAccess(journey.page, {
      organizationLabel: firstSlug,
      userLabel: target.email,
      permissionKey: "organization:read",
      expected: "denied",
    });
  });
});
