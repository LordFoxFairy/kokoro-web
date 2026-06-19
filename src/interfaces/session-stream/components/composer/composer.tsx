import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react"

import type { AgentMode } from "@/application/conversation-store"

import type { PermissionMode } from "../../hooks/use-conversation"
import { MAX_INPUT_LENGTH, resizeComposer } from "./composer-input"
import { ComposerMenu } from "./composer-menu"
import { ExpandDialog } from "./expand-dialog"
import {
  MODE_LABEL,
  MODE_OPTIONS,
  PERMISSION_LABEL,
  PERMISSION_OPTIONS,
  isAgentMode,
  isPermissionMode,
} from "./mode-options"
import {
  ChevronIcon,
  ExpandIcon,
  LockIcon,
  MicIcon,
  PlusIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
  ZapIcon,
} from "../icons"

type ComposerProps = {
  draft: string
  onDraftChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  isStreaming: boolean
  canSend: boolean
  onStop: () => void
  transportLabel: string
  modeHint?: string
  composerRef: RefObject<HTMLTextAreaElement | null>
  // 回应模式：受控于会话。modeLocked 时（已开聊）只读展示、不可切换。
  mode: AgentMode
  onModeChange: (mode: AgentMode) => void
  modeLocked: boolean
  // 权限档位：会话级，随时可切（不锁定），作用于下一轮 run。
  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void
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
  permissionMode,
  onPermissionModeChange,
}: ComposerProps) {
  const modeLabel = MODE_LABEL[mode]
  const ModeIcon = mode === "thinking" ? SparkIcon : ZapIcon
  const permissionLabel = PERMISSION_LABEL[permissionMode]

  // 放大编辑：把同一份草稿摊进一个大编辑面板，方便长文撰写/修改（对齐 Gemini 的展开输入）。
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
    <div className="kk-shell__composer-wrap">
      <form className="kk-composer" aria-label="消息编辑区" onSubmit={onSubmit}>
        <textarea
          ref={composerRef}
          className="kk-composer__input"
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
            className="kk-composer__expand"
            aria-label="放大编辑"
            onClick={() => setExpanded(true)}
          >
            <ExpandIcon className="kk-composer__expand-glyph" />
          </button>
        ) : null}

        {/* 控件行：附加键在左，模式/语音/发送在右——文本独占上行向上生长。 */}
        <div className="kk-composer__controls">
          <div className="kk-composer__cluster">
            {/* 附件上传尚未接入：停用入口并以 title 标注，避免点击无反馈的误导。 */}
            <button
              type="button"
              className="kk-composer__add"
              aria-label="附加内容"
              title="附件功能即将支持"
              disabled
            >
              <PlusIcon className="kk-composer__glyph" />
            </button>
          </div>

          <div className="kk-composer__cluster">
            {modeLocked ? (
              <button
                type="button"
                className="kk-composer__mode kk-composer__mode--locked"
                disabled
                aria-label={`回应模式：${modeLabel}（本轮已锁定）`}
                title="模式选定后本轮不可切换；新对话可重新选择"
              >
                <ModeIcon className="kk-composer__mode-glyph" />
                <span>{modeLabel}</span>
                <LockIcon className="kk-composer__lock" />
              </button>
            ) : (
              <ComposerMenu
                triggerClassName="kk-composer__mode"
                triggerLabel="切换模式"
                trigger={
                  <>
                    <ModeIcon className="kk-composer__mode-glyph" />
                    <span>{modeLabel}</span>
                    <ChevronIcon className="kk-composer__chevron" />
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

            <ComposerMenu
              triggerClassName="kk-composer__mode"
              triggerLabel="切换权限模式"
              trigger={
                <>
                  <LockIcon className="kk-composer__mode-glyph" />
                  <span>{permissionLabel}</span>
                  <ChevronIcon className="kk-composer__chevron" />
                </>
              }
              options={PERMISSION_OPTIONS}
              selectedKey={permissionMode}
              onSelect={(key) => {
                if (isPermissionMode(key)) {
                  onPermissionModeChange(key)
                }
              }}
              align="end"
            />

            {/* 语音输入尚未接入：停用并标注，与附件入口一致地消除误导 affordance。 */}
            <button
              className="kk-composer__mic"
              type="button"
              aria-label="语音输入"
              title="语音输入即将支持"
              disabled
            >
              <MicIcon className="kk-composer__glyph" />
            </button>

            {isStreaming ? (
              <button
                className="kk-composer__send kk-composer__send--stop"
                type="button"
                aria-label="停止生成"
                onClick={onStop}
              >
                <StopIcon className="kk-composer__glyph" />
              </button>
            ) : (
              <button
                className="kk-composer__send"
                type="submit"
                aria-label="发送消息"
                disabled={!canSend}
              >
                <SendIcon className="kk-composer__glyph" />
              </button>
            )}
          </div>
        </div>
      </form>

      {/* 常驻保留高度：标签延后出现也不改变 composer 位置，避免聊天框跳动。 */}
      <p className="kk-shell__transport">
        <span>{transportLabel}</span>
        <span aria-hidden> · </span>
        <span>{modeHint}</span>
      </p>

      {expanded ? (
        <ExpandDialog
          draft={draft}
          onDraftChange={onDraftChange}
          canSend={canSend}
          onSubmit={submitFromExpand}
          onClose={closeExpand}
        />
      ) : null}
    </div>
  )
}
