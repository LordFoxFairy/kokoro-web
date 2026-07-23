// 事件/快照工厂：经契约 parse 构造，天然验证与 wire 同形（零类型断言）。

import { parseSessionSnapshot, type SessionSnapshot } from "@/contract/http"
import { parseSessionEvent, type SessionEvent } from "@/contract/session-events"

type PayloadOf<K extends SessionEvent["kind"]> = Extract<SessionEvent, { kind: K }>["payload"]

export type EnvelopeOverrides = Partial<{
  event_id: string
  seq: number
  run_id: string
  session_id: string
  timestamp: string
}>

let autoSeq = 0

export function resetFixtureSeq(): void {
  autoSeq = 0
}

export function makeEvent<K extends SessionEvent["kind"]>(
  kind: K,
  payload: PayloadOf<K>,
  overrides: EnvelopeOverrides = {},
): SessionEvent {
  const seq = overrides.seq ?? (autoSeq += 1)
  return parseSessionEvent({
    kind,
    payload,
    event_id: overrides.event_id ?? `evt_${kind}_${seq}`,
    seq,
    session_id: overrides.session_id ?? "ses_1",
    run_id: overrides.run_id ?? "run_1",
    timestamp: overrides.timestamp ?? "2026-07-02T00:00:00Z",
  })
}

export function awaitingPayload(
  toolId: string,
  pendingToolIds: string[],
  overrides: Partial<PayloadOf<"tool.awaiting_approval">> = {},
): PayloadOf<"tool.awaiting_approval"> {
  return {
    segment_id: "seg_1",
    tool_id: toolId,
    name: "write_file",
    args: { path: "/tmp/a" },
    description: "write a file",
    allowed_decisions: ["approve", "reject"],
    kind: "tool_approval",
    editable: false,
    pending_tool_ids: pendingToolIds,
    ...overrides,
  }
}

type SnapshotInput = {
  sessionId?: string
  title?: string
  messages?: SessionSnapshot["messages"]
  activeRun?: SessionSnapshot["active_run"]
  pendingPauses?: SessionSnapshot["pending_pauses"]
  files?: SessionSnapshot["files"]
  deliveries?: SessionSnapshot["deliveries"]
  eventWatermark?: number
}

export function makeSnapshot(input: SnapshotInput = {}): SessionSnapshot {
  return parseSessionSnapshot({
    session: {
      session_id: input.sessionId ?? "conv_1",
      title: input.title ?? "server title",
      owner_id: "local-user",
      created_at: "2026-07-02T00:00:00Z",
      updated_at: "2026-07-02T00:00:01Z",
    },
    messages: input.messages ?? [],
    ...(input.activeRun !== undefined ? { active_run: input.activeRun } : {}),
    pending_pauses: input.pendingPauses ?? [],
    files: input.files ?? [],
    deliveries: input.deliveries ?? [],
    event_watermark: input.eventWatermark ?? 0,
  })
}

export function makeSnapshotDelivery(
  overrides: Partial<SessionSnapshot["deliveries"][number]> = {},
): SessionSnapshot["deliveries"][number] {
  return {
    content_hash: "hash_1",
    path: "out/report.md",
    title: "调研报告",
    mime: "text/markdown",
    size: 2048,
    run_id: "run_1",
    created_at: "2026-07-02T00:00:02Z",
    ...overrides,
  }
}

export function makePendingPause(
  overrides: Partial<SessionSnapshot["pending_pauses"][number]> = {},
): SessionSnapshot["pending_pauses"][number] {
  return {
    pause_id: "pause_1",
    run_id: "run_1",
    tool_id: "tool_1",
    segment_id: "seg_1",
    tool_name: "write_file",
    kind: "tool_approval",
    args: { path: "/tmp/a" },
    description: "write a file",
    allowed_decisions: ["approve", "reject"],
    editable: false,
    status: "pending",
    created_at: "2026-07-02T00:00:00Z",
    ...overrides,
  }
}
