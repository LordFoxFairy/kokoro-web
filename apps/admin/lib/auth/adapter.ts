import type { Adapter, AdapterUser, VerificationToken } from "next-auth/adapters";
import type { AdminAuthClient, AdminAuthOperator } from "@/lib/auth/client";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAdapterUser(account: AdminAuthOperator): AdapterUser {
  // emailVerified 恒 null：OperatorAccount 无此列；邮箱所有权由 magic-link 即时保证，不落库。
  return { id: account.id, email: account.email, emailVerified: null, name: account.displayName };
}

// 自定义 adapter：认证只证「拥有邮箱」，授权仍归 Platform Admin。Web 不读写 Platform 数据库。
export function operatorAdapter(client: AdminAuthClient): Adapter {
  return {
    async getUserByEmail(email) {
      const account = await client.findOperatorByEmail(normalizeEmail(email));
      if (!account || account.status !== "active") return null;
      return toAdapterUser(account);
    },

    async getUser(id) {
      const account = await client.findOperatorById(id);
      if (!account || account.status !== "active") return null;
      return toAdapterUser(account);
    },

    async createUser() {
      // 陌生邮箱不建账号——运营账号由管理员显式创建；兜底陌生邮箱走到此即拒。
      throw new Error("AccessDenied");
    },

    async createVerificationToken(token) {
      return client.createVerificationToken({
        identifier: normalizeEmail(token.identifier),
        token: token.token,
        expires: token.expires,
      });
    },

    async useVerificationToken({ identifier, token }) {
      return client.consumeVerificationToken({ identifier: normalizeEmail(identifier), token }) as Promise<VerificationToken | null>;
    },

    // 单 provider + JWT session 下不需要 account/session 表：no-op 保持流程不报错。
    async getUserByAccount() {
      return null;
    },
    async linkAccount() {
      return undefined;
    },
    async updateUser(user) {
      // magic-link 验证后 next-auth 调本方法写 emailVerified（本模型无此列，忽略）。
      // 必须回查返回完整 user——next-auth 拿此返回值填 JWT，只回传入参会丢 email/name。
      const account = await client.findOperatorById(user.id);
      if (!account || account.status !== "active") throw new Error("AccessDenied");
      return toAdapterUser(account);
    },
  };
}
