import "server-only";

import type { NextAuthConfig } from "next-auth";

type AuthLogger = NonNullable<NextAuthConfig["logger"]>;
type AuthLogLevel = "error" | "warn";

const allowedKinds = new Set([
  "AccessDenied",
  "AdapterError",
  "CallbackRouteError",
  "Configuration",
  "SessionTokenError",
  "Verification",
]);

function kind(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const candidate: unknown = Reflect.get(value, "type");
    if (typeof candidate === "string" && allowedKinds.has(candidate)) return candidate;
  }
  return "Unknown";
}

export function serializeAuthLog(level: AuthLogLevel, value: unknown): string {
  return JSON.stringify({
    event: "auth.framework",
    level,
    kind: level === "warn" ? "Warning" : kind(value),
  });
}

export function createAuthLogger(
  sink: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): AuthLogger {
  return Object.freeze({
    error(error) {
      sink.write(`${serializeAuthLog("error", error)}\n`);
    },
    warn(code) {
      sink.write(`${serializeAuthLog("warn", code)}\n`);
    },
    debug() {},
  });
}
