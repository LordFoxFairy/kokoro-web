import type { SessionClient } from "@kokoro/session-client"
import type {
  BrowserCommandDigestInput,
  CommandIdentity,
  SessionCommandResponse,
} from "@kokoro/session-client/contracts"
import {
  BROWSER_COMMAND_DIGEST_ALGORITHM,
  canonicalBrowserCommandDigestPreimage,
} from "@kokoro/session-client/contracts"

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The single command-identity implementation used by every Site command. */
export async function createCommandIdentity(input: BrowserCommandDigestInput): Promise<CommandIdentity> {
  // Root command authorities accept the common 32hex profile (or UUIDv7), not UUIDv4 wire text.
  // randomUUID remains the CSPRNG source; removing separators preserves all 122 random/version bits.
  const commandId = globalThis.crypto.randomUUID().replaceAll("-", "")
  return {
    command_id: commandId,
    idempotency_key: `web:${commandId}`,
    digest_algorithm: BROWSER_COMMAND_DIGEST_ALGORITHM,
    request_digest: await sha256(canonicalBrowserCommandDigestPreimage(input)),
  }
}

/** Perform the contract's one-shot durable receipt lookup for an uncertain command response. */
export async function reconcileCommandReceipt(
  client: Pick<SessionClient, "getCommandReceipt">,
  response: SessionCommandResponse,
  command: CommandIdentity,
  operation: Parameters<SessionClient["getCommandReceipt"]>[1]["operation"],
): Promise<SessionCommandResponse> {
  const assertIdentity = (candidate: SessionCommandResponse): SessionCommandResponse => {
    const receipt = candidate.command_receipt
    if (
      receipt.operation !== operation ||
      receipt.command_id !== command.command_id ||
      receipt.idempotency_key !== command.idempotency_key ||
      receipt.digest_algorithm !== command.digest_algorithm ||
      receipt.request_digest !== command.request_digest
    ) throw new Error("Session command receipt identity mismatch")
    return candidate
  }

  assertIdentity(response)
  const receipt = response.command_receipt
  if (receipt.status !== "pending" && receipt.status !== "outcome_unknown") return response
  return assertIdentity(await client.getCommandReceipt(command.command_id, {
    operation,
    idempotency_key: command.idempotency_key,
    digest_algorithm: command.digest_algorithm,
    request_digest: command.request_digest,
  }))
}
