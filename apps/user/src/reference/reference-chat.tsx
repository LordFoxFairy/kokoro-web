"use client"

import { createSessionClient } from "@kokoro/session-client"
import type { ChatPart } from "@kokoro/chat-surface"
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import { createBrowserSessionTransport } from "./browser-session-transport"
import {
  createReferenceChatController,
  type ReferenceChatController,
  type ReferenceChatState,
} from "./reference-chat-controller"
import styles from "./reference-chat.module.css"

function neverPart(part: never): never {
  throw new Error(`Unreachable Chat part: ${JSON.stringify(part)}`)
}

function Part({ part }: { readonly part: ChatPart }) {
  const meta = <span className={styles.partMeta}>v{part.version} · {part.lifecycle}</span>
  switch (part.kind) {
    case "text":
      return <p className={styles.text}>{part.text}</p>
    case "reasoning":
      return <details className={styles.partCard}><summary>Reasoning summary</summary><p>{part.text}</p>{meta}</details>
    case "citation":
      return <aside className={styles.partCard}><strong>{part.title}</strong><p>{part.attribution ?? part.locator ?? part.sourceRef}</p>{meta}</aside>
    case "tool":
      return (
        <aside className={styles.partCard} data-status={part.status}>
          <div className={styles.partTitle}><strong>{part.name}</strong><span>{part.status}</span></div>
          <pre>{JSON.stringify(part.args, null, 2)}</pre>
          {part.result ? <p>{part.result}</p> : null}
          {meta}
        </aside>
      )
    case "approval":
    case "interaction":
      return (
        <aside className={styles.hitlCard}>
          <div className={styles.partTitle}>
            <strong>{part.kind === "approval" ? "Approval required" : "Input required"}</strong>
            <span>{part.status}</span>
          </div>
          <p>Owner {part.ownerRef} · Version {part.expectedVersion}</p>
          <div className={styles.actions}>
            {part.allowedActions.map((action) => <button type="button" disabled key={action}>{action}</button>)}
          </div>
          <p className={styles.quiet}>The decision API is not available in Browser v3 yet. No action is simulated.</p>
          {meta}
        </aside>
      )
    case "plan":
      return (
        <aside className={styles.partCard}>
          <strong>Plan</strong>
          <ol>{part.steps.map((step) => <li key={step.stepRef}>{step.label} · {step.status}</li>)}</ol>
          {meta}
        </aside>
      )
    case "job":
    case "artifact":
      return (
        <aside className={styles.partCard}>
          <div className={styles.partTitle}><strong>{part.kind}</strong><span>{part.status}</span></div>
          <p>{part.ownerRef}</p>
          <pre>{JSON.stringify(part.safeMetadata, null, 2)}</pre>
          {meta}
        </aside>
      )
    case "cost":
      return (
        <aside className={styles.partCard}>
          <div className={styles.partTitle}><strong>Cost</strong><span>{part.status}</span></div>
          <p>{part.amount ?? "Pending"} {part.currencyOrCreditUnit ?? ""}</p>
          <p className={styles.quiet}>Freshness {part.freshness}</p>
          {meta}
        </aside>
      )
    case "notice":
    case "error":
      return (
        <aside className={part.kind === "error" ? styles.errorCard : styles.partCard}>
          <strong>{part.code}</strong><p>{part.message}</p><p className={styles.quiet}>{part.retryClass}</p>{meta}
        </aside>
      )
    case "unsupported":
      return <aside className={styles.errorCard}><strong>Unsupported part</strong><p>{part.originalKind}</p>{meta}</aside>
    default:
      return neverPart(part)
  }
}

function connectionLabel(state: ReferenceChatState): string {
  const connection = state.projection.connection
  switch (connection.kind) {
    case "idle": return "Idle"
    case "connecting": return "Connecting"
    case "live": return "Live"
    case "reconnecting": return "Reconnecting from the durable cursor"
    case "closed": return "Closed"
    case "auth_required": return "Sign in again"
    case "draining": return "Server is draining; reconnect is scheduled"
    case "repair_required": return "Snapshot repair required"
    case "contract_incompatible": return "Client upgrade required"
  }
}

export function ReferenceChatView(props: {
  readonly brandName: string
  readonly controller: ReferenceChatController
  readonly state: ReferenceChatState
}) {
  const [draft, setDraft] = useState("")
  const hasModel = (props.state.snapshot?.model_history.length ?? 0) > 0
  const commandPending = props.state.projection.command.state === "pending"
  const connected = props.state.projection.connection.kind === "live"
  const activeRun = props.state.projection.activeRunId !== null
  const sendDisabled = !hasModel || !connected || activeRun || commandPending || draft.trim().length === 0

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (sendDisabled) return
    const content = draft
    setDraft("")
    void props.controller.submit(content)
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Session Browser v3 reference</span>
          <h1>{props.brandName}</h1>
        </div>
        <div className={styles.status} data-connection={props.state.projection.connection.kind}>
          {connectionLabel(props.state)}
        </div>
      </header>

      <section className={styles.context} aria-label="Session context">
        <span>{props.state.sessionId ?? "No session selected"}</span>
        <span>{props.state.projection.activeRunState ?? "No active run"}</span>
        {activeRun ? (
          <button type="button" className={styles.stop} onClick={() => void props.controller.cancel()} disabled={commandPending}>
            Stop run
          </button>
        ) : null}
      </section>

      {props.state.failure ? (
        <section className={styles.failure} role="alert">
          <strong>{props.state.failure.code}</strong>
          <p>{props.state.failure.message}</p>
          <span>Action {props.state.failure.action} · Retry {props.state.failure.retryClass}</span>
        </section>
      ) : null}

      {props.state.projection.repair.required ? (
        <section className={styles.failure} role="status">
          Snapshot repair required · {props.state.projection.repair.reason}
        </section>
      ) : null}

      <section className={styles.thread} aria-label="Conversation">
        {props.state.phase === "loading" ? <p className={styles.empty}>Loading the complete snapshot…</p> : null}
        {props.state.phase === "not_found" ? <p className={styles.empty}>Session not found.</p> : null}
        {props.state.projection.messages.length === 0 && props.state.phase === "ready" ? (
          <p className={styles.empty}>This branch has no projected messages.</p>
        ) : null}
        {props.state.projection.messages.map((message) => (
          <article className={styles.message} data-role={message.role} data-status={message.status} key={message.id}>
            <div className={styles.messageMeta}>
              <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
              <span>{message.status}</span>
            </div>
            {message.parts.map((part) => <Part key={part.id} part={part} />)}
          </article>
        ))}
      </section>

      <form className={styles.composer} onSubmit={submit}>
        {!hasModel && props.state.phase === "ready" ? (
          <p className={styles.modelNotice}>A published default model option is required before the first message can be sent.</p>
        ) : null}
        <textarea
          aria-label="Message"
          maxLength={1_048_576}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={activeRun ? "Wait for or stop the active run" : "Message the assistant"}
          rows={3}
          value={draft}
        />
        <button type="submit" disabled={sendDisabled}>Send</button>
      </form>
    </main>
  )
}

export function ReferenceChat(props: {
  readonly brandName: string
  readonly initialSessionId?: string
}) {
  const client = useMemo(() => createSessionClient({
    transport: createBrowserSessionTransport(),
  }), [])
  const controller = useMemo(() => createReferenceChatController({
    client,
    trustedLocale: typeof document === "undefined" ? "en-US" : document.documentElement.lang || "en-US",
  }), [client])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [sessionInput, setSessionInput] = useState(props.initialSessionId ?? "")

  useEffect(() => {
    if (props.initialSessionId) void controller.open(props.initialSessionId)
    return () => controller.close()
  }, [controller, props.initialSessionId])

  if (state.phase === "idle") {
    return (
      <main className={styles.connectShell}>
        <span className={styles.eyebrow}>Session Browser v3 reference</span>
        <h1>{props.brandName}</h1>
        <p>Open an existing Session to verify typed snapshot, durable SSE, cancellation, and reconnect behavior.</p>
        <form onSubmit={(event) => {
          event.preventDefault()
          const sessionId = sessionInput.trim()
          if (!sessionId) return
          window.history.replaceState(window.history.state, "", `/?session=${encodeURIComponent(sessionId)}`)
          void controller.open(sessionId)
        }}>
          <input aria-label="Session ID" value={sessionInput} onChange={(event) => setSessionInput(event.target.value)} />
          <button type="submit" disabled={sessionInput.trim().length === 0}>Open session</button>
        </form>
        <p className={styles.quiet}>New-session model selection is intentionally unavailable until Platform publishes a default option.</p>
      </main>
    )
  }

  return <ReferenceChatView brandName={props.brandName} controller={controller} state={state} />
}
