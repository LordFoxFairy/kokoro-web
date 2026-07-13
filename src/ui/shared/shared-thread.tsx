"use client"

// 公共只读线程（SHARE-1）：从公共快照重建线程状态，复用 ConversationThread 渲染件——
// 无输入框、无控制面、无 HITL、无重试。deliveries 公共下载面 V1 不做，故 sessionId 传 null
// 令成果区收起（不暴露不可用的鉴权下载按钮）；files 字节端点亦不开放公共面。

import { useRef } from "react"

import type { SessionSnapshot } from "@/contract/http"
import { createSessionStreamState, type SessionMessage, type SessionStreamState } from "@/core/state"
import { deliveryFromSnapshot } from "@/core/hydration"
import { ConversationThread } from "@/ui/thread/conversation-thread"

// 公共快照 → 只读线程状态：messages 直接投影（stepsByRun 空，assistant 文本由 projections
// 的防御性 text 步骤补齐渲染）；用户消息以自身 id 充当 runId，assistant 归其 run。
function stateFromPublicSnapshot(snapshot: SessionSnapshot): SessionStreamState {
  // M-6：SessionSnapshot.messages 转 optional（属主面省略）；分享面 session 保证必携，
  // 此处 ?? [] 仅作契约可选性的防御守卫（正常分享快照恒有 messages）。
  const messages: SessionMessage[] = (snapshot.messages ?? []).map((message) => ({
    id: message.message_id,
    role: message.role,
    content: message.content,
    runId: message.role === "user" ? message.message_id : (message.run_id ?? message.message_id),
  }))
  return {
    ...createSessionStreamState(),
    messages,
    files: snapshot.files,
    deliveries: snapshot.deliveries.map(deliveryFromSnapshot),
    meta: { title: snapshot.session.title, ownerId: snapshot.session.owner_id },
  }
}

const NO_STAGING: Record<string, Record<string, never>> = {}

export function SharedThread({ snapshot }: { snapshot: SessionSnapshot }) {
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const thread = stateFromPublicSnapshot(snapshot)
  return (
    <ConversationThread
      // sessionId=null：成果/文件下载面不开放公共读，DeliverySection 据此收起。
      sessionId={null}
      thread={thread}
      isStreaming={false}
      isReconnecting={false}
      hasFailed={false}
      creditRejected={false}
      onOpenBilling={() => {}}
      onOpenPricing={() => {}}
      onRetry={() => {}}
      onScroll={() => {}}
      threadEndRef={threadEndRef}
      mode="fast"
      stagingByRun={NO_STAGING}
      hitlRunId={null}
      controlError={null}
    />
  )
}
