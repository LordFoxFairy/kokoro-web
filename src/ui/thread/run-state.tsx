import { useT } from "@/i18n/context"
import { BanCircleIcon, CheckCircleIcon } from "@/ui/icons/thread"

import styles from "./thread.module.css"

// 运行态指示：失败警示点 / 待批琥珀点 / 已拒绝或未执行禁止圈 / 完成对勾 / 进行中转圈。工具/子智能体共用。
export function RunState({
  done,
  failed = false,
  awaiting = false,
  rejected = false,
}: {
  done: boolean
  failed?: boolean
  awaiting?: boolean
  rejected?: boolean
}) {
  const t = useT()
  if (failed) {
    return <span className={`${styles.actstate} ${styles.actstateError}`} />
  }
  if (rejected) {
    // 拒绝/收口未执行：禁止圈（与完成态显著区分），表示该调用没有产出结果。
    return <BanCircleIcon className={`${styles.actstate} ${styles.actstateRejected}`} />
  }
  if (awaiting) {
    // 待批：与「进行中」转圈区分——静止的琥珀等待点，提示需要人来决定。
    return (
      <span
        className={`${styles.actstate} ${styles.actstateAwaiting}`}
        aria-label={t("hitl.awaitingApproval")}
      />
    )
  }
  return done ? (
    <CheckCircleIcon className={`${styles.actstate} ${styles.actstateDone}`} />
  ) : (
    <span className={styles.spinner} />
  )
}
