import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

import type { AgentMode } from "@/application/conversation-store"

import type { PermissionMode } from "../../hooks/use-conversation"
import { MAX_INPUT_LENGTH, resizeComposer } from "./composer-input"
import {
  ComposerMenu,
  type MenuOption,
  type MenuSection,
} from "./composer-menu"
import {
  ChevronIcon,
  CollapseIcon,
  ExpandIcon,
  LockIcon,
  MicIcon,
  PlusIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
  ZapIcon,
} from "../icons"

// 附加菜单：图标 + 分组，样式对齐原型 variant-a-mi-mu 的 attach 菜单。
// 语音输入仍走右侧独立麦克风键，避免重复；上传链路接后端前为占位项。
const ATTACH_SECTIONS: MenuSection[] = [
  {
    label: "从这里加点什么",
    items: [
      {
        key: "image",
        label: "上传图片",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <circle cx="6" cy="7" r="1.2" />
            <path d="M3 12l3.5-3 2.5 2 2-1.5 2 2" />
          </svg>
        ),
      },
      {
        key: "file",
        label: "上传文件",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 2h5l3 3v9H4z" />
            <path d="M9 2v3h3" />
          </svg>
        ),
      },
      {
        key: "camera",
        label: "拍照",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 5h3l1-1.5h4L11 5h3v8H2z" />
            <circle cx="8" cy="9" r="2.5" />
          </svg>
        ),
      },
    ],
  },
]

// 模式：Fast（闪电·更快）/ Thinking（火花·更深思考）下拉单选。接入 run 的 execution_style 后生效。
const MODE_OPTIONS: MenuOption[] = [
  {
    key: "fast",
    label: "Fast",
    hint: "更快回应",
    icon: <ZapIcon className="kk-composer__mode-glyph" />,
  },
  {
    key: "thinking",
    label: "Thinking",
    hint: "更深的思考",
    icon: <SparkIcon className="kk-composer__mode-glyph" />,
  },
]

const MODE_LABEL: Record<AgentMode, string> = {
  fast: "Fast",
  thinking: "Thinking",
}

// 权限档位（Claude-Code 式，会话级）：auto 全放行 / default 拦外部副作用 / plan 只读规划。
const PERMISSION_OPTIONS: MenuOption[] = [
  { key: "auto", label: "Auto", hint: "全自动，放行所有工具" },
  { key: "default", label: "Default", hint: "拦外部副作用工具" },
  { key: "plan", label: "Plan", hint: "只读规划，不执行工具" },
]

const PERMISSION_LABEL: Record<PermissionMode, string> = {
  auto: "Auto",
  default: "Default",
  plan: "Plan",
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
  const expandedRef = useRef<HTMLTextAreaElement | null>(null)

  // 打开时聚焦大编辑框并把光标移到末尾，直接续写。
  useEffect(() => {
    if (!expanded) {
      return
    }
    const node = expandedRef.current
    if (!node) {
      return
    }
    node.focus()
    const end = node.value.length
    node.setSelectionRange(end, end)
  }, [expanded])

  const closeExpand = () => {
    setExpanded(false)
    composerRef.current?.focus()
  }

  // 放大编辑里的提交复用 composer 的表单提交，发送后收起面板。
  const submitFromExpand = (event: FormEvent<HTMLFormElement>) => {
    onSubmit(event)
    setExpanded(false)
  }

  // 放大编辑是长文场景：Enter 换行；⌘/Ctrl+Enter 才发送；Esc 收起。
  // 与内联输入框（Enter 直接发送）不同，因为大面板的本意就是从容地写多行。
  const keyDownInExpand = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeExpand()
      return
    }
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
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
            <ComposerMenu
              triggerClassName="kk-composer__add"
              triggerLabel="附加内容"
              trigger={<PlusIcon className="kk-composer__glyph" />}
              sections={ATTACH_SECTIONS}
              onSelect={() => {
                // 占位：上传链路接入后在此处理所选来源。
              }}
            />
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
                onSelect={(key) => onModeChange(key as AgentMode)}
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
              onSelect={(key) => onPermissionModeChange(key as PermissionMode)}
              align="end"
            />

            <button
              className="kk-composer__mic"
              type="button"
              aria-label="语音输入"
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

      {/* 放大编辑面板：portal 到 body，position:fixed 覆盖全屏，不受 composer 盒模型/层叠影响。
          点击遮罩空白处 / Esc / 收起键关闭；长文场景下 Enter 换行、⌘/Ctrl+Enter 发送。 */}
      {expanded
        ? createPortal(
            <div
              className="kk-expand__backdrop"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeExpand()
                }
              }}
            >
              <form
                className="kk-expand"
                role="dialog"
                aria-modal="true"
                aria-label="放大编辑"
                onSubmit={submitFromExpand}
              >
                <div className="kk-expand__head">
                  <span className="kk-expand__title">放大编辑</span>
                  <button
                    type="button"
                    className="kk-expand__collapse"
                    aria-label="收起放大编辑"
                    onClick={closeExpand}
                  >
                    <CollapseIcon className="kk-composer__expand-glyph" />
                  </button>
                </div>

                <textarea
                  ref={expandedRef}
                  className="kk-expand__input"
                  aria-label="放大编辑输入"
                  placeholder="把想说的告诉我。"
                  maxLength={MAX_INPUT_LENGTH}
                  value={draft}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    onDraftChange(event.target.value)
                  }}
                  onKeyDown={keyDownInExpand}
                />

                <div className="kk-expand__foot">
                  <span className="kk-expand__hint">
                    ⌘ / Ctrl + Enter 发送 · Esc 收起
                  </span>
                  <button
                    className="kk-composer__send"
                    type="submit"
                    aria-label="发送消息"
                    disabled={!canSend}
                  >
                    <SendIcon className="kk-composer__glyph" />
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
