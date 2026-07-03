import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react"

import type { AgentMode } from "@/core/conversations"
import { ChevronIcon, SparkIcon } from "@/ui/icons/thread"
import { PlusIcon } from "@/ui/icons/rail"
import {
  ExpandIcon,
  LockIcon,
  MicIcon,
  SendIcon,
  StopIcon,
  ZapIcon,
} from "@/ui/icons/composer"

import { ComposerMenu } from "./composer-menu"
import { ExpandDialog } from "./expand-dialog"
import { MODE_LABEL, MODE_OPTIONS, isAgentMode } from "./mode-options"
import styles from "./composer.module.css"

// 输入上限：textarea maxLength 与提交守卫双重把关。
export const MAX_INPUT_LENGTH = 4000

// 自适应高度：归零再贴合 scrollHeight（CSS max-height 硬顶）；jsdom 下 scrollHeight 恒 0 仍不抛错。
export function resizeComposer(node: HTMLTextAreaElement) {
  node.style.height = "auto"
  node.style.height = `${node.scrollHeight}px`
}

type ComposerProps = {
  draft: string
  onDraftChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  isStreaming: boolean
  canSend: boolean
  onStop: () => void
  transportLabel: string
  modeHint: string
  composerRef: RefObject<HTMLTextAreaElement | null>
  // 回应模式：受控于会话。modeLocked 时（已开聊）只读展示、不可切换。
  mode: AgentMode
  onModeChange: (mode: AgentMode) => void
  modeLocked: boolean
}

export function Composer({
  draft,
  onDraftChange,
  onKeyDown,
  onSubmit,
  isStreaming,
  canSend,
  onStop,
  transportLabel,
  modeHint,
  composerRef,
  mode,
  onModeChange,
  modeLocked,
}: ComposerProps) {
  const modeLabel = MODE_LABEL[mode]
  const ModeIcon = mode === "thinking" ? SparkIcon : ZapIcon

  // 放大编辑：把同一份草稿摊进一个大编辑面板，方便长文撰写/修改。
  const [expanded, setExpanded] = useState(false)

  const closeExpand = () => {
    setExpanded(false)
    composerRef.current?.focus()
  }

  // 放大编辑里的提交复用 composer 的表单提交，发送后收起面板。
  const submitFromExpand = (event: FormEvent<HTMLFormElement>) => {
    onSubmit(event)
    setExpanded(false)
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.composer} aria-label="消息编辑区" onSubmit={onSubmit}>
        <textarea
          ref={composerRef}
          className={styles.input}
          aria-label="对话输入"
          placeholder="把想说的告诉我。"
          rows={1}
          maxLength={MAX_INPUT_LENGTH}
          value={draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            onDraftChange(event.target.value)
            resizeComposer(event.currentTarget)
          }}
          onKeyDown={onKeyDown}
          disabled={isStreaming}
        />

        {/* 放大编辑入口：贴在输入框右上角；流式中输入框停用，故一并隐藏。 */}
        {!isStreaming ? (
          <button
            type="button"
            className={styles.expandToggle}
            aria-label="放大编辑"
            onClick={() => setExpanded(true)}
          >
            <ExpandIcon className={styles.expandGlyph} />
          </button>
        ) : null}

        {/* 控件行：附加键在左，模式/语音/发送在右——文本独占上行向上生长。 */}
        <div className={styles.controls}>
          <div className={styles.cluster}>
            {/* 附件上传尚未接入：停用入口并以 title 标注，避免点击无反馈的误导。 */}
            <button
              type="button"
              className={styles.add}
              aria-label="附加内容"
              title="附件功能即将支持"
              disabled
            >
              <PlusIcon className={styles.glyph} />
            </button>
          </div>

          <div className={styles.cluster}>
            {modeLocked ? (
              <button
                type="button"
                className={`${styles.mode} ${styles.modeLocked}`}
                disabled
                aria-label={`回应模式：${modeLabel}（本轮已锁定）`}
                title="模式选定后本轮不可切换；新对话可重新选择"
              >
                <ModeIcon className={styles.modeGlyph} />
                <span>{modeLabel}</span>
                <LockIcon className={styles.lock} />
              </button>
            ) : (
              <ComposerMenu
                triggerClassName={styles.mode}
                triggerLabel="切换模式"
                trigger={
                  <>
                    <ModeIcon className={styles.modeGlyph} />
                    <span>{modeLabel}</span>
                    <ChevronIcon className={styles.chevron} />
                  </>
                }
                options={MODE_OPTIONS}
                selectedKey={mode}
                onSelect={(key) => {
                  if (isAgentMode(key)) {
                    onModeChange(key)
                  }
                }}
                align="end"
              />
            )}

            {/* 语音输入尚未接入：停用并标注，与附件入口一致地消除误导 affordance。 */}
            <button
              className={styles.mic}
              type="button"
              aria-label="语音输入"
              title="语音输入即将支持"
              disabled
            >
              <MicIcon className={styles.glyph} />
            </button>

            {isStreaming ? (
              <button
                className={`${styles.send} ${styles.sendStop}`}
                type="button"
                aria-label="停止生成"
                onClick={onStop}
              >
                <StopIcon className={styles.glyph} />
              </button>
            ) : (
              <button
                className={styles.send}
                type="submit"
                aria-label="发送消息"
                disabled={!canSend}
              >
                <SendIcon className={styles.glyph} />
              </button>
            )}
          </div>
        </div>
      </form>

      {/* 常驻保留高度：标签延后出现也不改变 composer 位置，避免聊天框跳动。 */}
      <p className={styles.transport}>
        <span>{transportLabel}</span>
        <span aria-hidden> · </span>
        <span>{modeHint}</span>
      </p>

      {expanded ? (
        <ExpandDialog
          draft={draft}
          onDraftChange={onDraftChange}
          canSend={canSend}
          maxLength={MAX_INPUT_LENGTH}
          onSubmit={submitFromExpand}
          onClose={closeExpand}
        />
      ) : null}
    </div>
  )
}
