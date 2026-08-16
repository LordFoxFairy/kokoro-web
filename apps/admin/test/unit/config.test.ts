import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAdminConfig } from "../../server/config/config";

describe("strict Admin runtime configuration", () => {
  let root: string;
  let authSecretPath: string;
  let workloadTokenPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "kokoro-admin-config-"));
    authSecretPath = await secretFile("auth-secret", "A".repeat(64));
    workloadTokenPath = await secretFile("workload-token", "b".repeat(64));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function secretFile(name: string, value: string): Promise<string> {
    const path = join(root, name);
    await writeFile(path, `${value}\n`, { mode: 0o600 });
    return path;
  }

  function validSource(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
    return {
      NODE_ENV: "test",
      AUTH_URL: "http://127.0.0.1:3100/",
      AUTH_SECRET_FILE: authSecretPath,
      AUTH_SECURE_COOKIES: "false",
      KOKORO_IAM_BASE_URL: "http://127.0.0.1:4100/",
      KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: workloadTokenPath,
      MAGIC_LINK_MAX_AGE: "600",
      EMAIL_FROM: "no-reply@kokoro.local",
      EMAIL_SERVER_HOST: "127.0.0.1",
      EMAIL_SERVER_PORT: "1025",
      ...overrides,
    };
  }

  it("WEB-UNIT-CONFIG-001 loads normalized local fixture settings and distinct RPC limits", () => {
    const config = loadAdminConfig(validSource());

    expect(config).toEqual({
      mode: "test",
      auth: {
        url: "http://127.0.0.1:3100",
        secret: "A".repeat(64),
        secureCookies: false,
      },
      iam: {
        baseUrl: "http://127.0.0.1:4100",
        workloadToken: "b".repeat(64),
        requestLimitBytes: 64 * 1024,
        responseLimitBytes: 1024 * 1024,
        timeoutMs: 15_000,
      },
      magicLinkMaxAgeSeconds: 600,
      smtp: {
        from: "no-reply@kokoro.local",
        host: "127.0.0.1",
        port: 1025,
        auth: null,
      },
    });
    expect(config.iam.requestLimitBytes).not.toBe(config.iam.responseLimitBytes);
  });

  it("WEB-UNIT-CONFIG-001 requires a lowercase 64-hex IAM credential and 32-byte Auth.js secret", async () => {
    const marker = "NOT_A_SECRET_MARKER";
    const badToken = await secretFile("bad-token", marker);
    const shortAuth = await secretFile("short-auth", "short");

    expect(() => loadAdminConfig(validSource({ KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: badToken })))
      .toThrow("KOKORO_IAM_ADMIN_WEB_TOKEN_FILE");
    expect(() => loadAdminConfig(validSource({ AUTH_SECRET_FILE: shortAuth })))
      .toThrow("AUTH_SECRET_FILE");
    try {
      loadAdminConfig(validSource({ KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: badToken }));
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain(marker);
    }
  });

  it("WEB-UNIT-CONFIG-001 requires SMTP user and password file as an exact pair", async () => {
    const passwordPath = await secretFile("smtp-password", "P".repeat(32));

    expect(() => loadAdminConfig(validSource({ EMAIL_SERVER_USER: "mailer" })))
      .toThrow(/EMAIL_SERVER_USER.*EMAIL_SERVER_PASSWORD_FILE/u);
    expect(() => loadAdminConfig(validSource({ EMAIL_SERVER_PASSWORD_FILE: passwordPath })))
      .toThrow(/EMAIL_SERVER_USER.*EMAIL_SERVER_PASSWORD_FILE/u);
    expect(loadAdminConfig(validSource({
      EMAIL_SERVER_USER: "mailer",
      EMAIL_SERVER_PASSWORD_FILE: passwordPath,
    })).smtp.auth).toEqual({ user: "mailer", password: "P".repeat(32) });
  });

  it("WEB-UNIT-CONFIG-001 validates the browser origin separately from the IAM RPC endpoint", () => {
    expect(() => loadAdminConfig(validSource({ AUTH_URL: "http://admin.example.test" })))
      .toThrow("AUTH_URL");
    expect(loadAdminConfig(validSource({
      KOKORO_IAM_BASE_URL: "http://iam.internal:4100",
    })).iam.baseUrl).toBe("http://iam.internal:4100");
    expect(() => loadAdminConfig(validSource({
      NODE_ENV: "production",
      AUTH_URL: "http://127.0.0.1:3100",
      AUTH_SECURE_COOKIES: "true",
      KOKORO_IAM_BASE_URL: "https://iam.example.test",
    }))).toThrow("AUTH_URL");
    expect(loadAdminConfig(validSource({
      NODE_ENV: "production",
      AUTH_URL: "https://admin.example.test",
      AUTH_SECURE_COOKIES: "true",
      KOKORO_IAM_BASE_URL: "http://iam.internal:4100",
    })).iam.baseUrl).toBe("http://iam.internal:4100");
  });

  it("WEB-UNIT-CONFIG-001 requires HTTPS and secure cookies together in production", () => {
    expect(() => loadAdminConfig(validSource({
      NODE_ENV: "production",
      AUTH_URL: "https://admin.example.test",
      AUTH_SECURE_COOKIES: "false",
      KOKORO_IAM_BASE_URL: "https://iam.example.test",
    }))).toThrow("AUTH_SECURE_COOKIES");

    expect(loadAdminConfig(validSource({
      NODE_ENV: "production",
      AUTH_URL: "https://admin.example.test",
      AUTH_SECURE_COOKIES: "true",
      KOKORO_IAM_BASE_URL: "https://iam.example.test",
    })).mode).toBe("production");
  });
});
