import "@testing-library/jest-dom/vitest"

import { afterEach } from "vitest"

import { __resetResourceStore } from "@/lib/query/resource-store"

// 查询层模块级缓存跨用例隔离：每例后清空，避免上例数据/在飞态污染下例（与 cleanup 同级）。
afterEach(() => {
  __resetResourceStore()
})

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

if (!window.ResizeObserver) {
  class ResizeObserver {
    observe() {
      return undefined
    }

    unobserve() {
      return undefined
    }

    disconnect() {
      return undefined
    }
  }

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserver,
  })
}

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => undefined
}

const originalGetComputedStyle = window.getComputedStyle.bind(window)
window.getComputedStyle = (element: Element, pseudoElement?: string | null) => {
  if (pseudoElement) {
    return originalGetComputedStyle(element)
  }

  return originalGetComputedStyle(element, pseudoElement)
}
