import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Vitest 未开 globals，需显式注册 DOM 清理，避免同文件多用例渲染相互污染。
afterEach(() => {
  cleanup()
})
