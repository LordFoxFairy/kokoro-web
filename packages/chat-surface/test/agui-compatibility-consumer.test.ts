import stableStringify from "fast-json-stable-stringify"
import { describe, expect, it } from "vitest"

import fixtureJson from "../../session-client/test/fixtures/root-agui-presentation-v1.json"
import {
  createAguiPresentationDecoder,
  type AguiGrantBinding,
  type AguiPresentationSnapshotAuthority,
} from "@kokoro/session-client/agui-presentation"
import {
  AGUI_COMPATIBILITY_CONSUMER_MAXIMUM_INPUT_BYTES,
  consumeAguiCompatibilityProviderOutput,
} from "../src/runtime/agui-compatibility-consumer.js"

type FixtureFrame = Readonly<{
  id: string
  event: string
  data: Readonly<Record<string, unknown>>
}>

type FixtureCase = Readonly<{
  snapshot: Omit<AguiPresentationSnapshotAuthority, "runBindings" | "messageBindings">
  grantBinding: AguiGrantBinding
  frames: readonly FixtureFrame[]
}>

type FixtureCorpus = Readonly<{ positiveCases: readonly FixtureCase[] }>

const fixture = fixtureJson as FixtureCorpus
const contractCase = fixture.positiveCases[0]
if (contractCase === undefined) throw new Error("Root AG-UI fixture missing")

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("")
}

async function digest(value: string): Promise<string> {
  return `sha256:${hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))}`
}

async function providerOutput(): Promise<Record<string, unknown>> {
  const initialSnapshot = {
    ...contractCase.snapshot,
    runBindings: [],
    messageBindings: [],
  }
  const decoder = createAguiPresentationDecoder({
    grant: contractCase.grantBinding,
    snapshotAuthority: initialSnapshot,
  })
  const frames = []
  const receipts = []
  for (const [index, frame] of contractCase.frames.entries()) {
    const data = stableStringify(frame.data)
    if (data === undefined) throw new Error("fixture frame is not JSON")
    decoder.prepare({ id: frame.id, event: frame.event, data }).commit("applied")
    const source = frame.data["source"] as Readonly<Record<string, unknown>>
    const receipt = {
      candidateRef: `agui_candidate:sha256:${(index + 1).toString(16).padStart(64, "0")}`,
      publicSourceEventId: source["sourceEventId"],
      durableSeq: source["durableSeq"],
      projectionPayloadDigest: await digest(data),
    }
    frames.push({ id: frame.id, event: frame.event, data })
    receipts.push(receipt)
  }
  const pages = []
  for (let start = 0; start < frames.length; start += 3) {
    const pageFrames = frames.slice(start, start + 3)
    const next = start + pageFrames.length
    pages.push({
      afterDurableSeq: String(start),
      frames: pageFrames,
      hasMore: next < frames.length,
      nextAfterDurableSeq: String(next),
    })
  }
  return {
    profileRevision: "kokoro-session-agui-compatibility-output.v1",
    scope: { siteId: "site.compat", sessionId: contractCase.grantBinding.sessionId, streamEpoch: "41" },
    producer: { producerInstanceRef: "agent.instance.compat", producerGeneration: "1" },
    initialSnapshot,
    admissions: receipts.map((receipt) => ({ outcome: "committed", ...receipt })),
    replay: {
      pageLimit: 3,
      pages,
      frameCount: frames.length,
      finalAfterDurableSeq: String(frames.length),
    },
    finalSnapshot: decoder.getSnapshotAuthority(),
    receipts,
  }
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

describe("AG-UI compatibility consumer", () => {
  it("consumes paged Session frames through the public Chat adapter and emits a closed receipt", async () => {
    const receipt = await consumeAguiCompatibilityProviderOutput(encode(await providerOutput()))

    expect(receipt).toMatchObject({
      profileRevision: "kokoro-web-agui-compatibility-consumer-receipt.v1",
      providerProfileRevision: "kokoro-session-agui-compatibility-output.v1",
      scope: { siteId: "site.compat", sessionId: "session.01", streamEpoch: "41" },
      consumed: {
        pageCount: 9,
        frameCount: 26,
        finalDurableSeq: "26",
        authorityCommitCount: 26,
        durableDispatchCount: 26,
      },
      authority: {
        initialDurableSeq: "0",
        finalDurableSeq: "26",
        runBindingCount: 2,
        messageBindingCount: 2,
        finalSnapshotEqual: true,
      },
      coverage: {
        bindingAuthority: true,
        runLifecycle: true,
        textLifecycle: true,
        terminalLifecycle: true,
        dispatchBeforeCommit: true,
      },
    })
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(JSON.stringify(receipt)).not.toMatch(/internal(?:Run|Message|Thread)Ref|parentInternalRunRef/u)
  })

  it("fails closed on unknown fields and oversized input before dispatch", async () => {
    await expect(consumeAguiCompatibilityProviderOutput(encode({
      ...(await providerOutput()),
      unexpected: true,
    }))).rejects.toThrow("AGUI_COMPATIBILITY_PROVIDER_OUTPUT_INVALID")
    await expect(consumeAguiCompatibilityProviderOutput(
      new Uint8Array(AGUI_COMPATIBILITY_CONSUMER_MAXIMUM_INPUT_BYTES + 1),
    )).rejects.toThrow("AGUI_COMPATIBILITY_PROVIDER_OUTPUT_CAPACITY_EXCEEDED")
  })

  it("rejects receipt, paging, and final-authority equivocation", async () => {
    const receiptAttack = await providerOutput()
    const receipts = receiptAttack["receipts"] as Array<Record<string, unknown>>
    receipts[0] = { ...receipts[0], projectionPayloadDigest: `sha256:${"0".repeat(64)}` }
    await expect(consumeAguiCompatibilityProviderOutput(encode(receiptAttack)))
      .rejects.toThrow("AGUI_COMPATIBILITY_RECEIPT_MISMATCH")

    const pageAttack = await providerOutput()
    const replay = pageAttack["replay"] as Record<string, unknown>
    const pages = replay["pages"] as Array<Record<string, unknown>>
    pages[1] = { ...pages[1], afterDurableSeq: "2" }
    await expect(consumeAguiCompatibilityProviderOutput(encode(pageAttack)))
      .rejects.toThrow("AGUI_COMPATIBILITY_REPLAY_INVALID")

    const authorityAttack = await providerOutput()
    const finalSnapshot = authorityAttack["finalSnapshot"] as Record<string, unknown>
    authorityAttack["finalSnapshot"] = { ...finalSnapshot, cursor: contractCase.snapshot.cursor }
    await expect(consumeAguiCompatibilityProviderOutput(encode(authorityAttack)))
      .rejects.toThrow("AGUI_COMPATIBILITY_FINAL_AUTHORITY_MISMATCH")
  })
})
