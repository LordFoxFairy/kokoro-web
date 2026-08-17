import { zh } from "../../i18n/messages";
import { test, expect, uniqueValue } from "./journey";
import { addSiteMember, confirmCommand, createSite, selectAntOption, tableRow } from "./ui";

test("IAM-E2E-SITE-001 complete Site lifecycle through visible Admin controls", async ({ journey }) => {
  await journey.authenticate("login", journey.state.identities.administrator.email);
  const code = uniqueValue(`site-${journey.state.roundId}`).toLowerCase();
  const originalName = `Pair Site ${code}`;
  const updatedName = `${originalName} Updated`;
  let siteId = "";

  await journey.step("create-site", "Site and initial owner are created", async () => {
    siteId = await createSite(journey.page, { code, name: originalName, reason: "Pair acceptance Site creation" });
    await expect(journey.page.getByText(code, { exact: true })).toBeVisible();
  });
  await journey.step("update-site", "Site name is updated", async () => {
    await journey.page.getByRole("button", { name: zh["site.update"] }).click();
    const dialog = journey.page.getByRole("dialog");
    await dialog.getByLabel(zh["site.name"]).fill(updatedName);
    await dialog.getByLabel(zh["command.reason"]).fill("Pair acceptance Site update");
    await dialog.getByRole("button", { name: zh["site.confirmUpdate"] }).click();
    await expect(dialog).toBeHidden();
    await expect(journey.page.getByRole("heading", { name: updatedName })).toBeVisible();
  });
  await journey.step("select-site", "Site becomes the active Session Site", async () => {
    await journey.page.getByRole("button", { name: zh["site.select"] }).click();
    await confirmCommand(journey.page, "Pair acceptance active Site selection");
  });
  await journey.step("suspend-site", "Site is suspended", async () => {
    await journey.page.getByRole("button", { name: zh["site.suspend"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Site suspension");
    await expect(journey.page.getByText(zh["status.suspended"], { exact: true }).first()).toBeVisible();
  });
  await journey.step("reactivate-site", "Site returns to active", async () => {
    await journey.page.getByRole("button", { name: zh["site.reactivate"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Site reactivation");
    await expect(journey.page.getByText(zh["status.active"], { exact: true }).first()).toBeVisible();
  });
  await journey.step("delete-site", "Site is soft deleted and remains discoverable", async () => {
    await journey.page.getByRole("button", { name: zh["site.delete"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Site deletion");
    await journey.page.goto(`/sites?query=${encodeURIComponent(code)}&status=deleted&includeDeleted=true`);
    await expect(tableRow(journey.page, code).getByText(zh["status.deleted"], { exact: true })).toBeVisible();
  });
  await journey.step("restore-site", "Site is restored in place", async () => {
    await tableRow(journey.page, code).getByRole("button", { name: zh["site.restore"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Site restore");
    await journey.page.goto(`/sites/${siteId}`);
    await expect(journey.page.getByText(zh["status.active"], { exact: true }).first()).toBeVisible();
    await expect(journey.page.getByRole("heading", { name: updatedName })).toBeVisible();
  });
});

test("IAM-E2E-SITEMEMBER-001 complete Site Member lifecycle and protect the last owner", async ({ journey }) => {
  const administrator = journey.state.identities.administrator;
  const target = journey.state.identities.memberTarget;
  await journey.authenticate("login", administrator.email);
  const code = uniqueValue(`site-member-${journey.state.roundId}`).toLowerCase();
  await journey.step("create-site-member-target", "Site membership target is ready", async () => {
    await createSite(journey.page, { code, name: `Site Members ${code}`, reason: "Pair acceptance Site Member target" });
  });
  await journey.step("add-site-member", "active Site member is added", async () => {
    await addSiteMember(journey.page, { userLabel: target.email, roleLabel: "Member", reason: "Pair acceptance add Site Member" });
    await expect(tableRow(journey.page, target.email).getByText("member", { exact: true })).toBeVisible();
  });
  await journey.step("change-site-member-role", "Site member role changes to administrator", async () => {
    const row = tableRow(journey.page, target.email);
    await selectAntOption(journey.page, row.getByLabel(zh["siteMember.currentRole"]), "Admin");
    await row.getByRole("button", { name: zh["siteMember.changeRole"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Site Member role change");
    await expect(tableRow(journey.page, target.email).getByText("admin", { exact: true })).toBeVisible();
  });
  await journey.step("suspend-site-member", "Site member is suspended", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["siteMember.suspend"] }).click();
    await confirmCommand(journey.page, "Pair acceptance suspend Site Member");
    await expect(tableRow(journey.page, target.email).getByText(zh["status.suspended"], { exact: true })).toBeVisible();
  });
  await journey.step("reactivate-site-member", "Site member is reactivated", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["siteMember.reactivate"] }).click();
    await confirmCommand(journey.page, "Pair acceptance reactivate Site Member");
  });
  await journey.step("remove-site-member", "Site member is soft removed", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["siteMember.remove"] }).click();
    await confirmCommand(journey.page, "Pair acceptance remove Site Member");
    const siteId = new URL(journey.page.url()).pathname.split("/").filter(Boolean).at(-1);
    await journey.page.goto(`/sites/${siteId ?? ""}?tab=members&includeDeletedMembers=true`);
    await expect(tableRow(journey.page, target.email).getByText(zh["status.deleted"], { exact: true })).toBeVisible();
  });
  await journey.step("restore-site-member", "Site member is restored", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["siteMember.restore"] }).click();
    await confirmCommand(journey.page, "Pair acceptance restore Site Member");
  });
  await journey.step("protect-site-last-owner", "last Site owner removal is rejected", async () => {
    await tableRow(journey.page, administrator.email).getByRole("button", { name: zh["siteMember.remove"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Site last owner guard", { expectError: zh["error.lastOwner"] });
  });
});

test("IAM-E2E-SITERBAC-001 allow deny revoke and cross-Site denial", async ({ journey }) => {
  const target = journey.state.identities.rbacTarget;
  await journey.authenticate("login", journey.state.identities.administrator.email);
  const firstCode = uniqueValue(`site-rbac-a-${journey.state.roundId}`).toLowerCase();
  const secondCode = uniqueValue(`site-rbac-b-${journey.state.roundId}`).toLowerCase();
  let firstSiteId = "";
  let secondSiteId = "";
  await journey.step("create-rbac-sites", "two isolated Sites are ready", async () => {
    firstSiteId = await createSite(journey.page, { code: firstCode, name: `Site RBAC A ${firstCode}`, reason: "Pair acceptance Site RBAC A" });
    secondSiteId = await createSite(journey.page, { code: secondCode, name: `Site RBAC B ${secondCode}`, reason: "Pair acceptance Site RBAC B" });
  });
  await journey.step("grant-site-membership", "membership grants Site read", async () => {
    await journey.page.goto(`/sites/${firstSiteId}`);
    await addSiteMember(journey.page, { userLabel: target.email, roleLabel: "Member", reason: "Pair acceptance Site grant" });
  });
  await journey.step("allow-in-site", "member is allowed in its Site", async () => {
    await journey.page.goto(`/sites/${firstSiteId}?tab=access&permissionKey=site%3Aread&authorizationUserId=${target.id}`);
    await expect(journey.page.getByText(zh["siteAccess.allowed"], { exact: true })).toBeVisible();
  });
  await journey.step("deny-cross-site", "member is denied in another Site", async () => {
    await journey.page.goto(`/sites/${secondSiteId}?tab=access&permissionKey=site%3Aread&authorizationUserId=${target.id}`);
    await expect(journey.page.getByText(zh["siteAccess.denied"], { exact: true })).toBeVisible();
  });
  await journey.step("revoke-site-membership", "membership is revoked", async () => {
    await journey.page.goto(`/sites/${firstSiteId}?tab=members`);
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["siteMember.remove"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Site revoke");
  });
  await journey.step("deny-after-site-revoke", "former member is denied after revocation", async () => {
    await journey.page.goto(`/sites/${firstSiteId}?tab=access&permissionKey=site%3Aread&authorizationUserId=${target.id}`);
    await expect(journey.page.getByText(zh["siteAccess.denied"], { exact: true })).toBeVisible();
  });
});

test("IAM-E2E-SITEAUDIT-001 inspect Site and global audit filters and detail Drawers", async ({ journey }) => {
  await journey.authenticate("login", journey.state.identities.administrator.email);
  const code = uniqueValue(`site-audit-${journey.state.roundId}`).toLowerCase();
  let siteId = "";
  await journey.step("create-site-audit-target", "Site audit event is durable", async () => {
    siteId = await createSite(journey.page, { code, name: `Site Audit ${code}`, reason: "Pair acceptance Site audit" });
  });
  await journey.step("inspect-scoped-site-audit", "Site audit filter statistics and Drawer stay Site-scoped", async () => {
    await journey.page.goto(`/sites/${siteId}?tab=audit&auditKind=site.created`);
    await expect(journey.page.getByText("site.created", { exact: true }).first()).toBeVisible();
    await journey.page.getByRole("button", { name: zh["siteAudit.viewDetails"] }).first().click();
    await expect(journey.page.getByRole("dialog", { name: zh["siteAudit.eventDetails"] }).getByText(siteId)).toBeVisible();
  });
  await journey.step("inspect-global-site-audit", "global audit Site and kind filters open correlated detail Drawer", async () => {
    await journey.page.goto(`/audit?siteId=${siteId}&kind=site.created`);
    await expect(journey.page.getByRole("textbox", { name: zh["audit.siteId"] })).toHaveValue(siteId);
    await expect(journey.page.getByText("site.created", { exact: true }).first()).toBeVisible();
    await journey.page.getByRole("button", { name: zh["audit.viewDetail"] }).first().click();
    await expect(journey.page.getByRole("dialog", { name: zh["audit.detailTitle"] }).getByText(siteId)).toBeVisible();
  });
});
