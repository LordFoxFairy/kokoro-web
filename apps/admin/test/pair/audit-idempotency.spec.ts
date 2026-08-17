import { readFile } from "node:fs/promises";

import { zh } from "../../i18n/messages";
import { test, expect, uniqueValue } from "./journey";
import { confirmCommand, createOrganization } from "./ui";

type LogRecord = Readonly<Record<string, unknown>>;

async function iamRpcRecords(pathname: string): Promise<readonly LogRecord[]> {
  return (await readFile(pathname, "utf8")).split("\n").flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return value !== null && typeof value === "object" && !Array.isArray(value) ? [value as LogRecord] : [];
    } catch {
      return [];
    }
  });
}

test("IAM-E2E-IDEM-001 double-submit one command and retain one durable result", async ({ journey }) => {
  await journey.authenticate("login", journey.state.identities.administrator.email);
  const slug = uniqueValue(`idem-${journey.state.roundId}`).toLowerCase();
  let organizationId = "";
  await journey.step("create-idempotency-target", "idempotency target Organization is active", async () => {
    organizationId = await createOrganization(journey.page, {
      slug,
      name: `Idempotency ${slug}`,
      reason: "Pair acceptance idempotency target",
    });
  });
  const before = (await iamRpcRecords(journey.state.iamLogPath)).length;
  await journey.step("double-submit-delete", "two UI submissions return one durable deletion", async () => {
    await journey.page.getByRole("button", { name: zh["organization.delete"] }).click();
    await confirmCommand(journey.page, "Pair acceptance double submission", { doubleSubmit: true });
    const records = (await iamRpcRecords(journey.state.iamLogPath)).slice(before)
      .filter((record) => record.method === "DeleteOrganization" && typeof record.commandId === "string");
    expect(records.length).toBeGreaterThanOrEqual(2);
    expect(new Set(records.map((record) => record.commandId)).size).toBe(1);
  });
  await journey.step("one-durable-event", "one deletion event and one deleted state are visible", async () => {
    await journey.page.goto(`/audit?organizationId=${organizationId}&kind=organization.deleted`);
    await expect(journey.page.getByText("organization.deleted", { exact: true })).toHaveCount(1);
  });
});

test("IAM-E2E-FRESH-001 visible desktop and mobile shell belongs to this fresh round", async ({ journey }) => {
  await journey.authenticate("login", journey.state.identities.administrator.email);
  await journey.step("desktop-shell", "fresh desktop Chromium renders the complete shell", async () => {
    await journey.page.goto("/");
    await expect(journey.page.getByRole("navigation", { name: zh["nav.primary"] })).toBeVisible();
    await expect(journey.page.getByText(journey.state.identities.administrator.email, { exact: true })).toBeVisible();
  });
  await journey.step("mobile-shell", "fresh 360px Chromium has no horizontal page overflow", async () => {
    await journey.page.goto("/");
    await expect(journey.page.getByRole("heading", { name: zh["overview.title"] })).toBeVisible();
    const overflow = await journey.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }, { viewport: { width: 360, height: 800 } });
});
