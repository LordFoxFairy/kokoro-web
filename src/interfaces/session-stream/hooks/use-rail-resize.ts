import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react"

// 侧栏拖拽改宽的钳制边界：保证 rail 与 main 各有最小宽度，RAIL_MAX 再加一道硬顶。
const RAIL_MIN = 200
const RAIL_MAX = 420
const MAIN_MIN = 360
// 默认 ≈ 15.5rem，与原固定列宽一致。
const RAIL_DEFAULT = 248

function clampRail(raw: number, containerWidth: number): number {
  const max = Math.min(RAIL_MAX, containerWidth - MAIN_MIN)
  // 容器极窄时 max 可能小于 min：回退到 min，不返回负数/反转区间。
  return Math.max(RAIL_MIN, Math.min(raw, Math.max(RAIL_MIN, max)))
}

// 返回当前 rail 宽度（px）、挂到 shell 的 ref（用于量取容器几何）、以及分隔条的拖拽起始处理器。
export function useRailResize() {
  const [width, setWidth] = useState(RAIL_DEFAULT)
  // 拖拽中标记：让 shell 在拖拽期间关掉列宽过渡，宽度实时跟手；仅收起/展开切换才用过渡。
  const [isResizing, setIsResizing] = useState(false)
  const shellRef = useRef<HTMLElement | null>(null)

  const onResizeStart = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const shell = shellRef.current
    if (!shell) {
      return
    }
    event.preventDefault()
    // 起始即量取容器矩形：拖拽期间容器不移动，用它把 clientX 换算成 rail 宽度。
    const rect = shell.getBoundingClientRect()
    setIsResizing(true)

    const move = (moveEvent: PointerEvent) => {
      setWidth(clampRail(moveEvent.clientX - rect.left, rect.width))
    }
    const end = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      setIsResizing(false)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    // 拖拽期间全局锁定列宽光标并禁选，避免选中文本/光标闪烁。
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  return { width, isResizing, shellRef, onResizeStart }
}
