import type { SessionClient } from "@kokoro/session-client"
import type {
  CommandIdentity,
  SessionCommandResponse,
} from "@kokoro/session-client/contracts"

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Command payload contains a non-finite number")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`
  }
  throw new Error("Command payload cannot be canonically serialized")
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The single command-identity implementation used by every reference Site command. */
export async function createReferenceCommandIdentity(effect: unknown): Promise<CommandIdentity> {
  // Root command authorities accept the common 32hex profile (or UUIDv7), not UUIDv4 wire text.
  // randomUUID remains the CSPRNG source; removing separators preserves all 122 random/version bits.
  const commandId = globalThis.crypto.randomUUID().replaceAll("-", "")
  return {
    command_id: commandId,
    idempotency_key: `web:${commandId}`,
    digest_algorithm: "SHA256_CANONICAL_JSON_V1",
    request_digest: await sha256(canonicalJson(effect)),
  }
}

/** Perform the contract's one-shot durable receipt lookup for an uncertain command response. */
export async function reconcileReferenceCommandReceipt(
  client: Pick<SessionClient, "getCommandReceipt">,
  response: SessionCommandResponse,
  command: CommandIdentity,
  operation: Parameters<SessionClient["getCommandReceipt"]>[1]["operation"],
): Promise<SessionCommandResponse> {
  const receipt = response.command_receipt
  if (receipt.status !== "pending" && receipt.status !== "outcome_unknown") return response
  return client.getCommandReceipt(command.command_id, {
    operation,
    idempotency_key: command.idempotency_key,
    digest_algorithm: command.digest_algorithm,
    request_digest: command.request_digest,
  })
}
