#!/usr/bin/env node

import { constants as fileConstants } from "node:fs"
import { open } from "node:fs/promises"
import process from "node:process"
import { fileURLToPath } from "node:url"

import {
  AGUI_COMPATIBILITY_CONSUMER_MAXIMUM_INPUT_BYTES,
  consumeAguiCompatibilityProviderOutput,
} from "@kokoro/chat-surface/agui-compatibility-consumer"

const MAXIMUM_RECEIPT_BYTES = 65_536

async function readBoundedRegularFile(path) {
  const file = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW | fileConstants.O_NONBLOCK)
  try {
    const before = await file.stat({ bigint: true })
    if (
      !before.isFile() || before.size < 1n ||
      before.size > BigInt(AGUI_COMPATIBILITY_CONSUMER_MAXIMUM_INPUT_BYTES)
    ) throw new Error("AGUI_COMPATIBILITY_INPUT_FILE_INVALID")
    const bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.byteLength) {
      const read = await file.read(bytes, offset, bytes.byteLength - offset, offset)
      if (read.bytesRead === 0) throw new Error("AGUI_COMPATIBILITY_INPUT_FILE_CHANGED")
      offset += read.bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) throw new Error("AGUI_COMPATIBILITY_INPUT_FILE_CHANGED")
    return new Uint8Array(bytes)
  } finally {
    await file.close()
  }
}

export async function runAguiCompatibilityConsumerCli(inputPath) {
  const receipt = await consumeAguiCompatibilityProviderOutput(await readBoundedRegularFile(inputPath))
  const output = `${JSON.stringify(receipt)}\n`
  if (Buffer.byteLength(output, "utf8") > MAXIMUM_RECEIPT_BYTES) {
    throw new Error("AGUI_COMPATIBILITY_RECEIPT_CAPACITY_EXCEEDED")
  }
  return output
}

async function main() {
  const arguments_ = process.argv.slice(2)
  const [flag, inputPath] = arguments_[1] === "--"
    ? [arguments_[0], arguments_[2]]
    : [arguments_[0], arguments_[1]]
  if (flag !== "--input" || inputPath === undefined || (arguments_.length !== 2 && arguments_.length !== 3)) {
    throw new Error("usage: agui-compatibility-consumer --input <session-provider-output.json>")
  }
  process.stdout.write(await runAguiCompatibilityConsumerCli(inputPath))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof Error && /^[A-Z0-9_: -]+$/u.test(error.message)
      ? error.message : "AGUI_COMPATIBILITY_CONSUMER_FAILED"
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  })
}
