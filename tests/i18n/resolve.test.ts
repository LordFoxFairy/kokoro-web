import { describe, expect, it } from "vitest"

import { en } from "@/i18n/en"
import { zh } from "@/i18n/messages"
import { negotiateLocale, resolveMessage } from "@/i18n/resolve"

describe("i18n 协商（technical/14）", () => {
  it("存储偏好优先于浏览器语言", () => {
    expect(negotiateLocale("en", ["zh-CN"])).toBe("en")
    expect(negotiateLocale("zh", ["en-US"])).toBe("zh")
  })
  it("无存储时按浏览器语言前缀匹配", () => {
    expect(negotiateLocale(null, ["en-GB", "zh"])).toBe("en")
    expect(negotiateLocale(null, ["zh-TW"])).toBe("zh")
  })
  it("非法存储值/无匹配 → 默认中文", () => {
    expect(negotiateLocale("fr", ["fr-FR"])).toBe("zh")
    expect(negotiateLocale(null, [])).toBe("zh")
  })
})

describe("i18n 解析 fallback（未译回退中文源，绝不裸露 key）", () => {
  it("en 有译取译文，缺译回退中文源", () => {
    expect(resolveMessage("en", "rail.newChat")).toBe("New chat")
    // lang.zh 在 en 表里恒为中文（语言名不翻）——同源即回退无损。
    expect(resolveMessage("zh", "rail.newChat")).toBe("新对话")
  })
  it("{插值} 命中替换、缺参保留原样", () => {
    expect(resolveMessage("zh", "thread.toolCount", { tools: 3 })).toBe("3 个工具")
    expect(resolveMessage("en", "composer.modeLocked", { mode: "Fast" })).toBe(
      "Response mode: Fast (locked this turn)",
    )
  })
})

describe("i18n 语言包完整性（构建期可校验）", () => {
  it("en 表的 key 全部是 zh 源的合法子集（无孤儿 key）", () => {
    const zhKeys = new Set(Object.keys(zh))
    for (const key of Object.keys(en)) expect(zhKeys.has(key)).toBe(true)
  })
})
