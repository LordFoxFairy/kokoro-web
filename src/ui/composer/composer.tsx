import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react"

import type { AgentMode } from "@/core/conversations"
import type { ModelCandidate } from "@/contract/http"
import { useT } from "@/i18n/context"
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
import { MODE_LABEL, isAgentMode, modeOptions } from "./mode-options"
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
  // 固定技能（WEB-SKILLS）：随消息上 wire 为 pinned_skills；chip 可就地取消固定。
  pinnedSkills: readonly string[]
  onUnpinSkill: (name: string) => void
  // 模型候选（MODEL-UX）：空则不渲染选择器；selectedModel=null 时高亮缺省项。
  // 选择随首条消息定死（modelLocked=已开聊）：锁定态只读展示当前模型。
  models: readonly ModelCandidate[]
  selectedModel: string | null
  onModelChange: (selector: string) => void
  modelLocked: boolean
}

// wire 选择子：与 session resolveRuntime 的 "provider:name" 规约一致。
function modelSelector(model: ModelCandidate): string {
  return `${model.provider}:${model.name}`
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
  pinnedSkills,
  onUnpinSkill,
  models,
  selectedModel,
  onModelChange,
  modelLocked,
}: ComposerProps) {
  const t = useT()
  const modeLabel = MODE_LABEL[mode]
  const ModeIcon = mode === "thinking" ? SparkIcon : ZapIcon

  // 当前选中模型：selectedModel 命中候选则用之，否则回落缺省项（is_default）。空候选=不渲染选择器。
  const defaultModel = models.find((m) => m.is_default) ?? models[0]
  const currentSelector = selectedModel ?? (defaultModel ? modelSelector(defaultModel) : undefined)
  const currentModel = models.find((m) => modelSelector(m) === currentSelector) ?? defaultModel

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
      {pinnedSkills.length > 0 ? (
        <div className={styles.pinnedRow} aria-label={t("composer.pinnedAria")}>
          {pinnedSkills.map((name) => (
            <span key={name} className={styles.pinnedChip}>
              <span className={styles.pinnedName}>{name}</span>
              <button
                type="button"
                className={styles.pinnedRemove}
                aria-label={t("composer.pinnedRemove", { name })}
                onClick={() => onUnpinSkill(name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <form className={styles.composer} aria-label={t("composer.editArea")} onSubmit={onSubmit}>
        <textarea
          ref={composerRef}
          className={styles.input}
          aria-label={t("composer.inputAria")}
          placeholder={t("composer.placeholder")}
          rows={1}
          maxLength={MAX_INPUT_LENGTH}
          value={draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            onDraftChange(event.target.value)
            resizeComposer(event.currentTarget)
          }}
          onKeyDown={onKeyDown}
        />

        {/* 放大编辑入口：贴在输入框右上角。 */}
        <button
          type="button"
          className={styles.expandToggle}
          aria-label={t("composer.expandAria")}
          onClick={() => setExpanded(true)}
        >
          <ExpandIcon className={styles.expandGlyph} />
        </button>

        {/* 控件行：附加键在左，模式/语音/发送在右——文本独占上行向上生长。 */}
        <div className={styles.controls}>
          <div className={styles.cluster}>
            {/* 附件上传尚未接入：停用入口并以 title 标注，避免点击无反馈的误导。 */}
            <button
              type="button"
              className={styles.add}
              aria-label={t("composer.attachAria")}
              title={t("composer.attachSoon")}
              disabled
            >
              <PlusIcon className={styles.glyph} />
            </button>
          </div>

          <div className={styles.cluster}>
            {/* 模型选择器（MODEL-UX）：候选来自 platform 单源；首条消息后锁定为只读展示。空候选=不渲染。 */}
            {models.length > 0 && currentModel ? (
              modelLocked ? (
                <button
                  type="button"
                  className={`${styles.mode} ${styles.modeLocked}`}
                  disabled
                  aria-label={t("composer.modelLocked", { model: currentModel.name })}
                  title={t("composer.modelLockedTitle")}
                >
                  <span>{currentModel.name}</span>
                  <LockIcon className={styles.lock} />
                </button>
              ) : (
                <ComposerMenu
                  triggerClassName={styles.mode}
                  triggerLabel={t("composer.modelSwitch")}
                  trigger={
                    <>
                      <span>{currentModel.name}</span>
                      <ChevronIcon className={styles.chevron} />
                    </>
                  }
                  options={models.map((m) => ({ key: modelSelector(m), label: m.name }))}
                  selectedKey={currentSelector}
                  onSelect={onModelChange}
                  align="end"
                />
              )
            ) : null}

            {modeLocked ? (
              <button
                type="button"
                className={`${styles.mode} ${styles.modeLocked}`}
                disabled
                aria-label={t("composer.modeLocked", { mode: modeLabel })}
                title={t("composer.modeLockedTitle")}
              >
                <ModeIcon className={styles.modeGlyph} />
                <span>{modeLabel}</span>
                <LockIcon className={styles.lock} />
              </button>
            ) : (
              <ComposerMenu
                triggerClassName={styles.mode}
                triggerLabel={t("composer.modeSwitch")}
                trigger={
                  <>
                    <ModeIcon className={styles.modeGlyph} />
                    <span>{modeLabel}</span>
                    <ChevronIcon className={styles.chevron} />
                  </>
                }
                options={modeOptions(t)}
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
              aria-label={t("composer.voiceAria")}
              title={t("composer.voiceSoon")}
              disabled
            >
              <MicIcon className={styles.glyph} />
            </button>

            {/* 流式中输入保持可用（运行中插话）：草稿非空=发送插话，草稿空=停止生成。 */}
            {isStreaming && !canSend ? (
              <button
                className={`${styles.send} ${styles.sendStop}`}
                type="button"
                aria-label={t("composer.stop")}
                onClick={onStop}
              >
                <StopIcon className={styles.glyph} />
              </button>
            ) : (
              <button
                className={styles.send}
                type="submit"
                aria-label={isStreaming ? t("composer.sendSteer") : t("composer.send")}
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
