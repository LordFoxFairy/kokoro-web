import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSecretFile } from "../../server/config/secret-file";

describe("exact secret-file boundary", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "kokoro-admin-secret-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("WEB-UNIT-SECRET-001 reads an absolute normalized owned 0600 regular file", async () => {
    const path = join(root, "workload-token");
    await writeFile(path, `${"a".repeat(64)}\n`, { mode: 0o600 });

    expect(readSecretFile(path, {
      label: "KOKORO_IAM_ADMIN_WEB_TOKEN_FILE",
      minBytes: 64,
      maxBytes: 64,
      pattern: /^[a-f0-9]{64}$/u,
    })).toBe("a".repeat(64));
  });

  it("WEB-UNIT-SECRET-001 rejects relative non-normalized and symlink paths", async () => {
    const target = join(root, "target");
    const link = join(root, "link");
    await writeFile(target, "s".repeat(32), { mode: 0o600 });
    await symlink(target, link);

    expect(() => readSecretFile("relative-secret", { label: "AUTH_SECRET_FILE", minBytes: 32 }))
      .toThrow("AUTH_SECRET_FILE");
    expect(() => readSecretFile(`${root}/nested/../target`, { label: "AUTH_SECRET_FILE", minBytes: 32 }))
      .toThrow("AUTH_SECRET_FILE");
    expect(() => readSecretFile(link, { label: "AUTH_SECRET_FILE", minBytes: 32 }))
      .toThrow("AUTH_SECRET_FILE");
  });

  it("WEB-UNIT-SECRET-001 rejects permissions other than exact 0600 without leaking values", async () => {
    const marker = "SECRET_MARKER_8f52a3f7";
    const path = join(root, "wrong-mode");
    await writeFile(path, marker.repeat(3), { mode: 0o600 });
    await chmod(path, 0o640);

    let message = "";
    try {
      readSecretFile(path, { label: "AUTH_SECRET_FILE", minBytes: 32 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("AUTH_SECRET_FILE");
    expect(message).not.toContain(marker);
    expect(message).not.toContain(path);
  });
});
