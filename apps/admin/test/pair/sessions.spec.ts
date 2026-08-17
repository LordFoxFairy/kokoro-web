import { test, expect } from "./journey";
import { confirmCommand } from "./ui";
import { zh } from "../../i18n/messages";

test("IAM-E2E-SESSION-001 reload logout and administrator Session revocation", async ({ journey }) => {
  const administrator = journey.state.identities.administrator;
  await journey.authenticate("initial-login", administrator.email);
  await journey.step("reload-active-session", "active Session restores the protected shell", async () => {
    await journey.page.reload({ waitUntil: "networkidle" });
    await expect(journey.page.getByText(administrator.email, { exact: true }).first()).toBeVisible();
  });
  await journey.step("logout", "logout returns to sign in", async () => {
    await journey.page.getByRole("button", { name: zh["shell.signOut"] }).click();
    await expect(journey.page.getByRole("heading", { name: zh["auth.login.title"] })).toBeVisible();
  });

  await journey.authenticate("revocation-login", administrator.email);
  await journey.step("revoke-administrator-sessions", "administrator revocation invalidates the browser Session", async () => {
    await journey.page.goto(`/sessions?userId=${administrator.id}`);
    await journey.page.getByRole("button", { name: zh["session.revokeAll"] }).click();
    await confirmCommand(journey.page, "Pair acceptance administrator revocation");
    await journey.page.goto("/");
    await expect(journey.page.getByRole("heading", { name: zh["auth.login.title"] })).toBeVisible();
  });
});
