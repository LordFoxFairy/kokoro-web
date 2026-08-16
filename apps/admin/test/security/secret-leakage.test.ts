import { describe, expect, it } from "vitest";

import { serializeAuthLog } from "../../server/logging/auth-logger";
import { serializeIamLog } from "../../server/logging/logger";

describe("Admin secret leakage boundary", () => {
  it("WEB-SEC-SECRET-001 serializes only the structured safe log allowlist", () => {
    const serialized = serializeIamLog({
      event: "iam.rpc.completed",
      requestId: "8deecb20-8d72-4b7e-a719-722a2e606728",
      result: "error",
      kind: "forbidden",
      service: "kokoro.iam.v1.IamAdministrationService",
      method: "ListUsers",
      durationMs: 12,
    });

    expect(JSON.parse(serialized)).toEqual({
      event: "iam.rpc.completed",
      requestId: "8deecb20-8d72-4b7e-a719-722a2e606728",
      result: "error",
      kind: "forbidden",
      service: "kokoro.iam.v1.IamAdministrationService",
      method: "ListUsers",
      durationMs: 12,
    });
  });

  it("WEB-SEC-SECRET-001 rejects extra raw message and secret-bearing fields without reflecting them", () => {
    const marker = "WORKLOAD_SECRET_MARKER_f89aa1";
    let message = "";
    try {
      serializeIamLog({
        event: "iam.rpc.completed",
        requestId: "8deecb20-8d72-4b7e-a719-722a2e606728",
        result: "error",
        message: marker,
        authorization: `Bearer ${marker}`,
      } as never);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("invalid IAM log record");
    expect(message).not.toContain(marker);
  });

  it("WEB-SEC-SECRET-001 allowlists Auth.js error type without serializing its message or cause", () => {
    const marker = "AUTH_CALLBACK_SECRET_MARKER";
    const error = Object.assign(new Error(`callback failed ${marker}`), {
      type: "Verification",
      cause: { token: marker },
    });

    const serialized = serializeAuthLog("error", error);

    expect(JSON.parse(serialized)).toEqual({
      event: "auth.framework",
      level: "error",
      kind: "Verification",
    });
    expect(serialized).not.toContain(marker);
  });
});
