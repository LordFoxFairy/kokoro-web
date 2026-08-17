import { zh } from "../../i18n/messages";
import { test, expect, uniqueValue } from "./journey";
import { confirmCommand, createOrganization, tableRow } from "./ui";

test("IAM-E2E-ORG-001 complete Organization lifecycle through visible Admin controls", async ({ journey }) => {
  await journey.authenticate("login", journey.state.identities.administrator.email);
  const slug = uniqueValue(`org-${journey.state.roundId}`).toLowerCase();
  const originalName = `Pair Organization ${slug}`;
  const updatedName = `${originalName} Updated`;
  let organizationId = "";

  await journey.step("create-organization", "Organization is created and inspectable", async () => {
    organizationId = await createOrganization(journey.page, {
      slug,
      name: originalName,
      reason: "Pair acceptance Organization creation",
    });
    await expect(journey.page.getByText(slug, { exact: true })).toBeVisible();
  });
  await journey.step("update-organization", "Organization name is updated", async () => {
    await journey.page.getByRole("button", { name: zh["organization.update"] }).click();
    const dialog = journey.page.getByRole("dialog");
    await dialog.getByLabel(zh["organization.name"]).fill(updatedName);
    await dialog.getByLabel(zh["command.reason"]).fill("Pair acceptance Organization update");
    await dialog.getByRole("button", { name: zh["organization.confirmUpdate"] }).click();
    await expect(dialog).toBeHidden();
    await expect(journey.page.getByText(`${updatedName} · ${slug}`)).toBeVisible();
  });
  await journey.step("reload-organization", "updated Organization survives reload", async () => {
    await journey.page.reload({ waitUntil: "networkidle" });
    await expect(journey.page.getByText(`${updatedName} · ${slug}`)).toBeVisible();
  });
  await journey.step("delete-organization", "Organization is soft deleted", async () => {
    await journey.page.getByRole("button", { name: zh["organization.delete"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Organization deletion");
    await journey.page.goto(`/organizations?query=${encodeURIComponent(slug)}&includeDeleted=true`);
    const row = tableRow(journey.page, slug);
    await expect(row.getByText(zh["status.deleted"], { exact: true })).toBeVisible();
  });
  await journey.step("find-deleted-organization", "deleted Organization remains discoverable only when requested", async () => {
    await journey.page.goto(`/organizations?query=${encodeURIComponent(slug)}&includeDeleted=true&status=deleted`);
    await expect(tableRow(journey.page, slug)).toBeVisible();
  });
  await journey.step("restore-organization", "Organization is restored in place", async () => {
    const row = tableRow(journey.page, slug);
    await row.getByRole("button", { name: zh["organization.restore"] }).click();
    await confirmCommand(journey.page, "Pair acceptance Organization restore");
    await journey.page.goto(`/organizations/${organizationId}`);
    await expect(journey.page.getByText(zh["status.active"], { exact: true }).first()).toBeVisible();
    await expect(journey.page.getByText(updatedName, { exact: true }).first()).toBeVisible();
  });
});
