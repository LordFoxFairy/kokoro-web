import { useState } from "react"

import type { SessionToolCall } from "@/core/state"
import type { ToolDecision } from "@/engine/hitl-staging"
import { useT } from "@/i18n/context"

import styles from "../thread/thread.module.css"
import {
  buildSubmitValue,
  parseInputFields,
  parseJsonObject,
  type FieldDraft,
  type InputField,
} from "./input-schema"

type InputCardProps = {
  tool: SessionToolCall
  // 该工具已暂存的决策（引擎 staging 快照）；同帧未凑齐时先「已记录」。
  staged?: ToolDecision
  // 本轮仍处 awaiting-hitl 相位才允许发决策；resume 已发出后按钮收口。
  hitlActive: boolean
  // control POST 失败：呈现错误并放开按钮允许重试（暂存仍在，重按即重发）。
  controlError: string | null
  onDecision?: (toolId: string, decision: ToolDecision) => void
}

// 提示语来自 args.message（MCP elicitation 的人话请求），缺省回落工具自述再回落兜底文案。
function messageOf(tool: SessionToolCall, fallback: string): string {
  const raw = tool.args["message"]
  if (typeof raw === "string" && raw) {
    return raw
  }
  return tool.description || fallback
}

// 校验失败重问：validation_error 随重发 awaiting 的 args 上 wire（agent 侧契约事实）。
function validationErrorOf(tool: SessionToolCall): string | null {
  const raw = tool.args["validation_error"]
  return typeof raw === "string" && raw ? raw : null
}

function draftText(draft: FieldDraft, name: string): string {
  const raw = draft[name]
  return typeof raw === "string" ? raw : ""
}

function draftList(draft: FieldDraft, name: string): string[] {
  const raw = draft[name]
  return Array.isArray(raw) ? raw : []
}

// 动态输入卡（kind=input）：input_schema 驱动受控表单——string→输入框、enum→单选、
// boolean→开关、number→数字框、array(enum)→多选；不认识的 schema 回退原始 JSON 编辑器。
// 提交=契约 SubmitDecision{request_id=tool_id, value}；reject 同卡（allowed_decisions 驱动）。
// 表单草稿活在组件本地：校验失败重问只刷新同一工具步（卡不卸载），已填内容原样保留。
export function InputCard({ tool, staged, hitlActive, controlError, onDecision }: InputCardProps) {
  const t = useT()
  const [draft, setDraft] = useState<FieldDraft>({})
  const [jsonText, setJsonText] = useState("{}")
  // 本地拦截态：required=必填缺失或数字非法（invalid 记字段名），json=兜底编辑器解析失败。
  const [blocked, setBlocked] = useState<{ kind: "required"; invalid: string[] } | { kind: "json" } | null>(null)

  const decided = staged !== undefined
  const actionable = hitlActive && onDecision !== undefined
  // 已暂存且未报错即禁用（防连点双发）；POST 失败时放开允许重试。
  const disabled = !actionable || (decided && controlError === null)
  const allowedDecisions = tool.allowedDecisions ?? []
  const canSubmit = allowedDecisions.includes("submit")
  const canReject = allowedDecisions.includes("reject")
  const fields = parseInputFields(tool.inputSchema)
  const validationError = validationErrorOf(tool)

  const prompt = messageOf(tool, t("hitl.inputHint"))
  const promptText = controlError
    ? t("hitl.decisionFailed")
    : decided || !hitlActive
      ? t("hitl.decisionRecorded")
      : prompt

  const setField = (name: string, value: string | boolean | string[]) => {
    setDraft((prev) => ({ ...prev, [name]: value }))
  }

  const submit = () => {
    if (onDecision === undefined) {
      return
    }
    if (fields === null) {
      const value = parseJsonObject(jsonText)
      if (value === null) {
        setBlocked({ kind: "json" })
        return
      }
      setBlocked(null)
      onDecision(tool.id, { type: "submit", value })
      return
    }
    const built = buildSubmitValue(fields, draft)
    if (!built.ok) {
      setBlocked({ kind: "required", invalid: built.invalid })
      return
    }
    setBlocked(null)
    onDecision(tool.id, { type: "submit", value: built.value })
  }

  const invalidSet = new Set(blocked?.kind === "required" ? blocked.invalid : [])

  const renderField = (field: InputField) => {
    const invalid = invalidSet.has(field.name)
    const labelText = field.required ? `${field.label} *` : field.label
    switch (field.kind) {
      case "text":
        return (
          <label key={field.name} className={styles.toolInputLabel} data-invalid={invalid || undefined}>
            <span>{labelText}</span>
            <input
              className={styles.toolRespondInput}
              value={draftText(draft, field.name)}
              disabled={disabled}
              aria-required={field.required}
              aria-invalid={invalid || undefined}
              onChange={(event) => setField(field.name, event.target.value)}
            />
          </label>
        )
      case "number":
        return (
          <label key={field.name} className={styles.toolInputLabel} data-invalid={invalid || undefined}>
            <span>{labelText}</span>
            <input
              type="number"
              className={styles.toolRespondInput}
              value={draftText(draft, field.name)}
              disabled={disabled}
              aria-required={field.required}
              aria-invalid={invalid || undefined}
              step={field.integer ? 1 : "any"}
              onChange={(event) => setField(field.name, event.target.value)}
            />
          </label>
        )
      case "boolean":
        return (
          <label key={field.name} className={`${styles.toolInputLabel} ${styles.toolInputSwitchRow}`}>
            <input
              type="checkbox"
              role="switch"
              className={styles.toolInputSwitch}
              checked={draft[field.name] === true}
              disabled={disabled}
              aria-checked={draft[field.name] === true}
              onChange={(event) => setField(field.name, event.target.checked)}
            />
            <span>{labelText}</span>
          </label>
        )
      case "enum": {
        const selected = draftText(draft, field.name)
        return (
          <div key={field.name} className={styles.toolInputLabel} data-invalid={invalid || undefined}>
            <span>{labelText}</span>
            <div className={styles.toolChoices} role="radiogroup" aria-label={field.label}>
              {field.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected === option}
                  className={styles.toolChoice}
                  data-selected={selected === option ? "true" : undefined}
                  disabled={disabled}
                  onClick={() => setField(field.name, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )
      }
      case "multi-enum": {
        const selected = draftList(draft, field.name)
        return (
          <div key={field.name} className={styles.toolInputLabel} data-invalid={invalid || undefined}>
            <span>{labelText}</span>
            <div className={styles.toolChoices} role="group" aria-label={field.label}>
              {field.options.map((option) => {
                const checked = selected.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    className={styles.toolChoice}
                    data-selected={checked ? "true" : undefined}
                    disabled={disabled}
                    onClick={() =>
                      setField(
                        field.name,
                        checked ? selected.filter((item) => item !== option) : [...selected, option],
                      )
                    }
                  >
                    {option}
                  </button>
                )
              })}
            </div>
          </div>
        )
      }
    }
  }

  return (
    <div className={styles.toolApproval} role="group" aria-label={t("hitl.inputTitle")}>
      <p className={styles.toolApprovalPrompt}>{promptText}</p>
      {validationError !== null ? (
        <p className={styles.toolInputError} role="status">
          {t("hitl.inputValidationError", { error: validationError })}
        </p>
      ) : null}
      {canSubmit ? (
        fields !== null ? (
          <div className={styles.toolInputFields}>{fields.map(renderField)}</div>
        ) : (
          <>
            <p className={styles.toolInputJsonHint}>{t("hitl.inputJsonHint")}</p>
            <textarea
              className={styles.toolInputJson}
              aria-label={t("hitl.inputJsonAria")}
              value={jsonText}
              disabled={disabled}
              onChange={(event) => setJsonText(event.target.value)}
            />
          </>
        )
      ) : null}
      {blocked !== null ? (
        <p className={styles.toolInputError} role="alert">
          {blocked.kind === "json" ? t("hitl.inputJsonInvalid") : t("hitl.inputRequired")}
        </p>
      ) : null}
      {actionable && (canSubmit || canReject) ? (
        <div className={styles.toolApprovalActions}>
          {canSubmit ? (
            <button type="button" className={styles.toolApprove} disabled={disabled} onClick={submit}>
              {t("hitl.inputSubmit")}
            </button>
          ) : null}
          {canReject ? (
            <button
              type="button"
              className={styles.toolReject}
              disabled={disabled}
              onClick={() => onDecision(tool.id, { type: "reject" })}
            >
              {t("hitl.reject")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
