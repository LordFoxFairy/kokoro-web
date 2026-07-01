import { describe, expect, it } from "vitest"

describe("RootLayout language", () => {
  it("sets the document language to zh-CN", async () => {
    // 为什么重要：全站文案均为中文，<html lang> 必须声明 zh-CN，
    // 否则读屏会用错误语种朗读，且不利于翻译/搜索。这是 WCAG 3.1.1 的硬要求。
    const { default: RootLayout } = await import("@/app/layout")

    const element = RootLayout({ children: null }) as {
      props: { lang?: string }
    }

    expect(element.props.lang).toBe("zh-CN")
  })
})
