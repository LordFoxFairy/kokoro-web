import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { IamDevelopmentFixtureService } from "../../generated/iam/proto/kokoro/iam/v1/development_fixture_pb";
import { createDevelopmentFixtureActionHandler } from "../../modules/development-fixture/actions";
import { createIamDevelopmentFixtureClient } from "../../server/iam/development-fixture-client";

const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";

describe("development administrator fixture actions", () => {
  it("WEB-INT-DEVFIXTURE-001 bootstraps and resets exclusively through generated workload RPC", async () => {
    const received: string[] = [];
    const transport = createRouterTransport((router) => router.service(IamDevelopmentFixtureService, {
      bootstrapDevelopmentAdministrator(request) {
        received.push(`${request.email}:${request.userId}`);
        return { status: "CREATED", email: request.email };
      },
      resetDevelopmentAdministratorPassword(request) {
        received.push(`${request.email}:reset`);
        return { status: "RESET", email: request.email };
      },
    }));
    const handler = createDevelopmentFixtureActionHandler({
      mode: "development",
      loadClient: async () => createIamDevelopmentFixtureClient(transport),
    });

    await expect(handler({ operation: "bootstrap", requestId, userId, email: "admin@example.test", name: "Dev Admin", password: "fixture-password-2026" }))
      .resolves.toEqual({ status: "success", operation: "bootstrap", email: "admin@example.test", outcome: "CREATED" });
    await expect(handler({ operation: "reset", requestId, email: "admin@example.test", password: "fixture-password-2027" }))
      .resolves.toEqual({ status: "success", operation: "reset", email: "admin@example.test", outcome: "RESET" });
    expect(received).toEqual([`admin@example.test:${userId}`, "admin@example.test:reset"]);
  });

  it("WEB-SEC-DEVFIXTURE-001 disables the action in production before loading an RPC client", async () => {
    const loadClient = vi.fn();
    const handler = createDevelopmentFixtureActionHandler({ mode: "production", loadClient });

    await expect(handler({ operation: "reset", requestId, email: "admin@example.test", password: "fixture-password-2027" }))
      .resolves.toEqual({ status: "error", operation: "reset", kind: "disabled" });
    expect(loadClient).not.toHaveBeenCalled();
  });

  it("WEB-SEC-DEVFIXTURE-001 rejects malformed input without echoing passwords or provider details", async () => {
    const handler = createDevelopmentFixtureActionHandler({ mode: "test", loadClient: vi.fn() });
    const result = await handler({ operation: "reset", requestId: "bad", email: "bad", password: "short" });

    expect(result).toEqual({ status: "error", operation: "reset", kind: "invalid" });
    expect(JSON.stringify(result)).not.toMatch(/short|sql|database|hash/iu);
  });
});
