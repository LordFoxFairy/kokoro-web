// kind=input 动态表单输入卡：schema 驱动控件、submit payload 形状、必填拦截、
// JSON 兜底、校验失败重问（validation_error 上卡且草稿保留）、reject 同卡。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionToolCall } from "@/core/state"
import { LocaleProvider } from "@/i18n/context"
import { InputCard } from "@/ui/hitl/input-card"
import { ToolCallRow } from "@/ui/thread/tool-call-row"

const OTP_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    otp: { type: "string", title: "验证码" },
    channel: { enum: ["sms", "email"] },
    remember: { type: "boolean", title: "记住设备" },
    count: { type: "integer" },
    tags: { type: "array", items: { enum: ["a", "b"] } },
  },
  required: ["otp"],
}

function makeTool(overrides: Partial<SessionToolCall> = {}): SessionToolCall {
  return {
    id: "tool_1",
    name: "mcp_call",
    args: { message: "需要验证码" },
    status: "awaiting",
    awaitingKind: "input",
    allowedDecisions: ["submit", "reject"],
    inputSchema: OTP_SCHEMA,
    pendingToolIds: ["tool_1"],
    ...overrides,
  }
}

function renderCard(tool: SessionToolCall, onDecision = vi.fn()) {
  const view = render(
    <InputCard tool={tool} hitlActive controlError={null} onDecision={onDecision} />,
    { wrapper: LocaleProvider },
  )
  return { view, onDecision }
}

beforeEach(() => {
  window.localStorage.setItem("kokoro.locale", "zh")
})

// vitest 未开 globals：RTL 自动 cleanup 不生效，显式清理防跨用例 DOM 累积。
afterEach(cleanup)

describe("InputCard：schema→控件映射", () => {
  it("string→输入框 / enum→单选 / boolean→开关 / number→数字框 / array(enum)→多选", () => {
    renderCard(makeTool())
    // string：文本输入框（唯一 textbox）。
    expect(screen.getByRole("textbox")).toBeInTheDocument()
    // enum：radiogroup + 每个选项一个 radio。
    expect(screen.getByRole("radiogroup", { name: "channel" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "sms" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "email" })).toBeInTheDocument()
    // boolean：开关。
    expect(screen.getByRole("switch")).toBeInTheDocument()
    // number：数字框。
    expect(screen.getByRole("spinbutton")).toBeInTheDocument()
    // array(enum)：多选 checkbox。
    expect(screen.getByRole("checkbox", { name: "a" })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "b" })).toBeInTheDocument()
    // 提示语来自 args.message。
    expect(screen.getByText("需要验证码")).toBeInTheDocument()
  })

  it("必填字段带 * 与 aria-required；title 作标签", () => {
    renderCard(makeTool())
    expect(screen.getByText("验证码 *")).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-required", "true")
    expect(screen.getByText("记住设备")).toBeInTheDocument()
  })
})

describe("InputCard：提交", () => {
  it("submit payload 形状：{type:'submit', value}（契约 SubmitDecision 的 UI 半场）", () => {
    const { onDecision } = renderCard(makeTool())
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("radio", { name: "email" }))
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "a" }))
    fireEvent.click(screen.getByRole("button", { name: "提交" }))
    expect(onDecision).toHaveBeenCalledWith("tool_1", {
      type: "submit",
      value: { otp: "123456", channel: "email", remember: true, count: 3, tags: ["a"] },
    })
  })

  it("必填拦截：必填缺失点提交不发决策，亮错误行", () => {
    const { onDecision } = renderCard(makeTool())
    fireEvent.click(screen.getByRole("button", { name: "提交" }))
    expect(onDecision).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("必填项未填或格式不对")
  })

  it("reject 同卡：allowed_decisions 含 reject 时可直接拒绝", () => {
    const { onDecision } = renderCard(makeTool())
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }))
    expect(onDecision).toHaveBeenCalledWith("tool_1", { type: "reject" })
  })

  it("allowed_decisions 不含 reject 时无拒绝按钮", () => {
    renderCard(makeTool({ allowedDecisions: ["submit"] }))
    expect(screen.queryByRole("button", { name: "拒绝" })).toBeNull()
  })
})

describe("InputCard：不认识的 schema 走 JSON 兜底", () => {
  const rawTool = makeTool({
    inputSchema: { type: "object", properties: { blob: { type: "object" } } },
  })

  it("非法 JSON 拦截提交；改成合法对象后放行 parsed value", () => {
    const { onDecision } = renderCard(rawTool)
    const editor = screen.getByRole("textbox", { name: "JSON 输入" })
    fireEvent.change(editor, { target: { value: "not json" } })
    fireEvent.click(screen.getByRole("button", { name: "提交" }))
    expect(onDecision).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("JSON 解析失败")

    fireEvent.change(editor, { target: { value: '{"blob":{"k":1}}' } })
    fireEvent.click(screen.getByRole("button", { name: "提交" }))
    expect(onDecision).toHaveBeenCalledWith("tool_1", {
      type: "submit",
      value: { blob: { k: 1 } },
    })
  })

  it("schema 缺席同样兜底为 JSON 编辑器", () => {
    const tool = makeTool()
    delete (tool as { inputSchema?: Record<string, unknown> }).inputSchema
    renderCard(tool)
    expect(screen.getByRole("textbox", { name: "JSON 输入" })).toBeInTheDocument()
  })
})

describe("InputCard：校验失败重问", () => {
  it("重发 awaiting 带 validation_error：错误上卡且已填草稿保留", () => {
    const onDecision = vi.fn()
    const { rerender } = render(
      <InputCard tool={makeTool()} hitlActive controlError={null} onDecision={onDecision} />,
      { wrapper: LocaleProvider },
    )
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "1234" } })
    // 服务端校验失败重发 awaiting：同 tool_id、args 追加 validation_error（卡不卸载只刷新 props）。
    rerender(
      <InputCard
        tool={makeTool({
          args: { message: "需要验证码", validation_error: "'otp' is a required property" },
        })}
        hitlActive
        controlError={null}
        onDecision={onDecision}
      />,
    )
    expect(screen.getByRole("status")).toHaveTextContent("上次提交未通过校验")
    expect(screen.getByRole("status")).toHaveTextContent("'otp' is a required property")
    expect(screen.getByRole("textbox")).toHaveValue("1234")
  })
})

describe("ToolCallRow：kind=input 分流到输入卡", () => {
  it("awaitingKind=input 渲染动态表单卡，原始 args JSON 不重复展示", () => {
    render(
      <ToolCallRow
        sessionId="ses_1"
        tool={makeTool()}
        hitlActive
        controlError={null}
        onDecision={vi.fn()}
      />,
      { wrapper: LocaleProvider },
    )
    expect(screen.getByRole("group", { name: "Agent 请求补充输入" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "提交" })).toBeInTheDocument()
    // args 原文（message JSON）不再以 <pre> 重复出现——语义卡已呈现。
    expect(document.querySelector("pre")).toBeNull()
  })
})
