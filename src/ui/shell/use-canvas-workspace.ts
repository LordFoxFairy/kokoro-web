"use client"

// canvas 工作区 controller：事件总线 store 按会话键各存一槽（内容+开合+全屏），切会话即读回各自的槽——
// 产物天然按会话隔离，无需 effect 清理；「closed」只由用户手动关闭记账。thread/file/delivery/tool
// 打开入口在此收口为 activeId-bound 回调，shell 只接线不持逻辑。

import { useCallback, useSyncExternalStore } from "react"

import type { SessionDelivery, SessionToolCall } from "@/core/state"
import {
  canvasSlot,
  closeCanvas,
  openCanvas,
  readCanvasState,
  reopenCanvas,
  resolveCanvasContent,
  serverCanvasState,
  subscribeCanvas,
  toggleCanvasFullscreen,
} from "@/ui/canvas/canvas-store"

type Thread = Parameters<typeof resolveCanvasContent>[1]
type ResolvedCanvas = ReturnType<typeof resolveCanvasContent>

export type CanvasWorkspace = {
  resolvedCanvas: ResolvedCanvas | null
  canvasOpen: boolean
  canReopenCanvas: boolean
  fullscreen: boolean
  openFile: (path: string) => void
  openDelivery: (delivery: SessionDelivery) => void
  openTool: (runId: string, tool: SessionToolCall) => void
  onSelectFile: (file: { path: string }) => void
  onSelectDelivery: (delivery: SessionDelivery) => void
  onToggleFullscreen: () => void
  onClose: () => void
  onReopen: () => void
}

export function useCanvasWorkspace(activeId: string | null, thread: Thread, mounted: boolean): CanvasWorkspace {
  const canvasState = useSyncExternalStore(subscribeCanvas, readCanvasState, serverCanvasState)
  const slot = canvasSlot(canvasState, activeId)
  const resolvedCanvas =
    mounted && activeId !== null && slot.open && slot.content !== null
      ? resolveCanvasContent(slot.content, thread)
      : null
  const canvasOpen = resolvedCanvas !== null && activeId !== null
  const canReopenCanvas = mounted && activeId !== null && !slot.open && slot.content !== null

  const openFile = useCallback(
    (path: string) => {
      if (activeId !== null) {
        openCanvas(activeId, { kind: "file", path: path.replace(/^\//, "") })
      }
    },
    [activeId],
  )
  const openDelivery = useCallback(
    (delivery: SessionDelivery) => {
      if (activeId !== null) {
        openCanvas(activeId, { kind: "delivery", contentHash: delivery.contentHash })
      }
    },
    [activeId],
  )
  const openTool = useCallback(
    (runId: string, tool: SessionToolCall) => {
      if (activeId !== null) {
        openCanvas(activeId, { kind: "tool", runId, toolId: tool.id, snapshot: tool })
      }
    },
    [activeId],
  )

  const onSelectFile = useCallback(
    (file: { path: string }) => {
      if (activeId !== null) {
        openCanvas(activeId, { kind: "file", path: file.path })
      }
    },
    [activeId],
  )
  const onSelectDelivery = useCallback(
    (delivery: SessionDelivery) => {
      if (activeId !== null) {
        openCanvas(activeId, { kind: "delivery", contentHash: delivery.contentHash })
      }
    },
    [activeId],
  )
  const onToggleFullscreen = useCallback(() => {
    if (activeId !== null) {
      toggleCanvasFullscreen(activeId)
    }
  }, [activeId])
  const onClose = useCallback(() => {
    if (activeId !== null) {
      closeCanvas(activeId)
    }
  }, [activeId])
  const onReopen = useCallback(() => {
    if (activeId !== null) {
      reopenCanvas(activeId)
    }
  }, [activeId])

  return {
    resolvedCanvas,
    canvasOpen,
    canReopenCanvas,
    fullscreen: slot.fullscreen,
    openFile,
    openDelivery,
    openTool,
    onSelectFile,
    onSelectDelivery,
    onToggleFullscreen,
    onClose,
    onReopen,
  }
}
