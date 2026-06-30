import { useId, useState } from "react"

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question"

type AskInputType =
  | "text"
  | "textarea"
  | "single_choice"
  | "multi_choice"
  | "confirmation"

type AskOption = {
  id: string
  label: string
  description?: string
}

export type AskUserQuestionArgs = {
  prompt: string
  description?: string
  inputType: AskInputType
  options: AskOption[]
  required: boolean
  allowCustomOption: boolean
}

type AskUserQuestionResult = {
  submitted: boolean
  value?: string
  selectedOptionIds?: string[]
  values?: Record<string, unknown>
  cancelled?: boolean
}

function field(args: Record<string, unknown>, camel: string, snake: string): unknown {
  return args[camel] ?? args[snake]
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function readInputType(value: unknown): AskInputType | undefined {
  if (
    value === "text" ||
    value === "textarea" ||
    value === "single_choice" ||
    value === "multi_choice" ||
    value === "confirmation"
  ) {
    return value
  }
  return undefined
}

function readOptions(value: unknown): AskOption[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return []
    }
    const record = item as Record<string, unknown>
    const id = readString(record.id)
    const label = readString(record.label)
    if (!id || !label) {
      return []
    }
    const description = readString(record.description)
    return [{ id, label, ...(description ? { description } : {}) }]
  })
}

export function parseAskUserQuestionArgs(
  args: Record<string, unknown>,
): AskUserQuestionArgs | null {
  const prompt = readString(args.prompt)
  const inputType = readInputType(field(args, "inputType", "input_type"))
  if (!prompt || !inputType) {
    return null
  }
  const options = readOptions(args.options)
  if (
    (inputType === "single_choice" || inputType === "multi_choice") &&
    options.length === 0
  ) {
    return null
  }
  const description = readString(args.description)
  return {
    prompt,
    inputType,
    options,
    ...(description ? { description } : {}),
    required: readBoolean(args.required, true),
    allowCustomOption: readBoolean(
      field(args, "allowCustomOption", "allow_custom_option"),
      false,
    ),
  }
}

function encodeAskResult(result: AskUserQuestionResult): string {
  return JSON.stringify(result)
}

export function AskUserQuestionCard({
  question,
  onRespond,
}: {
  question: AskUserQuestionArgs
  onRespond: (message: string) => void | Promise<void>
}) {
  const optionGroupName = useId()
  const [text, setText] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [customOption, setCustomOption] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)

  const trimmedText = text.trim()
  const trimmedCustom = customOption.trim()
  const hasCustomAnswer = question.allowCustomOption && trimmedCustom.length > 0
  const hasSelection = selected.size > 0 || hasCustomAnswer
  const canSubmit =
    !submitting &&
    (question.inputType === "text" || question.inputType === "textarea"
      ? !question.required || trimmedText.length > 0
      : question.inputType === "confirmation"
        ? true
        : !question.required || hasSelection)

  async function send(result: AskUserQuestionResult) {
    setSubmitError(false)
    setSubmitting(true)
    try {
      await onRespond(encodeAskResult(result))
    } catch {
      setSubmitting(false)
      setSubmitError(true)
    }
  }

  function selectedLabels(): string[] {
    return question.options
      .filter((option) => selected.has(option.id))
      .map((option) => option.label)
  }

  function submitText() {
    void send({
      submitted: true,
      value: trimmedText,
    })
  }

  function submitChoice() {
    const selectedOptionIds = Array.from(selected)
    const labels = selectedLabels()
    const values: Record<string, unknown> = {}
    if (hasCustomAnswer) {
      values.customOption = trimmedCustom
    }
    void send({
      submitted: true,
      ...(labels.length > 0 || hasCustomAnswer
        ? { value: [...labels, ...(hasCustomAnswer ? [trimmedCustom] : [])].join(", ") }
        : {}),
      selectedOptionIds,
      ...(Object.keys(values).length > 0 ? { values } : {}),
    })
  }

  function submitCancelled() {
    void send({
      submitted: false,
      cancelled: true,
    })
  }

  const textInput =
    question.inputType === "textarea" ? (
      <textarea
        className="kk-ask__input kk-ask__input--textarea"
        value={text}
        aria-label="你的回答"
        disabled={submitting}
        rows={3}
        onChange={(event) => setText(event.currentTarget.value)}
      />
    ) : question.inputType === "text" ? (
      <input
        className="kk-ask__input"
        value={text}
        aria-label="你的回答"
        disabled={submitting}
        onChange={(event) => setText(event.currentTarget.value)}
      />
    ) : null

  return (
    <div className="kk-ask" role="group" aria-label="需要你回答">
      <div className="kk-ask__copy">
        <p className="kk-ask__prompt">{question.prompt}</p>
        {question.description ? (
          <p className="kk-ask__description">{question.description}</p>
        ) : null}
      </div>

      {textInput}

      {question.inputType === "single_choice" ||
      question.inputType === "multi_choice" ? (
        <div className="kk-ask__options">
          {question.options.map((option) => {
            const checked = selected.has(option.id)
            const inputType =
              question.inputType === "single_choice" ? "radio" : "checkbox"
            return (
              <label className="kk-ask__option" key={option.id}>
                <input
                  type={inputType}
                  name={optionGroupName}
                  checked={checked}
                  disabled={submitting}
                  onChange={(event) => {
                    const next = new Set(selected)
                    if (question.inputType === "single_choice") {
                      next.clear()
                    }
                    if (event.currentTarget.checked) {
                      next.add(option.id)
                    } else {
                      next.delete(option.id)
                    }
                    setSelected(next)
                  }}
                />
                <span className="kk-ask__option-copy">
                  <span className="kk-ask__option-label">{option.label}</span>
                  {option.description ? (
                    <span className="kk-ask__option-description">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })}
          {question.allowCustomOption ? (
            <input
              className="kk-ask__input"
              value={customOption}
              aria-label="自定义选项"
              disabled={submitting}
              onChange={(event) => setCustomOption(event.currentTarget.value)}
            />
          ) : null}
        </div>
      ) : null}

      {submitError ? (
        <p className="kk-ask__error" role="status">
          回答发送失败，请重试。
        </p>
      ) : null}

      {question.inputType === "confirmation" ? (
        <div className="kk-ask__actions">
          <button
            type="button"
            className="kk-ask__button kk-ask__button--primary"
            disabled={submitting}
            onClick={() => {
              void send({ submitted: true, value: "confirmed" })
            }}
          >
            确认
          </button>
          <button
            type="button"
            className="kk-ask__button"
            disabled={submitting}
            onClick={submitCancelled}
          >
            取消
          </button>
        </div>
      ) : (
        <div className="kk-ask__actions">
          <button
            type="button"
            className="kk-ask__button kk-ask__button--primary"
            disabled={!canSubmit}
            onClick={
              question.inputType === "text" || question.inputType === "textarea"
                ? submitText
                : submitChoice
            }
          >
            提交
          </button>
          <button
            type="button"
            className="kk-ask__button"
            disabled={submitting}
            onClick={submitCancelled}
          >
            跳过
          </button>
        </div>
      )}
    </div>
  )
}
