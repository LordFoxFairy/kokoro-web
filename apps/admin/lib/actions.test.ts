import { describe, expect, it } from "vitest";

import { ACTION_SPECS } from "./actions";

describe("redeem-only Admin actions", () => {
  it("does not register plan grants or refunds", () => {
    expect(ACTION_SPECS).not.toHaveProperty("grantPlan");
    expect(ACTION_SPECS).not.toHaveProperty("refund");
  });

  it("allows only manual adjustment when granting credits", () => {
    const reason = ACTION_SPECS.grant.fields.find((field) => field.name === "reason");
    expect(reason?.options).toEqual(["manual_adjustment"]);
  });
});
