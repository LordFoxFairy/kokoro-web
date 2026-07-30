import "server-only";

import type { Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";

import { adminWorkloadConfig } from "./config";

let cached: Promise<Transport> | undefined;

export function adminControlPlaneTransport(): Promise<Transport> {
  cached ??= create();
  return cached;
}

async function create(): Promise<Transport> {
  const config = await adminWorkloadConfig();
  return createConnectTransport({
    baseUrl: config.rpcUrl,
    httpVersion: "2",
    useBinaryFormat: true,
    defaultTimeoutMs: 8_000,
    readMaxBytes: 8 * 1024 * 1024,
    writeMaxBytes: 16 * 1024 * 1024,
    nodeOptions: {
      key: config.tls.key,
      cert: config.tls.cert,
      ca: config.tls.ca,
      servername: config.serverName,
      rejectUnauthorized: true,
      ALPNProtocols: ["h2"],
    },
  });
}
