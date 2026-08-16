import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ErrorDetailSchema } from "../../generated/iam/proto/kokoro/common/v1/error_pb";
import { toIamWebError } from "../../server/iam/error";

describe("safe IAM error translation", () => {
  it("WEB-UNIT-ERROR-001 maps an allowlisted ErrorDetail and discards the upstream message", () => {
    const marker = "DATABASE_URL_SECRET_MARKER";
    const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
    const detail = create(ErrorDetailSchema, { reason: "last_owner", requestId, field: "member_id" });
    const upstream = new ConnectError(`raw upstream ${marker}`, Code.FailedPrecondition, undefined, [{
      desc: ErrorDetailSchema,
      value: detail,
    }]);

    const result = toIamWebError(upstream);

    expect(result).toEqual({ kind: "last_owner", requestId, field: "member_id" });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("WEB-UNIT-ERROR-001 removes unknown reasons fields and malformed request IDs", () => {
    const detail = create(ErrorDetailSchema, {
      reason: "postgresql_secret_failure",
      requestId: "not-a-uuid",
      field: "session_token",
    });
    const upstream = new ConnectError("sensitive", Code.PermissionDenied, undefined, [{
      desc: ErrorDetailSchema,
      value: detail,
    }]);

    expect(toIamWebError(upstream)).toEqual({ kind: "forbidden", requestId: "" });
  });

  it("WEB-UNIT-ERROR-001 maps transport failures without reflecting arbitrary values", () => {
    expect(toIamWebError(new ConnectError("host secret", Code.Unavailable)))
      .toEqual({ kind: "unavailable", requestId: "" });
    expect(toIamWebError(new Error("plain secret")))
      .toEqual({ kind: "internal", requestId: "" });
  });
});
