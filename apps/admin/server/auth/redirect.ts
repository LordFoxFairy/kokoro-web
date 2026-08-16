import "server-only";

import { isIP } from "node:net";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const allowedPaths = new RegExp(
  `^(?:/$|/(?:users|organizations)(?:/${uuid})?/?$|/(?:sessions|access|audit)/?$)`,
  "u",
);
const encodedUnsafe = /%(?:00|2e|2f|5c)/iu;
const traversal = /(?:^|\/)\.{1,2}(?:\/|$)/u;

function loopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "[::1]"
    || normalized === "::1"
    || (isIP(normalized) === 4 && normalized.startsWith("127."));
}

function canonicalOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== "/"
      || (url.protocol !== "https:" && (url.protocol !== "http:" || !loopback(url.hostname)))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function safeAuthRedirect(value: string, baseUrl: string): string {
  const base = canonicalOrigin(baseUrl);
  if (base === null) return "/";
  const fallback = `${base.origin}/`;
  if (value === base.origin || value === fallback) return fallback;
  if (
    value.length < 1
    || value.length > 2_048
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || value.includes("#")
    || encodedUnsafe.test(value)
  ) {
    return fallback;
  }
  const rawPath = value.split("?", 1)[0] ?? "";
  if (traversal.test(rawPath) || !allowedPaths.test(rawPath)) return fallback;
  try {
    const target = new URL(value, fallback);
    return target.origin === base.origin && allowedPaths.test(target.pathname) ? target.href : fallback;
  } catch {
    return fallback;
  }
}
