import "server-only";

import { connect } from "node:http2";

import { adminWorkloadConfig, type AdminWorkloadConfig } from "./config";

interface ReadinessSession {
  once(event: "remoteSettings", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  setTimeout(milliseconds: number, listener?: () => void): unknown;
  close(): void;
  destroy(): void;
}

interface ReadinessTlsOptions {
  readonly key: string;
  readonly cert: string;
  readonly ca: string;
  readonly servername: string;
  readonly rejectUnauthorized: true;
  readonly ALPNProtocols: readonly ["h2"];
}

type ReadinessConnector = (
  authority: string,
  options: ReadinessTlsOptions,
) => ReadinessSession;

const DEFAULT_TIMEOUT_MS = 2_000;

const connectDependency: ReadinessConnector = (authority, options) =>
  connect(authority, options);

export async function adminControlPlaneReadiness(): Promise<void> {
  const config = await adminWorkloadConfig();
  await assertAdminControlPlaneReady(config);
}

export function assertAdminControlPlaneReady(
  config: AdminWorkloadConfig,
  connector: ReadinessConnector = connectDependency,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let session: ReadinessSession;
    try {
      session = connector(new URL(config.rpcUrl).origin, {
        key: config.tls.key,
        cert: config.tls.cert,
        ca: config.tls.ca,
        servername: config.serverName,
        rejectUnauthorized: true,
        ALPNProtocols: ["h2"],
      });
    } catch {
      reject(unready());
      return;
    }

    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const clearDeadline = (): void => {
      if (deadline !== undefined) clearTimeout(deadline);
      deadline = undefined;
    };
    const fail = (): void => {
      if (settled) return;
      settled = true;
      clearDeadline();
      try {
        session.destroy();
      } catch {
        // The stable readiness failure below remains authoritative.
      }
      reject(unready());
    };
    const ready = (): void => {
      if (settled) return;
      try {
        session.setTimeout(0);
        session.close();
      } catch {
        fail();
        return;
      }
      settled = true;
      clearDeadline();
      resolve();
    };

    try {
      session.once("remoteSettings", ready);
      session.once("error", fail);
      session.setTimeout(timeoutMs, fail);
      deadline = setTimeout(fail, timeoutMs);
    } catch {
      fail();
    }
  });
}

function unready(): Error {
  return new Error("admin_control_plane_unready");
}
