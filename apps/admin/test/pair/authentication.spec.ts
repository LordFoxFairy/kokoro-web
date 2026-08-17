import { test, expect } from "./journey";
import { zh } from "../../i18n/messages";

test("IAM-SEC-ENUMPASSWORD-001 active unknown suspended and deleted password login requests are uniform", async ({ journey }) => {
  await journey.rejectCredentials("active-login", journey.state.identities.administrator.email, "incorrect-password");
  await journey.rejectCredentials("unknown-login", `unknown-${journey.state.roundId}@example.test`);
  await journey.rejectCredentials("suspended-login", journey.state.identities.suspended.email);
  await journey.rejectCredentials("deleted-login", journey.state.identities.deleted.email);
});

test("IAM-SEC-REDIRECT-001 callback and return URLs stay on the configured origin", async ({ journey }) => {
  await journey.step("reject-hostile-return", "untrusted return URL rejected", async () => {
    await journey.page.goto("/login?callbackUrl=https%3A%2F%2Fattacker.example%2Fcollect");
    expect(new URL(journey.page.url()).origin).toBe(journey.state.adminBaseUrl);
    await expect(journey.page.getByRole("heading", { name: zh["auth.login.title"] })).toBeVisible();
  });
});

test("IAM-E2E-AUTHPASSWORD-001 logs in a bootstrapped administrator and restores the Session", async ({ journey }) => {
  await journey.authenticate("password-login", journey.state.identities.administrator.email);
  await journey.step("reload-session", "authenticated Session survives reload", async () => {
    await journey.page.reload({ waitUntil: "networkidle" });
    await expect(journey.page.getByRole("heading", { name: zh["overview.title"] })).toBeVisible();
  });
});

test("IAM-E2E-AUTHEMAIL-001 consumes one real email link and rejects replay", async ({ journey }) => {
  const link = await journey.requestMagicLink("request-email-link", journey.state.identities.administrator.email);
  await journey.consumeMagicLink("consume-email-link", link);
  await journey.step("reload-email-session", "email-authenticated IAM Session survives reload", async () => {
    await journey.page.reload({ waitUntil: "networkidle" });
    await expect(journey.page.getByRole("heading", { name: zh["overview.title"] })).toBeVisible();
  });
  await journey.replayMagicLink("reject-email-replay", link);
});

test("IAM-E2E-AUTHSESSION-001 email authentication uses the ordinary IAM Session guard", async ({ journey }) => {
  const link = await journey.requestMagicLink("request-shared-session-link", journey.state.identities.administrator.email);
  await journey.consumeMagicLink("consume-shared-session-link", link);
  await journey.step("shared-session-authorizes", "email Session passes the same protected-route authorization", async () => {
    await journey.page.goto("/sessions");
    await expect(journey.page.getByRole("heading", { name: zh["session.title"] })).toBeVisible();
  });
});
