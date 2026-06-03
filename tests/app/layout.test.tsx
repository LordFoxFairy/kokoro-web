import { describe, expect, it, vi } from "vitest"

// next/font/google 在 vitest 下不可直接执行（非构建期），桩掉它即可导入真实 layout
// 并断言其实际渲染出的 <html> 元素属性，而非对源码做正则——这是对渲染输出的真断言。
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}))

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
