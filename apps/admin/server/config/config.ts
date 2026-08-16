import "server-only";

import { isIP } from "node:net";

import { z } from "zod";

import { readSecretFile } from "./secret-file";

const emptyToUndefined = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_URL: z.string().min(1).max(2_048),
  AUTH_SECRET_FILE: z.string().min(1).max(4_096),
  AUTH_SECURE_COOKIES: z.enum(["true", "false"]).transform((value) => value === "true"),
  KOKORO_IAM_BASE_URL: z.string().min(1).max(2_048),
  KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: z.string().min(1).max(4_096),
  MAGIC_LINK_MAX_AGE: z.coerce.number().int().min(60).max(3_600).default(600),
  EMAIL_FROM: z.string().trim().min(3).max(320),
  EMAIL_SERVER_HOST: z.string().trim().min(1).max(255),
  EMAIL_SERVER_PORT: z.coerce.number().int().min(1).max(65_535),
  EMAIL_SERVER_USER: emptyToUndefined,
  EMAIL_SERVER_PASSWORD_FILE: emptyToUndefined,
});

export type IamTransportConfig = Readonly<{
  baseUrl: string;
  workloadToken: string;
  requestLimitBytes: number;
  responseLimitBytes: number;
  timeoutMs: number;
}>;

export type AdminRuntimeConfig = Readonly<{
  mode: "development" | "test" | "production";
  auth: Readonly<{
    url: string;
    secret: string;
    secureCookies: boolean;
  }>;
  iam: IamTransportConfig;
  magicLinkMaxAgeSeconds: number;
  smtp: Readonly<{
    from: string;
    host: string;
    port: number;
    auth: Readonly<{ user: string; password: string }> | null;
  }>;
}>;

function invalid(...names: string[]): never {
  throw new Error(`invalid Admin configuration: ${names.join(", ")}`);
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "[::1]" || normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

function normalizedUrl(value: string, label: string): URL {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return invalid(label);
    if (url.protocol !== "http:" && url.protocol !== "https:") return invalid(label);
    if (url.pathname !== "/") return invalid(label);
    return url;
  } catch {
    return invalid(label);
  }
}

export function loadAdminConfig(source: NodeJS.ProcessEnv = process.env): AdminRuntimeConfig {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment")))];
    return invalid(...names);
  }
  const value = parsed.data;
  if ((value.EMAIL_SERVER_USER === undefined) !== (value.EMAIL_SERVER_PASSWORD_FILE === undefined)) {
    return invalid("EMAIL_SERVER_USER", "EMAIL_SERVER_PASSWORD_FILE");
  }

  const authUrl = normalizedUrl(value.AUTH_URL, "AUTH_URL");
  const iamBaseUrl = normalizedUrl(value.KOKORO_IAM_BASE_URL, "KOKORO_IAM_BASE_URL");
  if (authUrl.protocol === "http:" && (value.NODE_ENV === "production" || !isLoopback(authUrl.hostname))) {
    return invalid("AUTH_URL");
  }
  if (value.NODE_ENV === "production" && !value.AUTH_SECURE_COOKIES) return invalid("AUTH_SECURE_COOKIES");

  const authSecret = readSecretFile(value.AUTH_SECRET_FILE, {
    label: "AUTH_SECRET_FILE",
    minBytes: 32,
    maxBytes: 4_096,
  });
  const workloadToken = readSecretFile(value.KOKORO_IAM_ADMIN_WEB_TOKEN_FILE, {
    label: "KOKORO_IAM_ADMIN_WEB_TOKEN_FILE",
    minBytes: 64,
    maxBytes: 64,
    pattern: /^[a-f0-9]{64}$/u,
  });
  const smtpAuth = value.EMAIL_SERVER_USER === undefined || value.EMAIL_SERVER_PASSWORD_FILE === undefined
    ? null
    : Object.freeze({
        user: value.EMAIL_SERVER_USER,
        password: readSecretFile(value.EMAIL_SERVER_PASSWORD_FILE, {
          label: "EMAIL_SERVER_PASSWORD_FILE",
          minBytes: 1,
          maxBytes: 4_096,
        }),
      });

  return Object.freeze({
    mode: value.NODE_ENV,
    auth: Object.freeze({ url: authUrl.origin, secret: authSecret, secureCookies: value.AUTH_SECURE_COOKIES }),
    iam: Object.freeze({
      baseUrl: iamBaseUrl.origin,
      workloadToken,
      requestLimitBytes: 64 * 1_024,
      responseLimitBytes: 1_024 * 1_024,
      timeoutMs: 15_000,
    }),
    magicLinkMaxAgeSeconds: value.MAGIC_LINK_MAX_AGE,
    smtp: Object.freeze({
      from: value.EMAIL_FROM,
      host: value.EMAIL_SERVER_HOST,
      port: value.EMAIL_SERVER_PORT,
      auth: smtpAuth,
    }),
  });
}
