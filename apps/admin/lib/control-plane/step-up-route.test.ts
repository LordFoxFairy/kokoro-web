import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ beginAdminStepUp: vi.fn(), setStepUpTransaction: vi.fn() }));

vi.mock("@/lib/control-plane/identity-client", () => ({ beginAdminStepUp: calls.beginAdminStepUp }));
vi.mock("@/lib/control-plane/authority-session", () => ({ setStepUpTransaction: calls.setStepUpTransaction }));

beforeEach(() => {
  vi.clearAllMocks();
  calls.beginAdminStepUp.mockResolvedValue({ transactionRef: "step-up:one",
    authorizationUri: "https://identity.example/authorize", expiresAt: "2026-07-30T03:00:00.000Z" });
  calls.setStepUpTransaction.mockResolvedValue(undefined);
});

describe("typed Admin effect step-up admission", () => {
  it.each([
    "commerce.credit-program.publish",
    "commerce.entitlement-template.publish",
    "commerce.offer.publish",
    "commerce.redemption-program.publish",
    "commerce.code-batch.issue",
    "commerce.code-batch.approve",
    "commerce.code-batch.activate",
    "commerce.code-batch.abandon",
    "commerce.code-batch.suspend",
    "commerce.code-batch.revoke",
    "model.inventory.import",
    "model.inventory.activate",
    "model.option.materialize",
    "model.site-policy.change",
    "model.site-release-catalog.publish",
  ])("starts and persists an admitted %s transaction", async (operation) => {
    const { NextRequest } = await import("next/server");
    const route = await import("../../app/api/control/auth/step-up/route");
    const response = await route.GET(new NextRequest(
      `https://admin.example/api/control/auth/step-up?operation=${operation}&resource=resource-one&return=/commerce/code-batches`,
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://identity.example/authorize");
    expect(calls.beginAdminStepUp).toHaveBeenCalledWith({ operation, resourceRefs: ["resource-one"] });
    expect(calls.setStepUpTransaction).toHaveBeenCalledWith({
      transactionRef: "step-up:one",
      operation,
      resourceRefs: ["resource-one"],
      returnPath: "/commerce/code-batches",
      expiresAt: "2026-07-30T03:00:00.000Z",
    });
  });

  it.each(["commerce.generic.write", "commerce.code-batch.resume"])(
    "rejects undeclared Commerce operation %s before starting step-up", async (operation) => {
    const { NextRequest } = await import("next/server");
    const route = await import("../../app/api/control/auth/step-up/route");
    const response = await route.GET(new NextRequest(
      `https://admin.example/api/control/auth/step-up?operation=${operation}&resource=resource-one&return=/`,
    ));

    expect(response.status).toBe(400);
    expect(calls.beginAdminStepUp).not.toHaveBeenCalled();
    expect(calls.setStepUpTransaction).not.toHaveBeenCalled();
    },
  );
});
