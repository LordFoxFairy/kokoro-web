import "server-only";

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

export type SecretFileOptions = Readonly<{
  label: string;
  minBytes?: number;
  maxBytes?: number;
  pattern?: RegExp;
}>;

function invalid(label: string): never {
  throw new Error(`invalid ${label} secret file`);
}

export function readSecretFile(path: string, options: SecretFileOptions): string {
  const minBytes = options.minBytes ?? 1;
  const maxBytes = options.maxBytes ?? 4_096;
  if (!isAbsolute(path) || normalize(path) !== path || minBytes < 1 || maxBytes < minBytes) {
    return invalid(options.label);
  }

  try {
    const stat = lstatSync(path);
    const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
    if (
      stat.isSymbolicLink()
      || !stat.isFile()
      || realpathSync(path) !== path
      || (stat.mode & 0o777) !== 0o600
      || currentUid === null
      || (stat.uid !== 0 && stat.uid !== currentUid)
    ) {
      return invalid(options.label);
    }

    const raw = readFileSync(path, "utf8");
    const value = raw.endsWith("\r\n") ? raw.slice(0, -2) : raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    const byteLength = Buffer.byteLength(value, "utf8");
    if (
      byteLength < minBytes
      || byteLength > maxBytes
      || /[\0\r\n]/u.test(value)
      || (options.pattern !== undefined && !options.pattern.test(value))
    ) {
      return invalid(options.label);
    }
    return value;
  } catch {
    return invalid(options.label);
  }
}
