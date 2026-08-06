import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createNodeSiteRuntimeProvider,
  loadNodeSiteRuntime,
  NodeSiteRuntimeError,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function environment(): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(join(tmpdir(), "kokoro-site-runtime-"));
  temporaryDirectories.push(directory);
  const certificate = join(directory, "client.pem");
  const key = join(directory, "client-key.pem");
  const ca = join(directory, "ca.pem");
  await Promise.all([
    writeFile(certificate, "-----BEGIN CERTIFICATE-----\ndGVzdA==\n-----END CERTIFICATE-----\n", { mode: 0o644 }),
    writeFile(key, "-----BEGIN PRIVATE KEY-----\ndGVzdA==\n-----END PRIVATE KEY-----\n", { mode: 0o600 }),
    writeFile(ca, "-----BEGIN CERTIFICATE-----\ndGVzdA==\n-----END CERTIFICATE-----\n", { mode: 0o644 }),
  ]);
  return {
    KOKORO_SITE_RUNTIME_PLATFORM_ORIGIN: "https://platform.internal.example",
    KOKORO_SITE_RUNTIME_SESSION_ORIGIN: "https://session.internal.example",
    KOKORO_PLATFORM_CSRF_TOKEN: "p".repeat(64),
    KOKORO_BROWSER_CSRF_SECRET: "b".repeat(64),
    KOKORO_SITE_RUNTIME_MTLS_CERT_FILE: certificate,
    KOKORO_SITE_RUNTIME_MTLS_KEY_FILE: key,
    KOKORO_SITE_RUNTIME_PLATFORM_CA_FILE: ca,
    KOKORO_SITE_RUNTIME_SESSION_CA_FILE: ca,
    KOKORO_SITE_UPSTREAM_TIMEOUT_MS: "2500",
    KOKORO_BROWSER_CSRF_TTL_SECONDS: "300",
  };
}

describe("Node Site deployment adapter", () => {
  it("loads only exact HTTPS origins and bounded absolute TLS secret files", async () => {
    const loaded = loadNodeSiteRuntime(await environment());

    expect(loaded.config).toMatchObject({
      platformOrigin: "https://platform.internal.example",
      sessionOrigin: "https://session.internal.example",
      upstreamTimeoutMs: 2500,
      browserCsrfTtlSeconds: 300,
    });
    expect(loaded.tls.certificate.toString()).toContain("BEGIN CERTIFICATE");
    expect(loaded.tls.platformCertificateAuthority.toString()).toContain("BEGIN CERTIFICATE");
    expect(loaded.tls.sessionCertificateAuthority.toString()).toContain("BEGIN CERTIFICATE");
  });

  it("rejects non-TLS origins and relative credential files before creating a transport", async () => {
    const env = await environment();
    env.KOKORO_SITE_RUNTIME_PLATFORM_ORIGIN = "http://platform.internal.example";
    expect(() => loadNodeSiteRuntime(env)).toThrowError(new NodeSiteRuntimeError("CONFIG_INVALID"));

    env.KOKORO_SITE_RUNTIME_PLATFORM_ORIGIN = "https://platform.internal.example";
    env.KOKORO_SITE_RUNTIME_MTLS_CERT_FILE = "client.pem";
    expect(() => loadNodeSiteRuntime(env)).toThrowError(new NodeSiteRuntimeError("TLS_MATERIAL_INVALID"));
  });

  it("rejects symlinked TLS material and a private key readable outside its owner", async () => {
    const env = await environment();
    const target = env.KOKORO_SITE_RUNTIME_MTLS_KEY_FILE!;
    const link = `${target}.link`;
    await symlink(target, link);
    env.KOKORO_SITE_RUNTIME_MTLS_KEY_FILE = link;

    expect(() => loadNodeSiteRuntime(env)).toThrowError(
      new NodeSiteRuntimeError("TLS_MATERIAL_INVALID"),
    );

    env.KOKORO_SITE_RUNTIME_MTLS_KEY_FILE = target;
    await chmod(target, 0o640);
    expect(() => loadNodeSiteRuntime(env)).toThrowError(
      new NodeSiteRuntimeError("TLS_MATERIAL_INVALID"),
    );
  });

  it("rejects writable certificate material and files larger than the bounded read", async () => {
    const env = await environment();
    const certificate = env.KOKORO_SITE_RUNTIME_MTLS_CERT_FILE!;
    await chmod(certificate, 0o666);
    expect(() => loadNodeSiteRuntime(env)).toThrowError(
      new NodeSiteRuntimeError("TLS_MATERIAL_INVALID"),
    );

    await writeFile(certificate, Buffer.alloc(1024 * 1024 + 1, 0x61));
    await chmod(certificate, 0o600);
    expect(() => loadNodeSiteRuntime(env)).toThrowError(
      new NodeSiteRuntimeError("TLS_MATERIAL_INVALID"),
    );
  });

  it("issues bounded HMAC browser CSRF capabilities and rejects tamper or expiry", async () => {
    const loaded = loadNodeSiteRuntime(await environment());
    let now = Date.parse("2026-07-29T12:00:00.000Z");
    const provider = createNodeSiteRuntimeProvider({
      ...loaded,
      now: () => now,
      nonce: () => Buffer.alloc(24, 7),
    });
    const token = provider.issueBrowserCsrf();

    expect(provider.verifyBrowserCsrf({ operationId: "submitMessage", token })).toBe(true);
    expect(provider.verifyBrowserCsrf({ operationId: "submitMessage", token: `${token.slice(0, -1)}x` })).toBe(false);
    now += 301_000;
    expect(provider.verifyBrowserCsrf({ operationId: "submitMessage", token })).toBe(false);
    provider.close();
  });
});
