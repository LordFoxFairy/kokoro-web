// snapshot 水合：只供 meta/files/deliveries/重连判定——线程内容由事件史全量回放重建（唯一完整真源）。

import type { Delivery, SessionSnapshot } from "@/contract/http"
import {
  createSessionStreamState,
  type SessionDelivery,
  type SessionStreamState,
} from "./state"

// snake→camel 的成果投影：live 事件与 snapshot 双源共用同一领域形状。
export function deliveryFromSnapshot(delivery: Delivery): SessionDelivery {
  return {
    contentHash: delivery.content_hash,
    path: delivery.path,
    title: delivery.title,
    mime: delivery.mime,
    size: delivery.size,
    createdAt: delivery.created_at,
  }
}

export function stateFromSnapshot(snapshot: SessionSnapshot): SessionStreamState {
  return {
    ...createSessionStreamState(),
    // run 锚点与终态清空语义依赖 activeRunId（状态而非线程内容）：水合保留。
    activeRunId: snapshot.active_run?.run_id ?? null,
    files: snapshot.files,
    deliveries: snapshot.deliveries.map(deliveryFromSnapshot),
    meta: {
      title: snapshot.session.title,
      ownerId: snapshot.session.owner_id,
    },
  }
}
