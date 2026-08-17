import { createRouterTransport } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { IamCredentialService } from "../../generated/iam/proto/kokoro/iam/v1/credential_pb";
import { createIamCredentialClient } from "../../server/iam/credential-client";

describe("IAM administrator credential client", () => {
  it("WEB-UNIT-CREDENTIAL-001 validates and maps a real Session login response", async () => {
    const userId = randomUUID();
    const client = createIamCredentialClient(createRouterTransport(({ service }) => {
      service(IamCredentialService, {
        loginAdministrator: () => ({
          user: {
            $typeName: "kokoro.iam.v1.UserRecord",
            id: userId,
            email: "admin@example.com",
            name: "Admin",
            platformRole: "admin",
            status: "active",
            version: BigInt(1),
            createdAt: timestampFromDate(new Date("2026-08-17T00:00:00.000Z")),
            updatedAt: timestampFromDate(new Date("2026-08-17T00:00:00.000Z")),
          },
          session: {
            $typeName: "kokoro.iam.v1.SessionRecord",
            id: randomUUID(),
            sessionToken: "credential-session-token-with-more-than-thirty-two-bytes",
            userId,
            expires: timestampFromDate(new Date("2026-08-17T08:00:00.000Z")),
            createdAt: timestampFromDate(new Date("2026-08-17T00:00:00.000Z")),
            updatedAt: timestampFromDate(new Date("2026-08-17T00:00:00.000Z")),
          },
        }),
      });
    }));

    await expect(client.login("admin@example.com", "Correct-Horse-2026")).resolves.toEqual({
      user: { id: userId, email: "admin@example.com", name: "Admin" },
      session: {
        token: "credential-session-token-with-more-than-thirty-two-bytes",
        expires: new Date("2026-08-17T08:00:00.000Z"),
      },
    });
  });
});
