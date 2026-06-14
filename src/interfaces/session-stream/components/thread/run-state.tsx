import { BanCircleIcon, CheckCircleIcon } from "../icons"

// 运行态指示：失败警示点 / 待批琥珀点 / 已拒绝禁止圈 / 完成对勾 / 进行中转圈。工具/子智能体共用。
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
  if (failed) {
    return <span className="kk-actstate kk-actstate--error" />
  }
  if (rejected) {
    // 已拒绝：禁止圈（与绿勾 done 显著区分），表示用户驳回了该调用、工具未执行。
    return (
      <BanCircleIcon className="kk-actstate kk-actstate--rejected" />
    )
  }
  if (awaiting) {
    // 待批：与「进行中」转圈区分——静止的琥珀等待点,提示需要人来决定。
    return <span className="kk-actstate kk-actstate--awaiting" aria-label="等待批准" />
  }
  return done ? (
    <CheckCircleIcon className="kk-actstate kk-actstate--done" />
  ) : (
    <span className="kk-spinner" />
  )
}
