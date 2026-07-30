import "server-only";

import { createPrivateKey, createPublicKey } from "node:crypto";
import { open } from "node:fs/promises";
import { z } from "zod";

import { getEnv } from "@/lib/env";

const keyRingSchema = z.object({
  version: z.literal(1),
  issuer: z.string().url().refine((value) => value.startsWith("https://")),
  signingKeys: z.array(z.object({ revision: z.string().min(3).max(128), publicKeyFile: z.string().min(1) })).min(1).max(8),
  deliveryKeys: z.array(z.object({ revision: z.string().min(3).max(128), privateKeyFile: z.string().min(1) })).min(1).max(32),
}).strict();

export interface AdminWorkloadConfig {
  readonly rpcUrl: string;
  readonly serverName: string;
  readonly tls: Readonly<{ key: string; cert: string; ca: string }>;
  readonly axes: Readonly<{
    workloadIdentityRef: string;
    audience: string;
    environment: string;
    region: string;
    managedDeviceRef: string;
  }>;
  readonly siteId: string;
  readonly returnIntentRef: string;
  readonly stepUpCallbackRef: string;
  readonly delivery: Readonly<{
    issuer: string;
    signingKeys: ReadonlyMap<string, string>;
    deliveryKeys: ReadonlyMap<string, string>;
  }>;
}

let cached: Promise<AdminWorkloadConfig> | undefined;

export function adminWorkloadConfig(): Promise<AdminWorkloadConfig> {
  cached ??= load();
  return cached;
}

async function load(): Promise<AdminWorkloadConfig> {
  const env = getEnv();
  const [key, cert, ca, encodedRing] = await Promise.all([
    readBounded(env.KOKORO_ADMIN_TLS_KEY_FILE, 64 * 1024),
    readBounded(env.KOKORO_ADMIN_TLS_CERT_FILE, 64 * 1024),
    readBounded(env.KOKORO_ADMIN_TLS_CA_FILE, 256 * 1024),
    readBounded(env.KOKORO_ADMIN_DELIVERY_KEY_RING_FILE, 256 * 1024),
  ]);
  const ring = keyRingSchema.parse(JSON.parse(encodedRing));
  const [signingKeys, deliveryKeys] = await Promise.all([
    Promise.all(ring.signingKeys.map(async (item) => {
      const pem = await readBounded(item.publicKeyFile, 64 * 1024);
      const keyObject = createPublicKey(pem);
      if (keyObject.asymmetricKeyType !== "ec" || keyObject.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
        throw new Error("admin_delivery_signing_key_invalid");
      }
      return [item.revision, pem] as const;
    })),
    Promise.all(ring.deliveryKeys.map(async (item) => {
      const pem = await readBounded(item.privateKeyFile, 64 * 1024);
      const keyObject = createPrivateKey(pem);
      if (keyObject.asymmetricKeyType !== "rsa" || (keyObject.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
        throw new Error("admin_delivery_private_key_invalid");
      }
      return [item.revision, pem] as const;
    })),
  ]);
  return Object.freeze({
    rpcUrl: env.KOKORO_ADMIN_RPC_URL.replace(/\/+$/u, ""),
    serverName: env.KOKORO_ADMIN_TLS_SERVER_NAME,
    tls: Object.freeze({ key, cert, ca }),
    axes: Object.freeze({
      workloadIdentityRef: env.KOKORO_ADMIN_WORKLOAD_IDENTITY_REF,
      audience: env.KOKORO_ADMIN_AUDIENCE,
      environment: env.KOKORO_ADMIN_ENVIRONMENT,
      region: env.KOKORO_ADMIN_REGION,
      managedDeviceRef: env.KOKORO_ADMIN_MANAGED_DEVICE_REF,
    }),
    siteId: env.KOKORO_ADMIN_SITE_ID,
    returnIntentRef: env.KOKORO_ADMIN_RETURN_INTENT_REF,
    stepUpCallbackRef: env.KOKORO_ADMIN_STEP_UP_CALLBACK_REF,
    delivery: Object.freeze({ issuer: ring.issuer, signingKeys: new Map(signingKeys), deliveryKeys: new Map(deliveryKeys) }),
  });
}

async function readBounded(path: string, maximum: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error("admin_private_file_invalid");
    const value = await handle.readFile();
    if (value.byteLength > maximum) throw new Error("admin_private_file_invalid");
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } finally {
    await handle.close();
  }
}
