import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const base = {
  AUTH_SECRET: "x".repeat(32), KOKORO_ADMIN_RPC_URL: "https://platform-admin.test:7443",
  KOKORO_ADMIN_TLS_KEY_FILE: "/run/secrets/client.key", KOKORO_ADMIN_TLS_CERT_FILE: "/run/secrets/client.crt",
  KOKORO_ADMIN_TLS_CA_FILE: "/run/secrets/ca.crt", KOKORO_ADMIN_TLS_SERVER_NAME: "platform-admin.test",
  KOKORO_ADMIN_DELIVERY_KEY_RING_FILE: "/run/secrets/delivery.json",
  KOKORO_ADMIN_WORKLOAD_IDENTITY_REF: "spiffe://kokoro/web/admin", KOKORO_ADMIN_AUDIENCE: "platform-admin",
  KOKORO_ADMIN_ENVIRONMENT: "production", KOKORO_ADMIN_REGION: "us-east-1",
  KOKORO_ADMIN_MANAGED_DEVICE_REF: "admin-web:prod",
};

describe("Admin Web environment", () => {
  it("accepts only the typed mTLS and workload authority boundary", () => {
    expect(parseEnv(base)).toMatchObject({ KOKORO_ADMIN_RETURN_INTENT_REF: "dashboard",
      KOKORO_ADMIN_STEP_UP_CALLBACK_REF: "step-up" });
  });
  it("rejects insecure control-plane URLs and missing authority axes", () => {
    expect(() => parseEnv({ ...base, KOKORO_ADMIN_RPC_URL: "http://platform-admin.test" })).toThrow();
    expect(() => parseEnv({ ...base, KOKORO_ADMIN_WORKLOAD_IDENTITY_REF: "admin-web" })).toThrow();
  });
});
