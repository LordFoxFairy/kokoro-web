import { useState } from "react"
import { z } from "zod"
import { createComponentImplementation } from "@a2ui/react/v0_9"
import { DynamicValueSchema } from "@a2ui/web_core/v0_9"
import { submitPermissionDecision } from "@/application/a2ui-session"

const permissionCardSchema = z.object({
  sessionId: z.string(),
  requestPath: DynamicValueSchema,
})

type PermissionRecord = {
  requestId: string
  decision: "ask" | "allow" | "deny"
  scope?: "once" | "session"
  message: string
  options?: string[]
  kind?: "permission" | "circuit_breaker"
}

function readRecord(value: unknown): PermissionRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.requestId !== "string") return null
  if (record.decision !== "ask" && record.decision !== "allow" && record.decision !== "deny") return null
  if (typeof record.message !== "string") return null
  return {
    requestId: record.requestId,
    decision: record.decision,
    scope: record.scope === "once" || record.scope === "session" ? record.scope : undefined,
    message: record.message,
    options: Array.isArray(record.options) ? record.options.filter((x): x is string => typeof x === "string") : undefined,
    kind: record.kind === "circuit_breaker" ? "circuit_breaker" : "permission",
  }
}

function PermissionRender({ props }: { props: z.infer<typeof permissionCardSchema> & { requestPath: unknown } }) {
  const request = readRecord(props.requestPath)
  const [submitting, setSubmitting] = useState<null | "once" | "session" | "deny">(null)
  const [error, setError] = useState<string | null>(null)

  if (!request) return null
  const ask = request.decision === "ask"

  const decide = async (
    decision: { decision: "allow"; scope: "once" | "session" } | { decision: "deny" },
    key: "once" | "session" | "deny",
  ) => {
    setSubmitting(key)
    setError(null)
    try {
      await submitPermissionDecision({
        sessionId: props.sessionId,
        requestId: request.requestId,
        decision,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "permission decision failed")
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="kk-permission" data-testid="kk-permission" data-kind={request.kind} data-decision={request.decision}>
      <p className="kk-permission__title">需要你的确认</p>
      {ask ? (
        <>
          <p className="kk-permission__message">{request.message}</p>
          <div className="kk-permission__actions">
            <button type="button" onClick={() => decide({ decision: "allow", scope: "once" }, "once")} disabled={submitting !== null}>Allow once</button>
            <button type="button" onClick={() => decide({ decision: "allow", scope: "session" }, "session")} disabled={submitting !== null}>Allow for session</button>
            <button type="button" onClick={() => decide({ decision: "deny" }, "deny")} disabled={submitting !== null}>Deny</button>
          </div>
        </>
      ) : (
        <p className="kk-permission__resolved">{request.message}</p>
      )}
      {error ? <p className="kk-permission__error">{error}</p> : null}
    </div>
  )
}

export const permissionCardComponent = createComponentImplementation(
  { name: "PermissionCard", schema: permissionCardSchema },
  PermissionRender,
)
