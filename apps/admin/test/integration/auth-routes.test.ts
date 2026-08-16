import { describe, expect, it } from "vitest";

import { createAuthRouteFixture } from "../support/auth-route-fixture";

describe("real Auth.js route handlers with IAM Adapter", () => {
  it("WEB-INT-AUTH-001 requests consumes and exposes a safe database Session", async () => {
    const fixture = createAuthRouteFixture();
    const requested = await fixture.requestMagicLink("active@example.com");

    expect(requested.frameworkResult.status).toBe(302);
    expect(requested.frameworkResult.location).toBe(
      "http://localhost:3100/api/auth/verify-request?provider=nodemailer&type=email",
    );
    expect(requested.publicResult.status).toBe(302);
    expect(requested.publicResult.location).toBe("/auth/verify?provider=nodemailer&type=email");
    expect(requested.publicResult.body).toBe("");

    const callback = await fixture.consumeLink(requested.link, requested.cookies);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("http://localhost:3100/");
    expect(requested.cookies.has("kokoro.admin.session-token")).toBe(true);
    expect(fixture.sessionCount()).toBe(1);

    const session = await fixture.getPublicSession(requested.cookies);
    expect(session).toEqual({
      expires: expect.any(String),
      user: {
        id: "bce7762a-f7c7-4d22-8031-4336803038eb",
        email: "active@example.com",
        name: "Admin",
        image: null,
        platformRole: "admin",
        status: "active",
      },
    });
    expect(JSON.stringify(session)).not.toContain("session-token");
    expect(JSON.stringify(session)).not.toContain("header.payload.signature");
  });

  it("WEB-INT-AUTH-001 consumes a Magic Link once and routes replay to one public-safe error page", async () => {
    const fixture = createAuthRouteFixture();
    const requested = await fixture.requestMagicLink("active@example.com");
    await fixture.consumeLink(requested.link, requested.cookies);

    const replayCookies = new Map<string, string>();
    const replay = await fixture.consumeLink(requested.link, replayCookies);

    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toBe("/auth/verify?error=Verification");
    expect(fixture.sessionCount()).toBe(1);
    expect(await replay.text()).not.toContain(requested.link);
  });

  it("WEB-INT-SESSION-001 logs out through Auth.js and deletes the IAM database Session", async () => {
    const fixture = createAuthRouteFixture();
    const requested = await fixture.requestMagicLink("active@example.com");
    await fixture.consumeLink(requested.link, requested.cookies);
    expect(fixture.sessionCount()).toBe(1);

    const response = await fixture.signOut(requested.cookies);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3100/");
    expect(fixture.sessionCount()).toBe(0);
    expect(requested.cookies.has("kokoro.admin.session-token")).toBe(false);
    expect(await fixture.getPublicSession(requested.cookies)).toBeNull();
  });
});
