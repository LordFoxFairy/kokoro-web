import { describe, expect, it } from "vitest";

import { trustedAdminHeaders } from "./admin-trust-boundary";

describe("trustedAdminHeaders", () => {
  it("removes every browser-provided internal header before injecting server authority", () => {
    const incoming = new Headers({
      accept: "application/json",
      cookie: "browser=session",
      "x-kokoro-operator": "attacker@example.com",
      "x-kokoro-proxy-secret": "attacker-secret",
      "x-kokoro-internal-secret": "attacker-internal",
      "x-kokoro-site-id": "site-attacker",
      "x-kokoro-user-id": "user-attacker",
    });

    const headers = trustedAdminHeaders(incoming, " Operator@Example.com ", " server-secret ");

    expect(headers).not.toBeNull();
    expect(headers?.get("x-kokoro-operator")).toBe("Operator@Example.com");
    expect(headers?.get("x-kokoro-proxy-secret")).toBe("server-secret");
    expect(headers?.get("x-kokoro-internal-secret")).toBeNull();
    expect(headers?.get("x-kokoro-site-id")).toBeNull();
    expect(headers?.get("x-kokoro-user-id")).toBeNull();
    expect(headers?.get("cookie")).toBe("browser=session");
  });

  it.each([
    [null, "server-secret"],
    ["", "server-secret"],
    ["operator@example.com", ""],
    ["operator@example.com", null],
  ])("fails closed without both auth email and server secret", (email, secret) => {
    expect(trustedAdminHeaders(new Headers({ "x-kokoro-operator": "spoofed" }), email, secret)).toBeNull();
  });
});
