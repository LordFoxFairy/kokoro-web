// 待批注册表（HITL-NOTIFY）：跨会话待批可见性的客户端真源。
//
// 单活跃流架构下只有「当前打开会话」在推 SSE；本注册表记住「本次浏览器会话内曾进入待批」的会话，
// 切走后徽标仍在、切回并解决后清除。喂养来自活跃流：活跃会话 phase===awaiting-hitl 即登记、离开即销账
// （见 SessionShell 的同步 effect）。未打开过的会话的列表级待批需后端字段，V1 不覆盖（见子 spec）。

let awaitingIds: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeAwaiting(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

// useSyncExternalStore 快照：不可变整体，变更即换引用（无变更保持同引用，避免无谓重渲染）。
export function readAwaiting(): ReadonlySet<string> {
  return awaitingIds
}

const EMPTY: ReadonlySet<string> = new Set()

// SSR 快照：恒空且引用稳定（服务端无待批意图）。
export function serverAwaiting(): ReadonlySet<string> {
  return EMPTY
}

// 登记/销账一个会话的待批态；幂等（无变更不换引用、不通知）。
export function setAwaiting(sessionId: string, awaiting: boolean): void {
  const has = awaitingIds.has(sessionId)
  if (awaiting === has) {
    return
  }
  const next = new Set(awaitingIds)
  if (awaiting) {
    next.add(sessionId)
  } else {
    next.delete(sessionId)
  }
  awaitingIds = next
  emit()
}
