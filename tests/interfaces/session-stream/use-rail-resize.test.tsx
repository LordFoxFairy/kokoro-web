import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { useRailResize } from "@/interfaces/session-stream/hooks/use-rail-resize"

afterEach(() => {
  // 先松手摘掉 window 拖拽监听，再卸载，避免跨用例泄漏改宽。
  fireEvent(window, new MouseEvent("pointerup"))
  cleanup()
})

// 与 session-shell 同款挂法：main 收 shellRef，分隔条收 onPointerDown。
function Harness() {
  const { width, isResizing, shellRef, onResizeStart } = useRailResize()
  return (
    <main ref={shellRef} data-testid="shell" data-width={width} data-resizing={isResizing ? "true" : "false"}>
      <div data-testid="resizer" role="separator" onPointerDown={onResizeStart} />
    </main>
  )
}

// jsdom 元素矩形恒为 0：手动钉死容器几何，驱动 clampRail 的各边界分支。
function setShellRect(width: number) {
  const shell = screen.getByTestId("shell")
  shell.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: 0, width, height: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
}

function dragTo(clientX: number) {
  fireEvent.pointerDown(screen.getByTestId("resizer"), { clientX: 248 })
  fireEvent(window, new MouseEvent("pointermove", { clientX }))
}

function widthOf(): number {
  return Number(screen.getByTestId("shell").dataset.width)
}

describe("useRailResize — clampRail 钳制矩阵", () => {
  it.each([
    ["正常区间原样跟手", 1000, 300, 300],
    ["下限 200 钳制", 1000, 50, 200],
    ["上限 420 硬顶", 1000, 9000, 420],
    ["main 最小宽挤压上限(1000-360=640>420 不触发;700-360=340 触发)", 700, 9000, 340],
    ["容器极窄 max<min 回退 RAIL_MIN 绝不返负", 300, 9000, 200],
    ["容器极窄 + 极小拖拽仍是 RAIL_MIN", 300, -50, 200],
  ])("%s", (_name, containerWidth, clientX, expected) => {
    render(<Harness />)
    setShellRect(containerWidth)
    dragTo(clientX)
    expect(widthOf()).toBe(expected)
  })
})

describe("useRailResize — 拖拽生命周期", () => {
  it("pointerdown 进入 resizing 并锁定 body,pointerup 复原且监听被摘除", () => {
    render(<Harness />)
    setShellRect(1000)

    fireEvent.pointerDown(screen.getByTestId("resizer"), { clientX: 248 })
    expect(screen.getByTestId("shell").dataset.resizing).toBe("true")
    expect(document.body.style.cursor).toBe("col-resize")
    expect(document.body.style.userSelect).toBe("none")

    fireEvent(window, new MouseEvent("pointermove", { clientX: 320 }))
    expect(widthOf()).toBe(320)

    fireEvent(window, new MouseEvent("pointerup"))
    expect(screen.getByTestId("shell").dataset.resizing).toBe("false")
    expect(document.body.style.cursor).toBe("")
    expect(document.body.style.userSelect).toBe("")

    // 监听已摘除：松手后的 pointermove 不再改宽。
    fireEvent(window, new MouseEvent("pointermove", { clientX: 999 }))
    expect(widthOf()).toBe(320)
  })
})
