// kind=input 表单纯逻辑规格：schema→控件映射 / 提交值构造（必填与数字拦截）/ JSON 兜底解析。
import { describe, expect, it } from "vitest"

import {
  buildSubmitValue,
  parseInputFields,
  parseJsonObject,
  type InputField,
} from "@/ui/hitl/input-schema"

const FULL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    name: { type: "string", title: "姓名" },
    color: { enum: ["red", "blue"] },
    agree: { type: "boolean" },
    count: { type: "integer" },
    ratio: { type: "number" },
    tags: { type: "array", items: { enum: ["a", "b"] } },
  },
  required: ["name", "color"],
}

describe("parseInputFields：schema→控件映射", () => {
  it("string→text / enum→enum / boolean→boolean / number|integer→number / array(enum)→multi-enum", () => {
    const fields = parseInputFields(FULL_SCHEMA)
    expect(fields).toEqual<InputField[]>([
      { kind: "text", name: "name", label: "姓名", required: true },
      { kind: "enum", name: "color", label: "color", required: true, options: ["red", "blue"] },
      { kind: "boolean", name: "agree", label: "agree", required: false },
      { kind: "number", name: "count", label: "count", required: false, integer: true },
      { kind: "number", name: "ratio", label: "ratio", required: false, integer: false },
      { kind: "multi-enum", name: "tags", label: "tags", required: false, options: ["a", "b"] },
    ])
  })

  it.each<[string, Record<string, unknown> | undefined]>([
    ["schema 缺席", undefined],
    ["非 object 顶层", { type: "string" }],
    ["properties 缺席", { type: "object" }],
    ["单字段类型不认识（嵌套 object）", {
      type: "object",
      properties: { blob: { type: "object" } },
    }],
    ["array 无 enum items", {
      type: "object",
      properties: { list: { type: "array", items: { type: "string" } } },
    }],
    ["enum 混入非字符串", {
      type: "object",
      properties: { pick: { enum: ["a", 1] } },
    }],
    ["enum 配非 string type", {
      type: "object",
      properties: { pick: { type: "integer", enum: ["a"] } },
    }],
  ])("%s → null（整表回退 JSON 编辑器）", (_label, schema) => {
    expect(parseInputFields(schema)).toBeNull()
  })
})

describe("buildSubmitValue：提交值构造与拦截", () => {
  const fields = parseInputFields(FULL_SCHEMA)!

  it("填齐后产出契约 value（number 解析为数字、boolean 恒有值）", () => {
    const built = buildSubmitValue(fields, {
      name: " Ada ",
      color: "blue",
      agree: true,
      count: "3",
      tags: ["a"],
    })
    expect(built).toEqual({
      ok: true,
      value: { name: "Ada", color: "blue", agree: true, count: 3, tags: ["a"] },
    })
  })

  it("必填缺失全部收进 invalid（拦截提交）", () => {
    const built = buildSubmitValue(fields, {})
    expect(built).toEqual({ ok: false, invalid: ["name", "color"] })
  })

  it("选填留空整键省略；boolean 未触碰为 false", () => {
    const built = buildSubmitValue(fields, { name: "x", color: "red" })
    expect(built).toEqual({ ok: true, value: { name: "x", color: "red", agree: false } })
  })

  it.each<[string, string]>([
    ["非数字", "abc"],
    ["integer 收到小数", "1.5"],
  ])("数字非法（%s）→ invalid", (_label, raw) => {
    const built = buildSubmitValue(fields, { name: "x", color: "red", count: raw })
    expect(built).toEqual({ ok: false, invalid: ["count"] })
  })

  it("multi-enum 必填为空 → invalid", () => {
    const requiredTags = parseInputFields({
      type: "object",
      properties: { tags: { type: "array", items: { enum: ["a"] } } },
      required: ["tags"],
    })!
    expect(buildSubmitValue(requiredTags, {})).toEqual({ ok: false, invalid: ["tags"] })
  })
})

describe("parseJsonObject：JSON 兜底解析", () => {
  it("纯对象通过", () => {
    expect(parseJsonObject('{"otp":"123456"}')).toEqual({ otp: "123456" })
  })

  it.each<[string, string]>([
    ["解析失败", "not json"],
    ["数组", "[1,2]"],
    ["标量", '"x"'],
  ])("%s → null（拦截）", (_label, text) => {
    expect(parseJsonObject(text)).toBeNull()
  })
})
