// kind=input 动态表单的纯逻辑：把 input_schema（JSON Schema 子集）映射成受控控件规格，
// 任何不认识的形状整表返回 null → 卡片回退原始 JSON 编辑器（textarea + parse 校验）。
// 半生不熟的表单会静默丢字段，宁可整表兜底也不部分渲染。

export type InputField =
  | { kind: "text"; name: string; label: string; required: boolean }
  | { kind: "enum"; name: string; label: string; required: boolean; options: string[] }
  | { kind: "boolean"; name: string; label: string; required: boolean }
  | { kind: "number"; name: string; label: string; required: boolean; integer: boolean }
  | { kind: "multi-enum"; name: string; label: string; required: boolean; options: string[] }

// 表单草稿：受控组件的原始输入值（number 存原文，提交时才解析）。
export type FieldDraft = Record<string, string | boolean | string[]>

export type SubmitBuild =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; invalid: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// 仅接受非空纯字符串 enum；混入其它类型即视为不认识（整表兜底）。
function stringEnumOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }
  return value.every((item): item is string => typeof item === "string") ? value : null
}

function parseField(name: string, spec: unknown, required: boolean): InputField | null {
  if (!isRecord(spec)) {
    return null
  }
  const rawTitle = spec["title"]
  const label = typeof rawTitle === "string" && rawTitle ? rawTitle : name
  const type = spec["type"]
  const options = stringEnumOf(spec["enum"])
  if (options !== null) {
    // 字符串 enum 单选：type 缺省或显式 string 都认；其余 type + enum 组合不认识。
    return type === undefined || type === "string"
      ? { kind: "enum", name, label, required, options }
      : null
  }
  if (type === "string") {
    return { kind: "text", name, label, required }
  }
  if (type === "boolean") {
    return { kind: "boolean", name, label, required }
  }
  if (type === "number" || type === "integer") {
    return { kind: "number", name, label, required, integer: type === "integer" }
  }
  if (type === "array") {
    const items = spec["items"]
    const itemOptions = isRecord(items) ? stringEnumOf(items["enum"]) : null
    return itemOptions !== null
      ? { kind: "multi-enum", name, label, required, options: itemOptions }
      : null
  }
  return null
}

// schema → 控件规格；返回 null = 整表回退 JSON 编辑器。必填由 schema.required 驱动。
export function parseInputFields(schema: Record<string, unknown> | undefined): InputField[] | null {
  if (schema === undefined || schema["type"] !== "object") {
    return null
  }
  const properties = schema["properties"]
  if (!isRecord(properties)) {
    return null
  }
  const rawRequired = schema["required"]
  const required = new Set(
    Array.isArray(rawRequired)
      ? rawRequired.filter((item): item is string => typeof item === "string")
      : [],
  )
  const fields: InputField[] = []
  for (const [name, spec] of Object.entries(properties)) {
    const field = parseField(name, spec, required.has(name))
    if (field === null) {
      return null
    }
    fields.push(field)
  }
  return fields
}

// 草稿 → 契约 SubmitDecision.value；必填缺失/数字非法收集进 invalid（拦截提交）。
// 选填留空的键整个省略——elicitation 服务端按 schema 校验，空串比缺键更容易误伤。
export function buildSubmitValue(
  fields: readonly InputField[],
  draft: FieldDraft,
): SubmitBuild {
  const value: Record<string, unknown> = {}
  const invalid: string[] = []
  for (const field of fields) {
    const raw = draft[field.name]
    switch (field.kind) {
      case "text":
      case "enum": {
        const text = typeof raw === "string" ? raw.trim() : ""
        if (text) {
          value[field.name] = text
        } else if (field.required) {
          invalid.push(field.name)
        }
        break
      }
      case "boolean":
        // 开关恒有值：未触碰即 false（布尔无「未填」态）。
        value[field.name] = raw === true
        break
      case "number": {
        const text = typeof raw === "string" ? raw.trim() : ""
        if (!text) {
          if (field.required) {
            invalid.push(field.name)
          }
          break
        }
        const num = Number(text)
        if (!Number.isFinite(num) || (field.integer && !Number.isInteger(num))) {
          invalid.push(field.name)
        } else {
          value[field.name] = num
        }
        break
      }
      case "multi-enum": {
        const list = Array.isArray(raw) ? raw : []
        if (list.length > 0) {
          value[field.name] = list
        } else if (field.required) {
          invalid.push(field.name)
        }
        break
      }
    }
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, value }
}

// JSON 兜底编辑器的提交解析：必须是纯对象（数组/标量/解析失败都拦截）。
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
