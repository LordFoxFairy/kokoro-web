import { CheckCircleIcon } from "../icons"

// 运行态指示：失败显示警示点，完成显示对勾，进行中显示 CSS 转圈。工具/子智能体共用。
export function RunState({
  done,
  failed = false,
}: {
  done: boolean
  failed?: boolean
}) {
  if (failed) {
    return <span className="kk-actstate kk-actstate--error" />
  }
  return done ? (
    <CheckCircleIcon className="kk-actstate kk-actstate--done" />
  ) : (
    <span className="kk-spinner" />
  )
}
