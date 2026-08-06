import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import type { AdminWorkloadConfig } from "./config";
import { assertAdminControlPlaneReady } from "./readiness";

class ReadinessSessionFixture extends EventEmitter {
  closed = false;
  destroyed = false;
  timeout = -1;
  timeoutHandler: (() => void) | undefined;
  closeError: Error | undefined;

  close(): void {
    if (this.closeError !== undefined) throw this.closeError;
    this.closed = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  setTimeout(milliseconds: number, handler?: () => void): void {
    this.timeout = milliseconds;
    this.timeoutHandler = handler;
  }
}

const config: AdminWorkloadConfig = {
  rpcUrl: "https://platform-admin.test:7443",
  serverName: "platform-admin.internal",
  tls: { key: "client-key", cert: "client-certificate", ca: "platform-ca" },
  axes: {
    workloadIdentityRef: "spiffe://kokoro/web/admin",
    audience: "platform-admin",
    environment: "production",
    region: "us-east-1",
    managedDeviceRef: "admin-web:production",
  },
  returnIntentRef: "dashboard",
  stepUpCallbackRef: "step-up",
  delivery: { issuer: "https://platform-admin.test", signingKeys: new Map(), deliveryKeys: new Map() },
};

describe("Admin control-plane readiness", () => {
  it("requires a bounded mTLS HTTP/2 settings exchange with the configured dependency", async () => {
    const session = new ReadinessSessionFixture();
    let observed: unknown;
    const ready = assertAdminControlPlaneReady(config, (authority, options) => {
      observed = { authority: String(authority), options };
      queueMicrotask(() => session.emit("remoteSettings", {}));
      return session;
    });

    await expect(ready).resolves.toBeUndefined();
    expect(observed).toEqual({
      authority: "https://platform-admin.test:7443",
      options: {
        key: "client-key",
        cert: "client-certificate",
        ca: "platform-ca",
        servername: "platform-admin.internal",
        rejectUnauthorized: true,
        ALPNProtocols: ["h2"],
      },
    });
    expect(session.timeout).toBe(0);
    expect(session.closed).toBe(true);
    expect(session.destroyed).toBe(false);
  });

  it("fails closed with a stable error when the dependency times out", async () => {
    const session = new ReadinessSessionFixture();
    const ready = assertAdminControlPlaneReady(config, () => session, 10);

    await expect(ready).rejects.toThrowError("admin_control_plane_unready");
    expect(session.destroyed).toBe(true);
  }, 200);

  it("normalizes dependency errors instead of propagating transport details", async () => {
    const session = new ReadinessSessionFixture();
    const ready = assertAdminControlPlaneReady(config, () => {
      queueMicrotask(() => session.emit("error", new Error("private-hostname-and-secret-path")));
      return session;
    });

    await expect(ready).rejects.toThrowError("admin_control_plane_unready");
    await expect(ready).rejects.not.toThrowError("private-hostname-and-secret-path");
  });

  it("fails closed when the HTTP/2 session cannot close cleanly", async () => {
    const session = new ReadinessSessionFixture();
    session.closeError = new Error("private-close-detail");
    const ready = assertAdminControlPlaneReady(config, () => {
      queueMicrotask(() => session.emit("remoteSettings", {}));
      return session;
    });

    await expect(ready).rejects.toThrowError("admin_control_plane_unready");
    expect(session.destroyed).toBe(true);
  }, 100);
});
