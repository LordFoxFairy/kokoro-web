// hub 规则：required 锁定错误判定（仅 409 hub.skill_required）；配额占用判定（0 上限=无限）。
import { describe, expect, it } from "vitest"

import { HubClientError } from "@/hub/client"
import { isQuotaExhausted, isRequiredLockError } from "@/hub/rules"
import type { SkillQuota } from "@/hub/schemas"

function quota(over: Partial<SkillQuota>): SkillQuota {
  return {
    namespace: "team_1",
    package_count: 1,
    package_bytes: 1024,
    max_packages: 20,
    max_bytes: 10_000_000,
    ...over,
  }
}

describe("isRequiredLockError", () => {
  it("命中 hub.skill_required", () => {
    expect(isRequiredLockError(new HubClientError("http", "required", "hub.skill_required", 409))).toBe(true)
  })

  it("其它错误码 / 非 HubClientError 不命中", () => {
    expect(isRequiredLockError(new HubClientError("http", "x", "other.code", 400))).toBe(false)
    expect(isRequiredLockError(new Error("boom"))).toBe(false)
    expect(isRequiredLockError(null)).toBe(false)
  })
})

describe("isQuotaExhausted", () => {
  it("包数或字节达上限即耗尽", () => {
    expect(isQuotaExhausted(quota({ package_count: 20, max_packages: 20 }))).toBe(true)
    expect(isQuotaExhausted(quota({ package_bytes: 10_000_000, max_bytes: 10_000_000 }))).toBe(true)
  })

  it("未达上限不耗尽", () => {
    expect(isQuotaExhausted(quota({}))).toBe(false)
  })

  it("上限为 0 视为无限，不判耗尽", () => {
    expect(isQuotaExhausted(quota({ package_count: 99, max_packages: 0, package_bytes: 99, max_bytes: 0 }))).toBe(false)
  })
})
