import type { AdminAuthClient } from "@/lib/auth/client";

// 审计留痕由 Platform Admin owner 持久化。沿用现有登录策略：审计失败不阻断 Auth.js 流程。
export async function logAuthEvent(
  client: AdminAuthClient,
  event: {
    email: string;
    event: "signin" | "signout" | "denied";
    reason?: string;
  },
): Promise<void> {
  try {
    await client.recordAuthEvent(event);
  } catch {
    // 审计非关键路径：吞异常，避免因留痕失败挡住用户登录
  }
}
