import { expect, type Locator, type Page } from "@playwright/test";

import { zh } from "../../i18n/messages";

const roleLabels = { owner: "Owner", admin: "Admin", member: "Member" } as const;

export async function selectAntOption(page: Page, control: Locator, optionText: string): Promise<void> {
  await control.click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: optionText })
    .first()
    .click();
}

export async function confirmCommand(
  page: Page,
  reason: string,
  options: Readonly<{ expectError?: string; doubleSubmit?: boolean }> = {},
): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(zh["command.reason"]).fill(reason);
  const confirm = dialog.getByRole("button", { name: zh["command.confirm"], exact: true });
  if (options.doubleSubmit === true) {
    await confirm.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error("confirm control is not a button");
      button.click();
      button.click();
    });
  } else {
    await confirm.click();
  }
  if (options.expectError !== undefined) {
    await expect(dialog.getByText(options.expectError)).toBeVisible();
  } else {
    await expect(dialog).toBeHidden();
  }
}

export async function createOrganization(
  page: Page,
  input: Readonly<{ slug: string; name: string; reason: string }>,
): Promise<string> {
  await page.goto("/organizations");
  await page.getByRole("button", { name: zh["organization.create"] }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(zh["organization.slug"]).fill(input.slug);
  await dialog.getByLabel(zh["organization.name"]).fill(input.name);
  await dialog.getByLabel(zh["command.reason"]).fill(input.reason);
  await dialog.getByRole("button", { name: zh["organization.confirmCreate"] }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: input.name }).click();
  await expect(page.getByRole("heading", { name: zh["organization.detail"] })).toBeVisible();
  const segments = new URL(page.url()).pathname.split("/").filter(Boolean);
  const id = segments.at(-1);
  if (id === undefined) throw new Error("created Organization route has no identity");
  return id;
}

export async function createSite(
  page: Page,
  input: Readonly<{ code: string; name: string; reason: string }>,
): Promise<string> {
  await page.goto("/sites");
  await page.getByRole("button", { name: zh["site.create"] }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(zh["site.code"]).fill(input.code);
  await dialog.getByLabel(zh["site.name"]).fill(input.name);
  await dialog.getByLabel(zh["command.reason"]).fill(input.reason);
  await dialog.getByRole("button", { name: zh["site.confirmCreate"] }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: input.name }).click();
  await expect(page.getByRole("heading", { name: input.name })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
  if (id === undefined) throw new Error("created Site route has no identity");
  return id;
}

export async function addSiteMember(
  page: Page,
  input: Readonly<{ userLabel: string; roleLabel: "Owner" | "Admin" | "Member"; reason: string }>,
): Promise<void> {
  await page.getByRole("tab", { name: zh["site.tab.members"] }).click();
  await page.getByRole("button", { name: zh["siteMember.add"] }).click();
  const dialog = page.getByRole("dialog");
  await selectAntOption(page, dialog.getByLabel(zh["siteMember.user"]), input.userLabel);
  await selectAntOption(page, dialog.getByLabel(zh["siteMember.role"]), input.roleLabel);
  await dialog.getByLabel(zh["command.reason"]).fill(input.reason);
  await dialog.getByRole("button", { name: zh["siteMember.confirmAdd"] }).click();
  await expect(dialog).toBeHidden();
}

export function tableRow(page: Page, text: string) {
  return page.getByRole("row").filter({ hasText: text }).first();
}

export async function addMember(
  page: Page,
  input: Readonly<{
    userId: string;
    userLabel: string;
    roleKey: "member" | "admin" | "owner";
    reason: string;
  }>,
): Promise<void> {
  await page.getByRole("button", { name: zh["member.add"] }).click();
  const dialog = page.getByRole("dialog");
  await selectAntOption(page, dialog.getByLabel(zh["member.user"]), input.userLabel);
  await selectAntOption(page, dialog.getByLabel(zh["member.role"]), roleLabels[input.roleKey]);
  await dialog.getByLabel(zh["command.reason"]).fill(input.reason);
  await dialog.getByRole("button", { name: zh["member.confirmAdd"] }).click();
  await expect(dialog).toBeHidden();
}

export async function evaluateAccess(
  page: Page,
  input: Readonly<{
    organizationLabel: string;
    userLabel: string;
    permissionKey: string;
    expected: "allowed" | "denied";
  }>,
): Promise<void> {
  await page.goto("/access");
  await selectAntOption(page, page.getByLabel(zh["access.organization"], { exact: true }), input.organizationLabel);
  await selectAntOption(page, page.getByLabel(zh["access.user"], { exact: true }), input.userLabel);
  await selectAntOption(page, page.getByLabel(zh["access.permission"], { exact: true }), input.permissionKey);
  await page.getByRole("button", { name: zh["access.evaluate"] }).click();
  await expect(page.getByRole("heading", { name: zh["access.decision"] })).toBeVisible();
  await expect(page.getByText(zh[`access.${input.expected}`], { exact: true })).toBeVisible();
}
