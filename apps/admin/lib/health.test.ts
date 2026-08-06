import { describe, expect, it } from "vitest";

import { adminLivenessResponse, adminReadinessResponse } from "./health";

describe("Admin Web health boundary", () => {
  it("reports process liveness without consulting privileged configuration", async () => {
    const response = adminLivenessResponse();

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("reports readiness only after the complete server-only configuration loads", async () => {
    let checks = 0;
    const response = await adminReadinessResponse(async () => {
      checks += 1;
    });

    expect(checks).toBe(1);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("fails readiness with a bounded response that never leaks configuration errors", async () => {
    const response = await adminReadinessResponse(async () => {
      throw new Error("secret-path=/run/secrets/private.key token=do-not-leak");
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("secret-path");
    expect(JSON.stringify(body)).not.toContain("do-not-leak");
  });
});
