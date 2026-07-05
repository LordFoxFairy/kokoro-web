import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  I18nWorkbench,
  type I18nWorkbenchPayload,
} from "@/app/admin/i18n/i18n-workbench"

const payload: I18nWorkbenchPayload = {
  locale: "zh-CN",
  locales: ["zh-CN", "en-US"],
  summary: {
    total: 4,
    ready: 2,
    ambiguous: 2,
  },
  filters: {
    contexts: ["admin.action", "admin.resource", "platform.module"],
    sources: ["platform", "site", "user"],
  },
  entries: [
    {
      key: "platform.modules.user",
      sourceText: "用户",
      context: "platform.module",
      zhCN: "用户",
      enUS: "User",
      status: "ambiguous",
      source: "platform",
    },
    {
      key: "admin.user.resources.users",
      sourceText: "用户",
      context: "admin.resource",
      zhCN: "用户",
      enUS: "Users",
      status: "ambiguous",
      source: "user",
    },
    {
      key: "admin.site.actions.upsert",
      sourceText: "保存站点",
      context: "admin.action",
      zhCN: "保存站点",
      enUS: "Save Site",
      status: "ready",
      source: "site",
    },
    {
      key: "admin.site.resources.domains",
      sourceText: "域名",
      context: "admin.resource",
      zhCN: "域名",
      enUS: "Domains",
      status: "ready",
      source: "site",
    },
  ],
}

afterEach(() => {
  cleanup()
})

describe("I18nWorkbench", () => {
  it("keeps the language picker inside the table filters", () => {
    render(<I18nWorkbench payload={payload} onLocaleChange={vi.fn()} />)

    const filters = screen.getByRole("region", { name: "文案筛选" })
    expect(within(filters).getByRole("combobox", { name: "目标语言" })).toBeInTheDocument()
    expect(within(filters).getByRole("searchbox", { name: "搜索原文或译文" })).toBeInTheDocument()
    expect(within(filters).getByRole("radiogroup", { name: "状态" })).toBeInTheDocument()
    expect(within(filters).getByRole("combobox", { name: "归属" })).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "语言列表" })).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  })

  it("keeps technical key and context out of the operations UI", () => {
    render(<I18nWorkbench payload={payload} />)

    expect(screen.getByRole("columnheader", { name: "原文 Key" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Context" })).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "上下文" })).not.toBeInTheDocument()
    expect(screen.queryByText("platform.modules.user")).not.toBeInTheDocument()
    expect(screen.queryByText("platform.module")).not.toBeInTheDocument()
  })

  it("filters translation rows by search text", () => {
    render(<I18nWorkbench payload={payload} />)

    fireEvent.change(screen.getByPlaceholderText("搜索原文或译文"), {
      target: { value: "保存" },
    })

    expect(screen.getByRole("row", { name: /保存站点/ })).toBeInTheDocument()
    expect(screen.queryByRole("row", { name: /User/ })).not.toBeInTheDocument()
    expect(screen.getByText("1 条结果")).toBeInTheDocument()
  })

  it("filters translation rows by status", async () => {
    render(<I18nWorkbench payload={payload} />)

    fireEvent.click(screen.getByRole("radio", { name: "重复原文" }))

    const duplicatedRows = screen
      .getAllByRole("row")
      .filter((row) => within(row).queryByText("重复原文") !== null)
    expect(duplicatedRows).toHaveLength(2)
    expect(screen.queryByRole("row", { name: /Save Site/ })).not.toBeInTheDocument()
    expect(screen.getByText("2 条结果")).toBeInTheDocument()
  })

  it("shows pagination for operations-scale maintenance", () => {
    render(<I18nWorkbench payload={payload} />)

    expect(screen.getByText("1-4 / 4 条")).toBeInTheDocument()
  })

  it("opens an operations-focused row details drawer", async () => {
    render(<I18nWorkbench payload={payload} />)

    fireEvent.click(screen.getAllByRole("button", { name: "查看 用户" })[0])

    expect(await screen.findByText("翻译详情")).toBeInTheDocument()
    expect(screen.getAllByText("原文 Key").length).toBeGreaterThan(0)
    expect(screen.getAllByText("用户").length).toBeGreaterThan(0)
    expect(screen.getAllByText("User").length).toBeGreaterThan(0)
    expect(screen.queryByText("platform.modules.user")).not.toBeInTheDocument()
    expect(screen.queryByText("platform.module")).not.toBeInTheDocument()
  })
})
