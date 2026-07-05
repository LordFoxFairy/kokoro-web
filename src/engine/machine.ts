// 显式会话状态机 + 引擎：snapshot-first 水合 / 流句柄 / in-flight 守卫 / runId 锚定收束单点持有。

import type { SessionEventKind } from "@/contract/session-events"
import {
  addConversation,
  conversationTitle,
  removeConversation,
  selectConversation as selectConversationOp,
  setActiveMode,
  touchActive,
  type AgentMode,
  type ConversationStore,
} from "@/core/conversations"
import { stateFromSnapshot } from "@/core/hydration"
import {
  applySessionEvents,
  appendUserMessage,
  markRunCancelled,
  markToolRejected,
} from "@/core/reducer"
import { createSessionStreamState, type SessionStreamState } from "@/core/state"
import type { SessionEvent } from "@/contract/session-events"
import type { PersistedStore } from "@/lib/persisted-store"

import type { SessionClient, EventStreamHandle } from "./client"
import {
  buildResumeDecisions,
  pendingToolIdsOf,
  rejectedToolIds,
  stageDecision,
  type StagedDecisions,
  type ToolDecision,
} from "./hitl-staging"
import { REATTACH_TIMEOUT_MS, reattachPlanFromSnapshot } from "./reattach"

// —— 纯状态机（规格测试主战场）——

export type MachinePhase =
  | "idle"
  | "submitting"
  | "streaming"
  | "reattaching"
  | "awaiting-hitl"
  | "error"

export type MachineState = {
  phase: MachinePhase
  // 本轮锚定 run：只有它的事件能推动相位（历史 run 的终态不收束本轮）。
  runId: string | null
  error: string | null
}

export const IDLE_MACHINE: MachineState = { phase: "idle", runId: null, error: null }

export type MachineEvent =
  | { type: "SUBMIT" }
  | { type: "RECEIPT"; runId: string }
  // awaiting=true：snapshot 带 pending 暂停点，直接落 awaiting-hitl（审批卡即刻可操作）。
  | { type: "REATTACH"; runId: string; awaiting?: boolean }
  | { type: "STREAM_EVENT"; runId: string; kind: SessionEventKind }
  | { type: "RESUME_SENT" }
  | { type: "CONTROL_FAILED"; error: string }
  | { type: "RESET" }
  | { type: "TIMEOUT" }
  | { type: "FAIL"; error: string }

const ACTIVE_PHASES: readonly MachinePhase[] = ["streaming", "reattaching", "awaiting-hitl"]

// 非法迁移一律返回入参 state（引用相等即「被守卫拒绝」），调用方据此实现同步双发守卫。
export function transition(state: MachineState, event: MachineEvent): MachineState {
  switch (event.type) {
    case "SUBMIT":
      return state.phase === "idle" || state.phase === "error"
        ? { phase: "submitting", runId: null, error: null }
        : state
    case "RECEIPT":
      return state.phase === "submitting"
        ? { phase: "streaming", runId: event.runId, error: null }
        : state
    case "REATTACH":
      return state.phase === "idle" || state.phase === "error"
        ? {
            phase: event.awaiting === true ? "awaiting-hitl" : "reattaching",
            runId: event.runId,
            error: null,
          }
        : state
    case "STREAM_EVENT": {
      if (event.runId !== state.runId || !ACTIVE_PHASES.includes(state.phase)) {
        return state
      }
      if (event.kind === "run.completed" || event.kind === "run.failed") {
        return { phase: "idle", runId: null, error: null }
      }
      if (event.kind === "tool.awaiting_approval") {
        return state.phase === "awaiting-hitl"
          ? state
          : { phase: "awaiting-hitl", runId: state.runId, error: null }
      }
      // 重连后首个本轮事件：退出「重连中」，转为普通流式。
      return state.phase === "reattaching"
        ? { phase: "streaming", runId: state.runId, error: null }
        : state
    }
    case "RESUME_SENT":
      return state.phase === "awaiting-hitl"
        ? { phase: "streaming", runId: state.runId, error: null }
        : state
    case "CONTROL_FAILED":
      // control POST 失败不换相位：暂存保留可重试，仅记录错误供 UI 呈现。
      return { ...state, error: event.error }
    case "RESET":
      return state.phase === "idle" && state.runId === null && state.error === null
        ? state
        : { ...IDLE_MACHINE }
    case "TIMEOUT":
      return ACTIVE_PHASES.includes(state.phase) ? { ...IDLE_MACHINE } : state
    case "FAIL":
      return { phase: "error", runId: null, error: event.error }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

// —— 引擎（浏览器 I/O 唯一编排者，framework-free）——

export type EngineSnapshot = {
  machine: MachineState
  // 瞬态通知（如插话投递失败）：下一次提交时清空；与相位错误（machine.error）分离。
  notice: string | null
  store: ConversationStore | null
  // 活跃会话线程：snapshot 水合 + 事件折叠的内存态（不落盘，服务端是真源）。
  thread: SessionStreamState
  // 空首屏（尚无会话）时选好的模式：首条消息创建首个会话时承接它。
  pendingMode: AgentMode
  // HITL 决策暂存视图：runId → toolId → decision（供工具行渲染 decided 态）。
  staging: Record<string, Record<string, ToolDecision>>
}

const EMPTY_THREAD: SessionStreamState = createSessionStreamState()

export const SERVER_ENGINE_SNAPSHOT: EngineSnapshot = {
  machine: IDLE_MACHINE,
  notice: null,
  store: null,
  thread: EMPTY_THREAD,
  pendingMode: "fast",
  staging: {},
}

export type SessionEngine = {
  getSnapshot: () => EngineSnapshot
  subscribe: (listener: () => void) => () => void
  submit: (content: string) => void
  // 失败后重试：按最后一条用户消息原文重新开跑，不追加重复的用户气泡。
  retry: () => void
  cancelRun: () => void
  stageToolDecision: (runId: string, toolId: string, decision: ToolDecision) => void
  selectConversation: (id: string) => void
  newConversation: () => void
  deleteConversation: (id: string) => void
  setMode: (mode: AgentMode) => void
  dispose: () => void
}

export type EngineDeps = {
  client: SessionClient
  storage: PersistedStore<ConversationStore>
  now?: () => number
  createId?: (prefix: string) => string
  reattachTimeoutMs?: number
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function describeUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSessionEngine(deps: EngineDeps): SessionEngine {
  const now = deps.now ?? (() => Date.now())
  const createId = deps.createId ?? defaultCreateId
  const reattachTimeoutMs = deps.reattachTimeoutMs ?? REATTACH_TIMEOUT_MS

  let machine: MachineState = IDLE_MACHINE
  let store: ConversationStore | null = deps.storage.read()
  let thread: SessionStreamState = createSessionStreamState()
  let pendingMode: AgentMode = "fast"
  const staging = new Map<string, StagedDecisions>()
  // resume 的幂等 decision_id：control 失败重试复用同一 id，防双击/网络重试造成二次 resume。
  const resumeDecisionIds = new Map<string, string>()
  // 最近一次未获回执的提交：POST 失败重试复用同一 idempotency_key（服务端命中即重放 receipt）。
  let pendingSubmission: { content: string; idempotencyKey: string } | null = null
  let notice: string | null = null

  let handle: EventStreamHandle | null = null
  // 流代际守卫：关流后迟到的回调（旧代际）一律忽略，防止旧流事件折进新会话。
  let streamGeneration = 0
  // 水合代际守卫：切会话后迟到的 snapshot 一律丢弃。
  let hydrateGeneration = 0
  let buffer: SessionEvent[] = []
  let flushScheduled = false
  let reattachTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const listeners = new Set<() => void>()
  let snapshot: EngineSnapshot = buildSnapshot()

  function buildSnapshot(): EngineSnapshot {
    const stagingView: Record<string, Record<string, ToolDecision>> = {}
    for (const [runId, decisions] of staging) {
      stagingView[runId] = Object.fromEntries(decisions)
    }
    return { machine, notice, store, thread, pendingMode, staging: stagingView }
  }

  function notify(): void {
    snapshot = buildSnapshot()
    for (const listener of listeners) {
      listener()
    }
  }

  function commitStore(next: ConversationStore): void {
    store = next
    deps.storage.write(next)
  }

  // 索引同步：标题（服务端 meta 优先，回退首条用户消息派生）+ 更新时间落盘。
  function syncActiveEntry(): void {
    if (!store) {
      return
    }
    const title = thread.meta?.title ?? conversationTitle(thread.messages)
    commitStore(touchActive(store, title, now()))
  }

  function clearReattachTimer(): void {
    if (reattachTimer !== null) {
      clearTimeout(reattachTimer)
      reattachTimer = null
    }
  }

  function closeStream(): void {
    streamGeneration += 1
    buffer = []
    handle?.close()
    handle = null
  }

  function openStream(sessionId: string, lastEventId: number): void {
    closeStream()
    const generation = streamGeneration
    handle = deps.client.openEvents({
      sessionId,
      // 0 = 无水位（全量），照常上送：服务端把 0 当续点等价于从头。
      lastEventId,
      onEvent: (event) => {
        if (disposed || generation !== streamGeneration) {
          return
        }
        buffer.push(event)
        if (!flushScheduled) {
          flushScheduled = true
          // 微任务窗口内的事件批量折叠一次（replay 洪峰不逐事件快照）。
          queueMicrotask(flush)
        }
      },
      onStreamError: (error) => {
        if (disposed || generation !== streamGeneration) {
          return
        }
        closeStream()
        clearReattachTimer()
        machine = transition(machine, { type: "FAIL", error: error.message })
        notify()
      },
    })
  }

  function flush(): void {
    flushScheduled = false
    if (disposed || buffer.length === 0) {
      buffer = []
      return
    }
    const events = buffer
    buffer = []

    thread = applySessionEvents(thread, events)

    let settledRunId: string | null = null
    for (const event of events) {
      const before = machine
      machine = transition(machine, {
        type: "STREAM_EVENT",
        runId: event.run_id,
        kind: event.kind,
      })
      if (before.phase !== "idle" && machine.phase === "idle") {
        settledRunId = event.run_id
      }
    }

    if (machine.phase === "awaiting-hitl") {
      // 进入待批帧即撤兜底计时：用户决策不设时限，不能被 TIMEOUT 收口成 idle。
      clearReattachTimer()
    }
    if (settledRunId !== null) {
      // 本轮终态收束：关流、清该 run 的决策暂存与幂等 id。
      staging.delete(settledRunId)
      resumeDecisionIds.delete(settledRunId)
      closeStream()
      clearReattachTimer()
    }
    syncActiveEntry()
    notify()
  }

  // 在途 run 的统一放弃路径：本地立即收口（结构化 cancelled），取消 POST 尽力而为。
  function abandonActiveRun(): void {
    const runId = machine.runId
    if (!runId || !store) {
      return
    }
    const sessionId = store.activeId
    closeStream()
    clearReattachTimer()
    staging.delete(runId)
    resumeDecisionIds.delete(runId)
    machine = transition(machine, { type: "RESET" })
    thread = markRunCancelled(thread, runId)
    syncActiveEntry()
    deps.client
      .sendControl(sessionId, runId, { kind: "run.cancel", decision_id: createId("dec") })
      .catch(() => {
        // 后端取消失败不回滚本地停止：终态收口与租约回收负责最终一致。
      })
  }

  // snapshot-first 水合：GET /sessions/:sid → 线程状态 + 在途 run 重连（Last-Event-ID=水位）。
  function hydrate(sessionId: string): void {
    hydrateGeneration += 1
    const generation = hydrateGeneration
    deps.client
      .fetchSnapshot(sessionId)
      .then((sessionSnapshot) => {
        if (disposed || generation !== hydrateGeneration || store?.activeId !== sessionId) {
          return
        }
        if (sessionSnapshot === null) {
          // 服务端无此会话（本地新建未开聊）：空线程即真态。
          return
        }
        thread = stateFromSnapshot(sessionSnapshot)
        syncActiveEntry()
        // 线程内容=事件史全量回放（水合 lastSeq=0）：历史过程/文本/审批帧全部重建，
        // 无在途 run 也开流（回放完即挂 live tail）。
        openStream(sessionId, thread.lastSeq)
        const plan = reattachPlanFromSnapshot(sessionSnapshot)
        if (plan) {
          const before = machine
          machine = transition(machine, {
            type: "REATTACH",
            runId: plan.runId,
            awaiting: plan.awaiting,
          })
          if (machine !== before) {
            clearReattachTimer()
            if (!plan.awaiting) {
              // 兜底窗口耗尽仍无终态：放弃续传，不永久卡在 streaming。待批帧不设时限。
              reattachTimer = setTimeout(() => {
                reattachTimer = null
                const timedOut = transition(machine, { type: "TIMEOUT" })
                if (timedOut === machine) {
                  return
                }
                machine = timedOut
                closeStream()
                notify()
              }, reattachTimeoutMs)
            }
          }
        }
        notify()
      })
      .catch((error: unknown) => {
        if (disposed || generation !== hydrateGeneration) {
          return
        }
        // fail-loud：水合失败进状态机错误态，不渲染半真半假的本地线程。
        machine = transition(machine, { type: "FAIL", error: describeUnknown(error) })
        notify()
      })
  }

  // 本地 echo 与事件史对齐：receipt 的 user_message_id 覆盖最后一条本地临时 id（usr_ 前缀）。
  // SSE 的 message.user 可能先于 receipt 到达并已吸收/新建同 id 条——此时本地 echo 是多余
  // 副本，删除而非改名（同 id 双条会撕裂 React key 唯一性）。
  function adoptUserMessageId(serverId: string): void {
    const index = thread.messages.findLastIndex(
      (m) => m.role === "user" && m.id.startsWith("usr_"),
    )
    const existing = index >= 0 ? thread.messages[index] : undefined
    if (existing === undefined) return
    const messages = [...thread.messages]
    if (messages.some((m) => m.id === serverId)) {
      messages.splice(index, 1)
    } else {
      messages[index] = { ...existing, id: serverId }
    }
    thread = { ...thread, messages }
  }

  // POST messages 并处理回执/失败（submit 与 retry 共用的开跑尾段）。
  function beginRun(sessionId: string, content: string, idempotencyKey: string): void {
    pendingSubmission = { content, idempotencyKey }
    deps.client
      .startRun(sessionId, { idempotency_key: idempotencyKey, content })
      .then((receipt) => {
        // 回执落地前用户已重置/切换：丢弃迟到回执，不复活旧轮。
        if (disposed || machine.phase !== "submitting" || store?.activeId !== sessionId) {
          return
        }
        pendingSubmission = null
        adoptUserMessageId(receipt.user_message_id)
        machine = transition(machine, { type: "RECEIPT", runId: receipt.run_id })
        openStream(sessionId, thread.lastSeq)
        notify()
      })
      .catch((error: unknown) => {
        if (disposed || machine.phase !== "submitting") {
          return
        }
        machine = transition(machine, { type: "FAIL", error: describeUnknown(error) })
        notify()
      })
  }

  function submit(content: string): void {
    const trimmed = content.trim()
    if (disposed || !trimmed) {
      return
    }
    notice = null
    if (
      store !== null &&
      (machine.phase === "streaming" ||
        machine.phase === "awaiting-hitl" ||
        machine.phase === "reattaching")
    ) {
      // 运行中插话：同端点再 POST（服务端识别活跃 run 转 run.steer）；
      // 不动状态机、不重开事件流——回执 run_id 即当前 run，无新可锚定物。
      thread = appendUserMessage(thread, { id: createId("usr"), content: trimmed })
      notify()
      deps.client
        .startRun(store.activeId, { idempotency_key: createId("idem"), content: trimmed })
        .then((receipt) => {
          if (!disposed) {
            adoptUserMessageId(receipt.user_message_id)
            notify()
          }
        })
        .catch((error: unknown) => {
          // 插话投递失败必须可见：瞬态通知（不打断相位），下次提交自动清。
          notice = `插话发送失败：${describeUnknown(error)}，请重试`
          notify()
        })
      return
    }
    const before = machine
    machine = transition(machine, { type: "SUBMIT" })
    if (machine === before) {
      // 同步双发守卫：submitting 相位（回执未归）的提交直接拒绝。
      return
    }
    if (!store) {
      store = addConversation(null, createId("conv"), now(), pendingMode)
    }
    thread = appendUserMessage(thread, { id: createId("usr"), content: trimmed })
    syncActiveEntry()
    notify()
    beginRun(store.activeId, trimmed, createId("idem"))
  }

  function retry(): void {
    if (disposed || !store) {
      return
    }
    const lastUser = [...thread.messages].reverse().find((message) => message.role === "user")
    if (!lastUser) {
      return
    }
    const before = machine
    machine = transition(machine, { type: "SUBMIT" })
    if (machine === before) {
      return
    }
    // 复位上一轮 run.failed 留下的终态标记；消息与历史步骤原样保留。
    if (thread.runStatus !== "idle") {
      thread = { ...thread, runStatus: "idle" }
    }
    notify()
    // 未获回执的同文重试复用 idempotency_key（服务端命中即重放 receipt，不造重复 run）；
    // 已回执后的失败重试换新 key（上一 run 已真实存在并失败）。
    const reuseKey =
      pendingSubmission !== null && pendingSubmission.content === lastUser.content
        ? pendingSubmission.idempotencyKey
        : createId("idem")
    beginRun(store.activeId, lastUser.content, reuseKey)
  }

  function stageToolDecision(runId: string, toolId: string, decision: ToolDecision): void {
    if (disposed || !store) {
      return
    }
    const sessionId = store.activeId
    const pendingIds = pendingToolIdsOf(thread.stepsByRun[runId] ?? [])
    const staged = stageDecision(staging.get(runId) ?? new Map(), toolId, decision)
    staging.set(runId, staged)
    notify()

    const decisions = buildResumeDecisions(staged, pendingIds)
    if (!decisions) {
      // 同帧仍有工具未决：等凑齐后统一提交一条 resume。
      return
    }
    // 同一帧的重试复用同一 decision_id：服务端据此幂等，双击/网络重试不会二次 resume。
    const decisionId = resumeDecisionIds.get(runId) ?? createId("dec")
    resumeDecisionIds.set(runId, decisionId)
    deps.client
      .sendControl(sessionId, runId, { kind: "run.resume", decision_id: decisionId, decisions })
      .then(() => {
        if (disposed) {
          return
        }
        machine = transition(machine, { type: "RESUME_SENT" })
        const rejected = rejectedToolIds(staged, pendingIds)
        if (rejected.length > 0) {
          thread = markToolRejected(thread, runId, rejected)
        }
        staging.delete(runId)
        resumeDecisionIds.delete(runId)
        notify()
      })
      .catch((error: unknown) => {
        if (disposed) {
          return
        }
        // 暂存保留可重试；仅记录错误，不离开 awaiting-hitl。
        machine = transition(machine, { type: "CONTROL_FAILED", error: describeUnknown(error) })
        notify()
      })
  }

  // 切换活跃会话的公共尾段：清流/清相位/清暂存，换空线程后按 snapshot 重新水合。
  function activateConversation(next: ConversationStore): void {
    closeStream()
    clearReattachTimer()
    machine = transition(machine, { type: "RESET" })
    staging.clear()
    resumeDecisionIds.clear()
    pendingSubmission = null
    thread = createSessionStreamState()
    commitStore(next)
    notify()
    hydrate(next.activeId)
  }

  function selectConversation(id: string): void {
    if (disposed || !store || id === store.activeId) {
      return
    }
    // 切换不取消在途 run：服务端 run 照跑，切回时 snapshot 精确续传。
    activateConversation(selectConversationOp(store, id))
  }

  function newConversation(): void {
    if (disposed) {
      return
    }
    abandonActiveRun()
    const next = addConversation(store, createId("conv"), now(), store ? "fast" : pendingMode)
    closeStream()
    clearReattachTimer()
    machine = transition(machine, { type: "RESET" })
    staging.clear()
    resumeDecisionIds.clear()
    pendingSubmission = null
    thread = createSessionStreamState()
    commitStore(next)
    notify()
    // 新会话本地新建、服务端必然不存在：不发无谓的 snapshot 请求。
  }

  function deleteConversation(id: string): void {
    if (disposed || !store) {
      return
    }
    if (id === store.activeId) {
      abandonActiveRun()
    }
    activateConversation(removeConversation(store, id, createId("conv"), now()))
  }

  function setMode(mode: AgentMode): void {
    if (disposed) {
      return
    }
    if (!store) {
      pendingMode = mode
      notify()
      return
    }
    // 已开聊即锁定：忽略切换。
    if (thread.messages.length > 0) {
      return
    }
    commitStore(setActiveMode(store, mode))
    notify()
  }

  function cancelRun(): void {
    if (disposed) {
      return
    }
    abandonActiveRun()
    notify()
  }

  function dispose(): void {
    disposed = true
    closeStream()
    clearReattachTimer()
    listeners.clear()
  }

  // 启动即水合：活跃会话从服务端 snapshot 恢复消息/在途 run/暂停点。
  if (store) {
    hydrate(store.activeId)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    submit,
    retry,
    cancelRun,
    stageToolDecision,
    selectConversation,
    newConversation,
    deleteConversation,
    setMode,
    dispose,
  }
}
