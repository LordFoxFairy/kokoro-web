import { zh } from "../../i18n/messages";
import { test, expect, uniqueValue } from "./journey";
import { confirmCommand, createOrganization, tableRow } from "./ui";

test("IAM-E2E-DELETE-001 User and Organization deletion restoration and audit continuity", async ({ journey }) => {
  const target = journey.state.identities.deleteTarget;
  await journey.authenticate("login", journey.state.identities.administrator.email);
  await journey.step("find-target-user", "target User is searchable and inspectable", async () => {
    await journey.page.goto(`/users?query=${encodeURIComponent(target.email)}`);
    await journey.page.getByRole("link", { name: target.email }).click();
    await expect(journey.page.getByRole("heading", { name: zh["user.detail"] })).toBeVisible();
  });
  await journey.step("revoke-target-sessions", "target User Sessions are revoked", async () => {
    await journey.page.getByRole("button", { name: zh["session.revokeAll"] }).click();
    await confirmCommand(journey.page, "Pair acceptance target Session revocation");
    await expect(journey.page.getByText(zh["status.revoked"], { exact: true }).first()).toBeVisible();
  });
  await journey.step("suspend-user", "target User is suspended", async () => {
    await journey.page.getByRole("button", { name: zh["user.suspend"], exact: true }).click();
    await confirmCommand(journey.page, "Pair acceptance User suspension");
    await expect(journey.page.getByText(zh["status.suspended"], { exact: true }).first()).toBeVisible();
  });
  await journey.step("reactivate-user", "target User is reactivated", async () => {
    await journey.page.getByRole("button", { name: zh["user.reactivate"], exact: true }).click();
    await confirmCommand(journey.page, "Pair acceptance User reactivation");
    await expect(journey.page.getByText(zh["status.active"], { exact: true }).first()).toBeVisible();
  });
  await journey.step("delete-user", "target User is soft deleted", async () => {
    await journey.page.getByRole("button", { name: zh["user.delete"], exact: true }).click();
    await confirmCommand(journey.page, "Pair acceptance User deletion");
    await journey.page.goto(`/users?query=${encodeURIComponent(target.email)}&includeDeleted=true&status=deleted`);
    await expect(tableRow(journey.page, target.email).getByText(zh["status.deleted"], { exact: true })).toBeVisible();
  });
  await journey.step("restore-user", "target User is restored in place", async () => {
    await tableRow(journey.page, target.email).getByRole("button", { name: zh["user.restore"] }).click();
    await confirmCommand(journey.page, "Pair acceptance User restore");
    await journey.page.goto(`/users/${target.id}`);
    await expect(journey.page.getByText(zh["status.active"], { exact: true }).first()).toBeVisible();
  });

  const slug = uniqueValue(`delete-org-${journey.state.roundId}`).toLowerCase();
  let organizationId = "";
  await journey.step("create-delete-organization", "Organization is created for deletion continuity", async () => {
    organizationId = await createOrganization(journey.page, {
      slug,
      name: `Delete Restore ${slug}`,
      reason: "Pair acceptance delete/restore Organization creation",
    });
  });
  await journey.step("delete-and-restore-organization", "Organization delete and restore preserve its identity", async () => {
    await journey.page.getByRole("button", { name: zh["organization.delete"] }).click();
    await confirmCommand(journey.page, "Pair acceptance continuity delete");
    await journey.page.goto(`/organizations?query=${encodeURIComponent(slug)}&includeDeleted=true&status=deleted`);
    await tableRow(journey.page, slug).getByRole("button", { name: zh["organization.restore"] }).click();
    await confirmCommand(journey.page, "Pair acceptance continuity restore");
    await journey.page.goto(`/organizations/${organizationId}`);
    await expect(journey.page.getByText(zh["status.active"], { exact: true }).first()).toBeVisible();
  });
  await journey.step("audit-user-continuity", "User lifecycle events remain correlated after restore", async () => {
    await journey.page.goto(`/audit?targetUserId=${target.id}`);
    await expect(journey.page.getByRole("heading", { name: zh["audit.title"] })).toBeVisible();
    await expect(journey.page.getByText("user.deleted", { exact: true })).toBeVisible();
    await expect(journey.page.getByText("user.restored", { exact: true })).toBeVisible();
  });
  await journey.step("audit-organization-continuity", "Organization lifecycle events remain correlated after restore", async () => {
    await journey.page.goto(`/audit?organizationId=${organizationId}`);
    await expect(journey.page.getByText("organization.deleted", { exact: true })).toBeVisible();
    await expect(journey.page.getByText("organization.restored", { exact: true })).toBeVisible();
  });
});
