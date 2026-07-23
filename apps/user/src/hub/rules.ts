// hub 面业务规则判定（纯规则，零 React 零 I/O）：required 技能锁定 / 配额占用换算。
// UI 只消费这些谓词，不在组件内散写错误码字符串比较与配额算术。

import { HubClientError } from "./client"
import type { SkillQuota } from "./schemas"

// required 官方技能拒关：hub 以 409 hub.skill_required 反射，UI 据此锁定该技能 toggle。
export function isRequiredLockError(error: unknown): boolean {
  return error instanceof HubClientError && error.code === "hub.skill_required"
}

// 配额占用（包数 / 字节）：是否已达上限。max 为 0 视为无上限（不判超）。
export function isQuotaExhausted(quota: SkillQuota): boolean {
  const packagesFull = quota.max_packages > 0 && quota.package_count >= quota.max_packages
  const bytesFull = quota.max_bytes > 0 && quota.package_bytes >= quota.max_bytes
  return packagesFull || bytesFull
}
