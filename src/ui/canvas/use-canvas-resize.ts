import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useState,
} from "react"

// Canvas 第三栏拖拽改宽的钳制边界：与 rail 同法，宽度从容器右缘量取。
const CANVAS_MIN = 320
const CANVAS_MAX = 760
const MAIN_MIN = 360
const CANVAS_DEFAULT = 480

function clampCanvas(raw: number, containerWidth: number): number {
  const max = Math.min(CANVAS_MAX, containerWidth - MAIN_MIN)
  // 容器极窄时 max 可能小于 min：回退到 min，不返回负数/反转区间。
  return Math.max(CANVAS_MIN, Math.min(raw, Math.max(CANVAS_MIN, max)))
}

// 返回 canvas 宽度（px）、容器 ref（与 rail 共用 shell 节点即可）、分隔条拖拽起始处理器。
export function useCanvasResize(containerRef: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(CANVAS_DEFAULT)
  // 拖拽中标记：拖拽期间 shell 关列宽过渡，宽度实时跟手。
  const [isResizing, setIsResizing] = useState(false)

  const onResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const container = containerRef.current
      if (!container) {
        return
      }
      event.preventDefault()
      // 起始即量取容器矩形：拖拽期间容器不移动，用右缘把 clientX 换算成 canvas 宽度。
      const rect = container.getBoundingClientRect()
      setIsResizing(true)

      const move = (moveEvent: PointerEvent) => {
        setWidth(clampCanvas(rect.right - moveEvent.clientX, rect.width))
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
    },
    [containerRef],
  )

  return { width, isResizing, onResizeStart }
}
