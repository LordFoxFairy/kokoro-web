// snapshot 水合：只供 meta/files/重连判定——线程内容由事件史全量回放重建（唯一完整真源）。

import type { SessionSnapshot } from "@/contract/http"
import { createSessionStreamState, type SessionStreamState } from "./state"

export function stateFromSnapshot(snapshot: SessionSnapshot): SessionStreamState {
  return {
    ...createSessionStreamState(),
    // run 锚点与终态清空语义依赖 activeRunId（状态而非线程内容）：水合保留。
    activeRunId: snapshot.active_run?.run_id ?? null,
    files: snapshot.files,
    meta: {
      title: snapshot.session.title,
      ownerId: snapshot.session.owner_id,
    },
  }
}
