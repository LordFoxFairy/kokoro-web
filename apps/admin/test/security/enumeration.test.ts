import { describe, expect, it } from "vitest";

import { createAuthRouteFixture } from "../support/auth-route-fixture";

describe("Magic Link request enumeration resistance", () => {
  it("WEB-SEC-ENUM-001 gives active unknown suspended and deleted identities one public result", async () => {
    const fixture = createAuthRouteFixture();
    const emails = [
      "active@example.com",
      "unknwn@example.com",
      "suspend@example.com",
      "deleted@example.com",
    ];
    const results = [];

    for (const email of emails) {
      const requested = await fixture.requestMagicLink(email);
      results.push(requested.publicResult);
      expect(requested.link).not.toContain("error=");
    }

    expect(results).toEqual(Array.from({ length: emails.length }, () => ({
      status: 302,
      location: "/auth/verify?provider=nodemailer&type=email",
      body: "",
    })));
  });

  it("WEB-SEC-ENUM-001 sends unusable callbacks to the same safe state without creating Sessions", async () => {
    const fixture = createAuthRouteFixture();
    const locations: string[] = [];

    for (const email of ["unknwn@example.com", "suspend@example.com", "deleted@example.com"]) {
      const requested = await fixture.requestMagicLink(email);
      const callback = await fixture.consumeLink(requested.link, requested.cookies);
      const location = new URL(callback.headers.get("location") ?? "http://invalid", "http://localhost:3100");
      locations.push(`${location.pathname}${location.search}`);
    }

    expect(locations).toEqual([
      "/auth/verify?error=Verification",
      "/auth/verify?error=Verification",
      "/auth/verify?error=Verification",
    ]);
    expect(fixture.sessionCount()).toBe(0);
  });
});
