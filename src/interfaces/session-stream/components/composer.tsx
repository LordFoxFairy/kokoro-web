import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react"

import { MAX_INPUT_LENGTH, resizeComposer } from "../hooks/use-conversation"
import { ComposerMenu, type MenuOption } from "./composer-menu"
import { ChevronIcon, MicIcon, PlusIcon, SendIcon, StopIcon } from "./icons"

// 附加菜单：先放基础入口（参考 Gemini 的 +）。上传链路接后端前为占位项。
const ATTACH_OPTIONS: MenuOption[] = [
  { key: "image", label: "上传图片" },
  { key: "file", label: "上传文件" },
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
          options={ATTACH_OPTIONS}
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
