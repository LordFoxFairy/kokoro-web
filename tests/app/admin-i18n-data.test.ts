import { describe, expect, it } from "vitest"

import { createI18nWorkbenchPayload } from "@/app/admin/i18n/i18n-data"
import { GET } from "@/app/api/i18n/preview/route"

describe("admin i18n data", () => {
  it("builds the workbench payload inside kokoro-web", () => {
    const payload = createI18nWorkbenchPayload("en-US")

    expect(payload.locale).toBe("en-US")
    expect(payload.locales).toEqual(["zh-CN", "en-US"])
    expect(payload.summary.total).toBeGreaterThan(20)
    expect(payload.filters.sources).toContain("site")
    expect(payload.filters.sources).not.toContain("modules")
    expect(payload.entries).toContainEqual(
      expect.objectContaining({
        key: "admin.modules.site",
        source: "site",
      }),
    )
    expect(payload.entries).toContainEqual(
      expect.objectContaining({
        key: "admin.user.resources.users",
        sourceText: "用户",
        zhCN: "用户",
        enUS: "Users",
        status: "ambiguous",
        source: "user",
      }),
    )
  })

  it("serves the preview payload from kokoro-web api", async () => {
    const response = await GET(new Request("http://kokoro.test/api/i18n/preview?locale=en-US"))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.locale).toBe("en-US")
    expect(payload.entries).toContainEqual(
      expect.objectContaining({
        key: "admin.site.actions.upsert",
        sourceText: "保存站点",
        enUS: "Save Site",
      }),
    )
  })
})
