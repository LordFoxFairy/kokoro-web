import { describe, expect, it } from "vitest";

import { readSessionToken, sessionCookie } from "../../server/auth/cookie";

describe("explicit Auth.js database Session cookie", () => {
  it("WEB-UNIT-COOKIE-001 uses the exact production Secure cookie contract", () => {
    expect(sessionCookie({ secureCookies: true })).toEqual({
      name: "__Secure-kokoro.admin.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    });
  });

  it("WEB-UNIT-COOKIE-001 uses the exact loopback HTTP fixture cookie contract", () => {
    expect(sessionCookie({ secureCookies: false })).toEqual({
      name: "kokoro.admin.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    });
  });

  it("WEB-UNIT-COOKIE-001 reads only a bounded opaque token from the configured cookie", () => {
    const token = "s".repeat(64);
    const reader = {
      get(name: string): { value: string } | undefined {
        return name === "kokoro.admin.session-token" ? { value: token } : undefined;
      },
    };

    expect(readSessionToken(reader, { secureCookies: false })).toBe(token);
    expect(readSessionToken({ get: () => ({ value: "short" }) }, { secureCookies: false })).toBeNull();
    expect(readSessionToken({ get: () => ({ value: `valid${"x".repeat(28)}\n` }) }, { secureCookies: false }))
      .toBeNull();
    expect(readSessionToken({ get: () => undefined }, { secureCookies: false })).toBeNull();
  });
});
