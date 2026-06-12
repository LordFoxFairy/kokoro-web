import { describe, expect, it } from "vitest"

import { parseStoredSessionState } from "@/application/session-stream/state-schema"

function stored(steps: unknown[]): unknown {
  return {
    seenEventIds: [],
    messages: [],
    todos: [],
    stepsByRun: { run_1: steps },
    runStatus: "idle",
  }
}

describe("parseStoredSessionState — storedStep discriminated union", () => {
  it("parses every step kind (thinking / tool / subagent / text)", () => {
    const r = parseStoredSessionState(
      stored([
        { kind: "thinking", seq: 1, segmentId: "m1", text: "想" },
        {
          kind: "tool",
          seq: 2,
          segmentId: "m1",
          tool: { id: "t1", name: "x", args: {}, status: "running" },
        },
        {
          kind: "subagent",
          seq: 3,
          segmentId: "m1",
          subagent: {
            id: "s1",
            name: "n",
            description: "d",
            subagentType: "sub",
            source: "built-in",
            status: "running",
          },
        },
        { kind: "text", seq: 4, segmentId: "m1" },
      ]),
    )
    expect(r?.stepsByRun.run_1?.map((s) => s.kind)).toEqual([
      "thinking",
      "tool",
      "subagent",
      "text",
    ])
  })

  it("rejects an unknown step kind", () => {
    expect(
      parseStoredSessionState(stored([{ kind: "bogus", seq: 1, segmentId: "m1" }])),
    ).toBeNull()
  })

  it("rejects a step missing its kind discriminant", () => {
    expect(
      parseStoredSessionState(stored([{ seq: 1, segmentId: "m1", text: "x" }])),
    ).toBeNull()
  })

  it("rejects an extra field in a step (strict per arm)", () => {
    expect(
      parseStoredSessionState(
        stored([{ kind: "text", seq: 1, segmentId: "m1", rogue: 1 }]),
      ),
    ).toBeNull()
  })
})
