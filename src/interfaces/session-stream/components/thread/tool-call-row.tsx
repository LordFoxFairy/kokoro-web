import type { SessionToolCall } from "@/application/session-stream/reducer"

import { ChevronIcon, WrenchIcon } from "../icons"
import { RunState } from "./run-state"

// 工具参数压成紧凑 JSON 预览；空参数返回 null（不渲染参数块）。
function formatArgs(args: Record<string, unknown>): string | null {
  const keys = Object.keys(args)
  if (keys.length === 0) {
    return null
  }
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    // 出现循环引用等无法序列化的值时降级为键名列表，绝不因日志化参数而抛错。
    return keys.join(", ")
  }
}

// 单条工具调用：扳手 + 名称 + 运行态。有入参/结果/错误时是可展开的 <details>，
// 无任何细节时退化为不可点击的 <div>，避免无意义的死切换。
// 错误态（status==="error"）携带 errorText，落定后仍保持展开（本轮通常继续）。
export function ToolCallRow({ tool }: { tool: SessionToolCall }) {
  const argsText = formatArgs(tool.args)
  const running = tool.status === "running"
  const failed = tool.status === "error"
  // 有入参/结果/错误才展开；无任何细节的工具（含无入参的运行中）保持紧凑静态行，spinner 已表态。
  const hasDetail = argsText !== null || Boolean(tool.result) || failed

  const head = (
    <>
      <WrenchIcon className="kk-tool__icon" />
      <span className="kk-tool__name">{tool.name}</span>
      <span className="kk-tool__state" aria-hidden>
        <RunState done={tool.status === "done"} failed={failed} />
      </span>
    </>
  )

  if (!hasDetail) {
    return (
      <div className={`kk-tool kk-tool--${tool.status}`}>
        <div className="kk-tool__summary kk-tool__summary--static">{head}</div>
      </div>
    )
  }

  return (
    <details className={`kk-tool kk-tool--${tool.status}`} open={running || failed}>
      {/* D1：chevron 作为统一的「可展开」提示——只有可展开行才有，静态行没有，让两者一眼可辨。 */}
      <summary className="kk-tool__summary">
        {head}
        <ChevronIcon className="kk-tool__chevron" />
      </summary>
      <div className="kk-tool__detail">
        {argsText !== null ? (
          <pre className="kk-tool__args">{argsText}</pre>
        ) : null}
        {failed ? (
          <p className="kk-tool__error" role="status">
            {tool.errorText ?? "工具调用失败"}
          </p>
        ) : tool.result ? (
          <pre className="kk-tool__result">{tool.result}</pre>
        ) : running ? (
          <p className="kk-pending">
            运行中
            <span className="kk-thread__pulse" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : null}
      </div>
    </details>
  )
}
