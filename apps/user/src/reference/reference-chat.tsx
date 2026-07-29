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
  type ReferenceModelOptionCatalog,
  type ReferenceChatController,
  type ReferenceChatState,
} from "./reference-chat-controller"
import styles from "./reference-chat.module.css"

function neverPart(part: never): never {
  throw new Error(`Unreachable Chat part: ${JSON.stringify(part)}`)
}

type SafeFormField = Readonly<{
  name: string
  label: string
  type: "text" | "number" | "boolean" | "selection"
  required: boolean
  options: readonly Readonly<{ id: string; label: string }>[]
}>

type SafeInteractionSchema =
  | Readonly<{ kind: "text"; maxLength: number }>
  | Readonly<{ kind: "selection"; multiple: boolean; options: readonly Readonly<{ id: string; label: string }>[] }>
  | Readonly<{ kind: "form"; fields: readonly SafeFormField[] }>

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

function safeOptions(value: unknown): readonly Readonly<{ id: string; label: string }>[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return null
  const options = value.map((raw) => {
    if (typeof raw === "string" && raw.length > 0) return { id: raw, label: raw }
    const item = record(raw)
    const id = item?.id
    const label = item?.label
    return typeof id === "string" && id.length > 0 && typeof label === "string" && label.length > 0
      ? { id, label }
      : null
  })
  if (!options.every((option) => option !== null)) return null
  const safe = options as readonly Readonly<{ id: string; label: string }>[]
  return new Set(safe.map(({ id }) => id)).size === safe.length ? safe : null
}

function safeInteractionSchema(value: Readonly<Record<string, unknown>> | undefined): SafeInteractionSchema | null {
  if (value === undefined) return null
  const kind = value.kind ?? value.response_kind
  const type = value.type
  const enumOptions = safeOptions(value.options ?? value.enum)
  if (kind === "selection" || enumOptions !== null || type === "array") {
    const items = record(value.items)
    const options = enumOptions ?? safeOptions(items?.enum)
    if (options === null) return null
    return { kind: "selection", multiple: value.multiple === true || type === "array", options }
  }
  if (kind === "text" || type === "string") {
    const requestedMax = typeof value.maxLength === "number" && Number.isInteger(value.maxLength)
      ? value.maxLength
      : 1_048_576
    return { kind: "text", maxLength: Math.max(1, Math.min(requestedMax, 1_048_576)) }
  }
  if (kind !== "form" && type !== "object") return null
  const properties = record(value.properties ?? value.fields)
  if (properties === null) return null
  const required = new Set(Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === "string") : [])
  const fields: SafeFormField[] = []
  for (const [name, rawField] of Object.entries(properties)) {
    const field = record(rawField)
    if (field === null || fields.length >= 64) return null
    const label = typeof field.title === "string" && field.title.length > 0 ? field.title : name
    const options = safeOptions(field.options ?? field.enum) ?? []
    const fieldType = options.length > 0
      ? "selection" as const
      : field.type === "boolean"
        ? "boolean" as const
        : field.type === "number" || field.type === "integer"
          ? "number" as const
          : field.type === "string" || field.type === undefined
            ? "text" as const
            : null
    if (fieldType === null) return null
    fields.push({ name, label, type: fieldType, required: required.has(name), options })
  }
  return fields.length > 0 ? { kind: "form", fields } : null
}

function ActionPartCard(props: {
  readonly part: Extract<ChatPart, { kind: "approval" | "interaction" }>
  readonly runId: string | null
  readonly controller: ReferenceChatController
  readonly disabled: boolean
}) {
  const [acknowledgedRisk, setAcknowledgedRisk] = useState(false)
  const [response, setResponse] = useState("")
  const [selectedOptionIds, setSelectedOptionIds] = useState<readonly string[]>([])
  const [formValues, setFormValues] = useState<Readonly<Record<string, string | boolean>>>({})
  const [editedInput, setEditedInput] = useState(() => JSON.stringify(props.part.safeRequestSummary ?? {}, null, 2))
  const [editError, setEditError] = useState<string | null>(null)
  const canDecide = props.runId !== null && props.part.status === "pending" && !props.disabled
  const schema = props.part.kind === "interaction" ? safeInteractionSchema(props.part.safeInputSchema) : null
  const canRespond = schema?.kind === "text"
    ? response.trim().length > 0
    : schema?.kind === "selection"
      ? selectedOptionIds.length > 0
      : schema?.kind === "form"
        ? schema.fields.every((field) => {
            const value = formValues[field.name]
            if (field.required && (value === undefined || value === "")) return false
            return field.type !== "number" || value === undefined || value === "" || Number.isFinite(Number(value))
          })
        : false
  const invalidNumber = schema?.kind === "form" && schema.fields.some((field) => {
    const value = formValues[field.name]
    return field.type === "number" && value !== undefined && value !== "" && !Number.isFinite(Number(value))
  })
  const respond = (): void => {
    if (props.runId === null || props.part.inputSchemaRef === undefined || schema === null) return
    const formFields: Record<string, unknown> = {}
    if (schema.kind === "form") {
      for (const field of schema.fields) {
        const value = formValues[field.name]
        if (value === undefined || value === "") continue
        if (field.type !== "number") {
          formFields[field.name] = value
          continue
        }
        const numeric = Number(value)
        if (Number.isFinite(numeric)) formFields[field.name] = numeric
      }
    }
    const interactionResponse = schema.kind === "text"
      ? { kind: "text" as const, payload: { text: response.trim() } }
      : schema.kind === "selection"
        ? { kind: "selection" as const, payload: { selected_option_ids: [...selectedOptionIds] } }
        : {
            kind: "form" as const,
            payload: { fields: formFields },
          }
    void props.controller.decideAction({
      runId: props.runId,
      part: props.part,
      decision: { kind: "respond", payload: { input_schema_ref: props.part.inputSchemaRef, response: interactionResponse } },
    })
  }
  const edit = (): void => {
    if (props.runId === null || props.part.inputSchemaRef === undefined) return
    try {
      const parsed = JSON.parse(editedInput) as unknown
      const edited = record(parsed)
      if (edited === null) throw new Error("Edited input must be a JSON object.")
      setEditError(null)
      void props.controller.decideAction({
        runId: props.runId,
        part: props.part,
        decision: { kind: "edit", payload: { input_schema_ref: props.part.inputSchemaRef, edited_input: { ...edited } } },
      })
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Edited input is not valid JSON.")
    }
  }
  return (
    <aside className={styles.hitlCard}>
      <div className={styles.partTitle}>
        <strong>{props.part.title}</strong><span>{props.part.status}</span>
      </div>
      <p>{props.part.description}</p>
      {props.part.riskSummary ? <p><strong>Risk:</strong> {props.part.riskSummary}</p> : null}
      {props.part.safeRequestSummary ? <pre>{JSON.stringify(props.part.safeRequestSummary, null, 2)}</pre> : null}
      {props.part.kind === "approval" && props.part.allowedActions.includes("approve") ? (
        <label>
          <input
            checked={acknowledgedRisk}
            onChange={(event) => setAcknowledgedRisk(event.target.checked)}
            type="checkbox"
          /> I understand and accept the stated risk
        </label>
      ) : null}
      {props.part.allowedActions.includes("edit") && props.part.inputSchemaRef ? (
        <label className={styles.fieldStack}>
          <span>Edited request (JSON object)</span>
          <textarea aria-label={`Edited input for ${props.part.title}`} onChange={(event) => setEditedInput(event.target.value)} rows={5} value={editedInput} />
        </label>
      ) : null}
      {editError ? <p role="alert">{editError}</p> : null}
      {props.part.kind === "interaction" && props.part.allowedActions.includes("respond") && props.part.inputSchemaRef && schema?.kind === "text" ? (
        <textarea
          aria-label={`Response for ${props.part.title}`}
          maxLength={schema.maxLength}
          onChange={(event) => setResponse(event.target.value)}
          rows={3}
          value={response}
        />
      ) : null}
      {props.part.kind === "interaction" && props.part.allowedActions.includes("respond") && props.part.inputSchemaRef && schema?.kind === "selection" ? (
        <fieldset className={styles.fieldStack}>
          <legend>Choose {schema.multiple ? "one or more options" : "one option"}</legend>
          {schema.options.map((option) => <label key={option.id}>
            <input
              checked={selectedOptionIds.includes(option.id)}
              name={`interaction-${props.part.id}`}
              onChange={(event) => setSelectedOptionIds(event.target.checked
                ? schema.multiple ? [...selectedOptionIds, option.id] : [option.id]
                : selectedOptionIds.filter((id) => id !== option.id))}
              type={schema.multiple ? "checkbox" : "radio"}
            /> {option.label}
          </label>)}
        </fieldset>
      ) : null}
      {props.part.kind === "interaction" && props.part.allowedActions.includes("respond") && props.part.inputSchemaRef && schema?.kind === "form" ? (
        <fieldset className={styles.fieldStack}>
          <legend>Requested information</legend>
          {schema.fields.map((field) => <label key={field.name}>
            <span>{field.label}{field.required ? " (required)" : ""}</span>
            {field.type === "boolean" ? (
              <select onChange={(event) => setFormValues({ ...formValues, [field.name]: event.target.value === "true" })} value={formValues[field.name] === undefined ? "" : String(formValues[field.name])}>
                <option disabled value="">Select…</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : field.type === "selection" ? (
              <select onChange={(event) => setFormValues({ ...formValues, [field.name]: event.target.value })} value={String(formValues[field.name] ?? "")}>
                <option disabled value="">Select…</option>
                {field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            ) : (
              <input
                inputMode={field.type === "number" ? "decimal" : undefined}
                onChange={(event) => setFormValues({ ...formValues, [field.name]: event.target.value })}
                type="text"
                value={String(formValues[field.name] ?? "")}
              />
            )}
          </label>)}
        </fieldset>
      ) : null}
      {invalidNumber ? <p role="alert">Enter a valid finite number before responding.</p> : null}
      {props.part.kind === "interaction" && props.part.allowedActions.includes("respond") && (props.part.inputSchemaRef === undefined || schema === null) ? (
        <p className={styles.quiet} role="status">This interaction schema is unsupported by this client. Refresh or upgrade the client to respond safely.</p>
      ) : null}
      <div className={styles.actions}>
        {props.part.allowedActions.includes("approve") ? (
          <button
            type="button"
            disabled={!canDecide || !acknowledgedRisk}
            onClick={() => props.runId === null ? undefined : void props.controller.decideAction({
              runId: props.runId,
              part: props.part,
              decision: { kind: "approve", payload: { acknowledged_risk: true } },
            })}
          >Approve</button>
        ) : null}
        {props.part.allowedActions.includes("reject") ? (
          <button
            type="button"
            disabled={!canDecide}
            onClick={() => props.runId === null ? undefined : void props.controller.decideAction({
              runId: props.runId,
              part: props.part,
              decision: { kind: "reject", payload: { reason_code: "user_rejected" } },
            })}
          >Reject</button>
        ) : null}
        {props.part.allowedActions.includes("edit") && props.part.inputSchemaRef ? (
          <button type="button" disabled={!canDecide || editedInput.trim().length === 0} onClick={edit}>Submit edit</button>
        ) : null}
        {props.part.kind === "interaction" && props.part.allowedActions.includes("respond") && props.part.inputSchemaRef && schema !== null ? (
          <button
            type="button"
            disabled={!canDecide || !canRespond}
            onClick={respond}
          >Respond</button>
        ) : null}
      </div>
      <p className={styles.quiet}>Owner {props.part.ownerRef} · Version {props.part.expectedVersion}</p>
    </aside>
  )
}

function PlanPartCard(props: {
  readonly part: Extract<ChatPart, { kind: "plan" }>
  readonly runId: string | null
  readonly controller: ReferenceChatController
  readonly disabled: boolean
}) {
  const canDecide = props.runId !== null && props.part.status === "pending" && !props.disabled
  return (
    <aside className={styles.partCard}>
      <div className={styles.partTitle}><strong>Plan</strong><span>{props.part.status}</span></div>
      <p>{props.part.summary}</p>
      <ol>{props.part.steps.map((step) => <li key={step.stepRef}>{step.label} · {step.status}</li>)}</ol>
      <div className={styles.actions}>
        {props.part.allowedActions.includes("accept") ? <button type="button" disabled={!canDecide} onClick={() =>
          props.runId === null ? undefined : void props.controller.decidePlan({
            runId: props.runId, part: props.part, decision: { kind: "accept", payload: {} },
          })}>Accept</button> : null}
        {props.part.allowedActions.includes("reject") ? <button type="button" disabled={!canDecide} onClick={() =>
          props.runId === null ? undefined : void props.controller.decidePlan({
            runId: props.runId, part: props.part, decision: { kind: "reject", payload: { reason_code: "user_rejected" } },
          })}>Reject</button> : null}
      </div>
    </aside>
  )
}

function Part(props: {
  readonly part: ChatPart
  readonly runId: string | null
  readonly controller: ReferenceChatController
  readonly disabled: boolean
}) {
  const { part } = props
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
      return <ActionPartCard {...props} part={part} />
    case "plan":
      return <PlanPartCard {...props} part={part} />
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
  const hasModel = props.state.selectedModelOptionRevisionRef !== null
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
            {message.parts.map((part) => <Part
              controller={props.controller}
              disabled={commandPending}
              key={part.id}
              part={part}
              runId={message.runId}
            />)}
          </article>
        ))}
      </section>

      <form className={styles.composer} onSubmit={submit}>
        {props.state.chatCatalog ? (
          <ModelOptionSelector
            catalog={props.state.chatCatalog}
            disabled={activeRun || commandPending}
            onChange={(value) => props.controller.selectModelOption(value)}
            value={props.state.selectedModelOptionRevisionRef}
          />
        ) : null}
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
  readonly bootstrap: Readonly<{
    readonly defaultProjectRef: string
    readonly modelOptionCatalogs: readonly ReferenceModelOptionCatalog[]
  }> | null
  readonly brandName: string
  readonly csrfToken?: string
  readonly initialSessionId?: string
}) {
  const chatCatalog = props.bootstrap?.modelOptionCatalogs.find(({ surfaceId }) => surfaceId === "chat") ?? null
  const client = useMemo(() => createSessionClient({
    transport: createBrowserSessionTransport({ csrfToken: props.csrfToken }),
  }), [props.csrfToken])
  const controller = useMemo(() => createReferenceChatController({
    client,
    trustedLocale: typeof document === "undefined" ? "en-US" : document.documentElement.lang || "en-US",
    chatCatalog,
    defaultProjectRef: props.bootstrap?.defaultProjectRef ?? null,
  }), [chatCatalog, client, props.bootstrap?.defaultProjectRef])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [sessionInput, setSessionInput] = useState(props.initialSessionId ?? "")

  useEffect(() => {
    if (props.initialSessionId) void controller.open(props.initialSessionId)
    return () => controller.close()
  }, [controller, props.initialSessionId])

  if (state.phase === "idle") {
    const productAvailable = props.bootstrap !== null && chatCatalog !== null
    const commandPending = state.projection.command.state === "pending"
    return (
      <main className={styles.connectShell}>
        <span className={styles.eyebrow}>Session Browser v3 reference</span>
        <h1>{props.brandName}</h1>
        <p>Start a new chat with this product&apos;s published default, or open an existing Session.</p>
        <button
          type="button"
          disabled={!productAvailable || commandPending}
          onClick={() => void controller.create().then((sessionId) => {
            if (sessionId !== null) window.history.replaceState(window.history.state, "", `/?session=${encodeURIComponent(sessionId)}`)
          })}
        >{commandPending ? "Creating…" : "New chat"}</button>
        <form onSubmit={(event) => {
          event.preventDefault()
          const sessionId = sessionInput.trim()
          if (!sessionId) return
          window.history.replaceState(window.history.state, "", `/?session=${encodeURIComponent(sessionId)}`)
          void controller.open(sessionId)
        }}>
          <input aria-label="Session ID" value={sessionInput} onChange={(event) => setSessionInput(event.target.value)} />
          <button type="submit" disabled={!productAvailable || commandPending || sessionInput.trim().length === 0}>Open session</button>
        </form>
        {!productAvailable ? <p className={styles.quiet} role="status">Product context or its published chat catalog is unavailable. Chat is closed safely.</p> : null}
        {state.failure ? <p className={styles.failure} role="alert">{state.failure.code}: {state.failure.message}</p> : null}
      </main>
    )
  }

  return <ReferenceChatView brandName={props.brandName} controller={controller} state={state} />
}

function ModelOptionSelector(props: {
  readonly catalog: ReferenceModelOptionCatalog
  readonly value: string | null
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  return (
    <label className={styles.modelSelector}>
      <span>Model</span>
      <select
        aria-label="Model option"
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value ?? ""}
      >
        {props.value === null ? <option disabled value="">No available model option</option> : null}
        {props.catalog.options.map((option) => (
          <option
            disabled={option.availability !== "available"}
            key={option.modelOptionRevisionRef}
            value={option.modelOptionRevisionRef}
          >
            {option.label} · {option.inputModalities.join(", ")} → {option.outputModalities.join(", ")}
            {option.supportedEfforts.length > 0 ? ` · ${option.supportedEfforts.join(", ")}` : ""}
            {option.badges.length > 0 ? ` · ${option.badges.join(", ")}` : ""}
          </option>
        ))}
      </select>
    </label>
  )
}
