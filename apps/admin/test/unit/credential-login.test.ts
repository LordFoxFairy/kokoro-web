import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ErrorDetailSchema } from "../../generated/iam/proto/kokoro/common/v1/error_pb";
import { authenticateAdministrator } from "../../server/auth/credential-login";

describe("administrator credential login orchestration", () => {
  it("WEB-UNIT-CREDENTIAL-002 validates input and returns only stable public states", async () => {
    const client = { login: async () => {
      const detail = create(ErrorDetailSchema, { reason: "invalid_credentials" });
      throw new ConnectError("upstream secret", Code.Unauthenticated, undefined, [{ desc: ErrorDetailSchema, value: detail }]);
    } };

    await expect(authenticateAdministrator({ email: "bad", password: "short" }, client))
      .resolves.toEqual({ status: "invalid" });
    await expect(authenticateAdministrator({
      email: "admin@example.com", password: "Wrong-Horse-2026",
    }, client)).resolves.toEqual({ status: "invalid_credentials" });
  });
});
