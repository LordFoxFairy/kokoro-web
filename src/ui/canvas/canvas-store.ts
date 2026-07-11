// Canvas 工作区面板的事件总线 store（页面级单例，SSR 零触发）：
// 任何组件可直接 openCanvas/closeCanvas，免层层 prop 钻透（三栏第三栏的开合真源）。
// 会话级记忆：按会话键各存一槽（内容+开合+全屏），切会话即读回各自的槽；
// 「closed」只由用户手动关闭记账——切会话/程序性动作不改开合意图。

import type { ReactNode } from "react"

import type {
  SessionDelivery,
  SessionStreamState,
  SessionToolCall,
  WorkspaceFileEntry,
} from "@/core/state"

// 内容引用（非快照）：渲染时按引用向线程状态解析最新数据（工具结果回流即活更新）。
// node 槽是通用 ReactNode 插槽——canvas 不绑死任何单一产物类型。
export type CanvasContentRef =
  | { kind: "file"; path: string }
  | { kind: "delivery"; contentHash: string }
  // 工具详情：runId+toolId 定位活数据；snapshot 为线程态缺位时的兜底显示。
  | { kind: "tool"; runId: string; toolId: string; snapshot: SessionToolCall }
  | { kind: "node"; title: string; node: ReactNode }

export type CanvasSlot = {
  content: CanvasContentRef | null
  open: boolean
  fullscreen: boolean
}

type CanvasState = {
  byKey: Record<string, CanvasSlot>
}

const CLOSED_SLOT: CanvasSlot = { content: null, open: false, fullscreen: false }

let state: CanvasState = { byKey: {} }
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function patchSlot(key: string, patch: Partial<CanvasSlot>): void {
  const current = state.byKey[key] ?? CLOSED_SLOT
  state = { byKey: { ...state.byKey, [key]: { ...current, ...patch } } }
  emit()
}

export function subscribeCanvas(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

// useSyncExternalStore 快照：不可变整体，变更即换引用。
export function readCanvasState(): CanvasState {
  return state
}

const EMPTY_STATE: CanvasState = { byKey: {} }

// SSR 快照：恒空且引用稳定（服务端不存在开合意图）。
export function serverCanvasState(): CanvasState {
  return EMPTY_STATE
}

export function canvasSlot(current: CanvasState, key: string | null): CanvasSlot {
  if (key === null) {
    return CLOSED_SLOT
  }
  return current.byKey[key] ?? CLOSED_SLOT
}

// 打开内容：换内容即展开（用户点击产物/工具本身就是打开意图，覆盖此前的手动关闭）。
export function openCanvas(key: string, content: CanvasContentRef): void {
  patchSlot(key, { content, open: true })
}

// 手动关闭（唯一记「closed」的路径）：内容留槽，重开入口据此可恢复。
export function closeCanvas(key: string): void {
  patchSlot(key, { open: false, fullscreen: false })
}

// 重开：仅当槽里还有内容时生效（无内容无可开）。
export function reopenCanvas(key: string): void {
  const slot = state.byKey[key]
  if (slot?.content) {
    patchSlot(key, { open: true })
  }
}

export function toggleCanvasFullscreen(key: string): void {
  const slot = state.byKey[key] ?? CLOSED_SLOT
  patchSlot(key, { fullscreen: !slot.fullscreen })
}

// 测试隔离入口：清空全部槽位与订阅间互不残留。
export function resetCanvasStore(): void {
  state = { byKey: {} }
  emit()
}

// —— 内容解析（纯派生）：引用 → 线程状态里的最新数据 ——

export type ResolvedCanvasContent =
  | { kind: "file"; file: WorkspaceFileEntry }
  | { kind: "delivery"; delivery: SessionDelivery }
  | { kind: "tool"; tool: SessionToolCall }
  | { kind: "node"; title: string; node: ReactNode }

export function resolveCanvasContent(
  ref: CanvasContentRef,
  thread: SessionStreamState,
): ResolvedCanvasContent | null {
  switch (ref.kind) {
    case "file": {
      // 清单里未及刷新的新文件以 MIME 兜底构造（路径即入口，不等 filesSync）。
      const known = thread.files.find((file) => file.path === ref.path)
      return { kind: "file", file: known ?? { path: ref.path, mime: "text/plain", bytes: 0 } }
    }
    case "delivery": {
      const delivery = thread.deliveries.find((d) => d.contentHash === ref.contentHash)
      return delivery ? { kind: "delivery", delivery } : null
    }
    case "tool": {
      // 优先取线程活数据（结果回流即更新）；线程缺位（切会话回来等）用点击时快照兜底。
      const steps = thread.stepsByRun[ref.runId] ?? []
      for (const step of steps) {
        if (step.kind === "tool" && step.tool.id === ref.toolId) {
          return { kind: "tool", tool: step.tool }
        }
      }
      return { kind: "tool", tool: ref.snapshot }
    }
    case "node":
      return { kind: "node", title: ref.title, node: ref.node }
  }
}
