import type { SessionSubagent } from "@/core/state"
import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"
import { ChevronIcon, RobotIcon } from "@/ui/icons/thread"

import { MarkdownMessage } from "./markdown-message"
import { RunState } from "./run-state"
import styles from "./thread.module.css"

const SOURCE_LABEL: Record<SessionSubagent["source"], MessageKey> = {
  "built-in": "subagent.builtin",
  "config-custom": "subagent.configCustom",
  "runtime-custom": "subagent.runtimeCustom",
}

// 子智能体头部：机器人图标 + 名称 + 来源胶囊（短标签）+ 运行态。
// 抽出来让「可展开」与「不可展开」两种形态共用同一行视觉。
function SubagentHead({ subagent }: { subagent: SessionSubagent }) {
  const t = useT()
  return (
    <>
      <RobotIcon className={styles.subagentIcon} />
      <span className={styles.subagentText}>
        <span className={styles.subagentName}>{subagent.name}</span>
        <span className={styles.subagentChip}>
          {t(SOURCE_LABEL[subagent.source])} · {subagent.subagentType}
        </span>
      </span>
      <span className={styles.subagentState} aria-hidden>
        <RunState done={subagent.status === "done"} failed={subagent.status === "failed"} />
      </span>
    </>
  )
}

// 单个子智能体：有结论（output）时是可展开的嵌套面板（结构对齐 ToolCallRow 的 <details>），
// 结论用 Markdown 完整换行呈现于左侧细线面板；职责描述常驻行内可见；
// 无结论时退化为不可展开的简单行（无死切换）。
export function SubagentRow({ subagent }: { subagent: SessionSubagent }) {
  const t = useT()
  const running = subagent.status === "running"
  const description = subagent.description ? (
    <p className={styles.subagentDesc}>{subagent.description}</p>
  ) : null

  // 落定且无结论 → 简单静态行（无死切换）。运行中即便结论未到，也展开给「运行中…」loading，
  // 而不是塌成空行——让「在干活、结论还没回来」可见。
  if (!subagent.output && !running) {
    return (
      <div className={styles.subagent} data-source={subagent.source}>
        <div className={`${styles.subagentSummary} ${styles.subagentSummaryStatic}`}>
          <SubagentHead subagent={subagent} />
        </div>
        {description}
        {subagent.error ? (
          <p className={styles.toolError} role="status">
            {subagent.error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <details className={styles.subagent} data-source={subagent.source} open={running}>
      <summary className={styles.subagentSummary}>
        <SubagentHead subagent={subagent} />
        {/* chevron 提示「可展开」，与工具行/过程块一致；静态行无 chevron。 */}
        <ChevronIcon className={styles.subagentChevron} />
      </summary>
      <div className={styles.subagentDetail}>
        {description}
        <div className={styles.subagentResult}>
          {subagent.output ? (
            <MarkdownMessage content={subagent.output} />
          ) : (
            <p className={styles.pending}>
              {t("thread.running")}
              <span className={styles.pulse} aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </p>
          )}
        </div>
      </div>
    </details>
  )
}
