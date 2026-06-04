import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react"

import { MAX_INPUT_LENGTH, resizeComposer } from "../hooks/use-conversation"
import {
  ComposerMenu,
  type MenuOption,
  type MenuSection,
} from "./composer-menu"
import { ChevronIcon, MicIcon, PlusIcon, SendIcon, StopIcon } from "./icons"

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

// 模式：Fast / Thinking 下拉单选。当前只切换显示，接入 run 的 execution_style 后生效。
const MODE_OPTIONS: MenuOption[] = [
  { key: "fast", label: "Fast", hint: "更快回应" },
  { key: "thinking", label: "Thinking", hint: "更深的思考" },
]

type ComposerProps = {
  draft: string
  onDraftChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  isStreaming: boolean
  canSend: boolean
  onStop: () => void
  transportLabel: string
  composerRef: RefObject<HTMLTextAreaElement | null>
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
  composerRef,
}: ComposerProps) {
  const [mode, setMode] = useState("fast")
  const modeLabel = mode === "thinking" ? "Thinking" : "Fast"

  return (
    <div className="kk-shell__composer-wrap">
      <form className="kk-composer" aria-label="消息编辑区" onSubmit={onSubmit}>
        <ComposerMenu
          triggerClassName="kk-composer__add"
          triggerLabel="附加内容"
          trigger={<PlusIcon className="kk-composer__glyph" />}
          sections={ATTACH_SECTIONS}
          onSelect={() => {
            // 占位：上传链路接入后在此处理所选来源。
          }}
        />

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

        <ComposerMenu
          triggerClassName="kk-composer__mode"
          triggerLabel="切换模式"
          trigger={
            <>
              <span>{modeLabel}</span>
              <ChevronIcon className="kk-composer__chevron" />
            </>
          }
          options={MODE_OPTIONS}
          selectedKey={mode}
          onSelect={setMode}
          align="end"
        />

        <button className="kk-composer__mic" type="button" aria-label="语音输入">
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
      </form>

      {/* 常驻保留高度：标签延后出现也不改变 composer 位置，避免聊天框跳动。 */}
      <p className="kk-shell__transport">{transportLabel}</p>
    </div>
  )
}
