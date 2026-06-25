import { useState } from "react"

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
export function ToolCallRow({
  tool,
  onApprove,
  onReject,
}: {
  tool: SessionToolCall
  onApprove?: () => void | Promise<void>
  onReject?: () => void | Promise<void>
}) {
  const argsText = formatArgs(tool.args)
  const running = tool.status === "running"
  const failed = tool.status === "error"
  // awaiting：被门控工具等待用户批准（HITL），展开显示批准/拒绝。
  const awaiting = tool.status === "awaiting"
  // rejected：用户驳回了该调用——工具未执行，显禁止圈而非绿勾。
  const rejected = tool.status === "rejected"
  // responded：done 态但结果由人工答复（非工具产出）——加 provenance 标记，让回看者一眼可辨。
  const responded = Boolean(tool.responded)
  // 点击批准/拒绝后本地置 true：立即禁用按钮,防连点发出第二条决定(否则会被下一个待批工具误读)。
  const [decided, setDecided] = useState(false)
  const [approvalError, setApprovalError] = useState(false)
  // 有入参/结果/错误/待批/已拒绝才展开；无任何细节的工具保持紧凑静态行，spinner 已表态。
  const hasDetail =
    argsText !== null || Boolean(tool.result) || failed || awaiting || rejected

  const head = (
    <>
      <WrenchIcon className="kk-tool__icon" />
      <span className="kk-tool__name">{tool.name}</span>
      {responded ? <span className="kk-tool__responded">已人工答复</span> : null}
      <span className="kk-tool__state" aria-hidden>
        <RunState
          done={tool.status === "done"}
          failed={failed}
          awaiting={awaiting}
          rejected={rejected}
        />
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
    <details
      className={`kk-tool kk-tool--${tool.status}`}
      open={running || failed || awaiting || rejected}
    >
      {/* D1：chevron 作为统一的「可展开」提示——只有可展开行才有，静态行没有，让两者一眼可辨。 */}
      <summary className="kk-tool__summary">
        {head}
        <ChevronIcon className="kk-tool__chevron" />
      </summary>
      <div className="kk-tool__detail">
        {argsText !== null ? (
          <pre className="kk-tool__args">{argsText}</pre>
        ) : null}
        {awaiting ? (
          <div className="kk-tool__approval" role="group" aria-label="工具调用待批准">
            <p className="kk-tool__approval-prompt">
              {approvalError ? "决定发送失败，请重试。" : decided ? "已提交你的决定，等待恢复…" : "该工具调用需要你的批准。"}
            </p>
            {onApprove && onReject ? (
              <div className="kk-tool__approval-actions">
                <button
                  type="button"
                  className="kk-tool__approve"
                  disabled={decided}
                  onClick={async () => {
                    setApprovalError(false)
                    setDecided(true)
                    try {
                      await onApprove?.()
                    } catch {
                      setDecided(false)
                      setApprovalError(true)
                    }
                  }}
                >
                  批准
                </button>
                <button
                  type="button"
                  className="kk-tool__reject"
                  disabled={decided}
                  onClick={async () => {
                    setApprovalError(false)
                    setDecided(true)
                    try {
                      await onReject?.()
                    } catch {
                      setDecided(false)
                      setApprovalError(true)
                    }
                  }}
                >
                  拒绝
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {failed ? (
          <p className="kk-tool__error" role="status">
            {/* || 而非 ??：空串错误文本（无消息异常）也回落到兜底文案，绝不渲染空白红条。 */}
            {tool.errorText || "工具调用失败"}
          </p>
        ) : rejected ? (
          <p className="kk-tool__rejected" role="status">
            你已拒绝该工具调用，未执行。
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
