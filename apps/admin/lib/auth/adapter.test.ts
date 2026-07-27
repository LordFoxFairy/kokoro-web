import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthClient } from "@/lib/auth/client";
import { operatorAdapter } from "@/lib/auth/adapter";

const ACTIVE = { id: "op-1", email: "admin@kokoro.local", displayName: "Admin", status: "active" as const };
const client = {
  findOperatorByEmail: vi.fn(),
  findOperatorById: vi.fn(),
  createVerificationToken: vi.fn(),
  consumeVerificationToken: vi.fn(),
  recordAuthEvent: vi.fn(),
} as unknown as AdminAuthClient;
const adapter = operatorAdapter(client);

beforeEach(() => vi.clearAllMocks());

describe("getUserByEmail", () => {
  it("active account → AdapterUser（emailVerified 恒 null）", async () => {
    vi.mocked(client.findOperatorByEmail).mockResolvedValue(ACTIVE);
    expect(await adapter.getUserByEmail!("admin@kokoro.local")).toEqual({
      id: "op-1",
      email: "admin@kokoro.local",
      emailVerified: null,
      name: "Admin",
    });
  });

  it("邮箱规范化后通过 RPC 查询，非 active → null", async () => {
    vi.mocked(client.findOperatorByEmail).mockResolvedValue({ ...ACTIVE, status: "disabled" });
    expect(await adapter.getUserByEmail!("  Admin@KOKORO.local  ")).toBeNull();
    expect(client.findOperatorByEmail).toHaveBeenCalledWith("admin@kokoro.local");
  });
});

describe("verification token", () => {
  it("创建和原子消费均委托 Platform owner", async () => {
    const token = { identifier: "admin@kokoro.local", token: "t", expires: new Date() };
    vi.mocked(client.createVerificationToken).mockResolvedValue(token);
    vi.mocked(client.consumeVerificationToken).mockResolvedValue(token);
    await expect(adapter.createVerificationToken!({ ...token, identifier: "Admin@Kokoro.local" })).resolves.toEqual(token);
    await expect(adapter.useVerificationToken!({ identifier: "Admin@Kokoro.local", token: "t" })).resolves.toEqual(token);
    expect(client.createVerificationToken).toHaveBeenCalledWith({ ...token, identifier: "admin@kokoro.local" });
    expect(client.consumeVerificationToken).toHaveBeenCalledWith({ identifier: "admin@kokoro.local", token: "t" });
  });
});

describe("updateUser", () => {
  it("必须通过 RPC 回查完整 active user", async () => {
    vi.mocked(client.findOperatorById).mockResolvedValue(ACTIVE);
    expect(await adapter.updateUser!({ id: "op-1", emailVerified: new Date() })).toEqual({
      id: "op-1",
      email: "admin@kokoro.local",
      emailVerified: null,
      name: "Admin",
    });
  });

  it("账号消失/停用 → AccessDenied", async () => {
    vi.mocked(client.findOperatorById).mockResolvedValue(null);
    await expect(adapter.updateUser!({ id: "gone", emailVerified: new Date() })).rejects.toThrow("AccessDenied");
  });
});
