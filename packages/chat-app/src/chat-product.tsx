"use client"

import {
  createAssetUploader,
  createLocalAssetRecoveryStore,
  type AssetAttachmentRef,
  type AssetUploadProgress,
} from "@kokoro/asset-client"
import { createSessionClient } from "@kokoro/session-client"
import type { ChatMediaCandidate, ChatMediaFailure, ChatPart, ChatProjectionMessage } from "@kokoro/chat-surface"
import rehypeHighlight from "rehype-highlight"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  type FormEvent,
  type ChangeEvent,
  isValidElement,
  type KeyboardEvent,
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { createBrowserSessionTransport } from "./browser-session-transport"
import { downloadCodeText } from "./code-download"
import {
  createChatController,
  type ChatController,
  type ChatState,
  type ModelOptionCatalog,
} from "./chat-controller"
import { createSessionCommandRecoveryStore } from "./command-recovery"
import {
  createComposerDraftStore,
  type ComposerDraft,
  type ComposerDraftStore,
} from "./composer-draft"
import { hasSubmittableComposerContent } from "./composer-content"
import { ConversationThread } from "./conversation-thread"
import { DEFAULT_CHAT_COPY, resolveChatCopy, type ChatProductCopy } from "./chat-copy"
import {
  sameConversationMessageRender,
  type ConversationMessageRenderProps,
} from "./message-render-policy"
import { createSessionOrganizer } from "./session-organizer"
import { SessionRail } from "./session-rail"
import styles from "./chat-product.module.css"

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
    if (typeof raw === "string" && raw.length > 0 && raw.length <= 256) return { id: raw, label: raw }
    const item = record(raw)
    const id = item?.id
    const label = item?.label
    return typeof id === "string" && id.length > 0 && id.length <= 256 &&
      typeof label === "string" && label.length > 0 && label.length <= 256
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
    return options === null ? null : { kind: "selection", multiple: value.multiple === true || type === "array", options }
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
  const required = new Set(Array.isArray(value.required)
    ? value.required.filter((item): item is string => typeof item === "string")
    : [])
  const fields: SafeFormField[] = []
  for (const [name, rawField] of Object.entries(properties)) {
    const field = record(rawField)
    if (
      field === null ||
      fields.length >= 64 ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(name)
    ) return null
    const label = typeof field.title === "string" && field.title.length > 0 && field.title.length <= 256 ? field.title : name
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

function safeHref(value: string | undefined): string | null {
  if (value === undefined || value.length > 4096) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" ? parsed.href : null
  } catch {
    return null
  }
}

function renderedText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(renderedText).join("")
  return isValidElement<{ children?: ReactNode }>(node) ? renderedText(node.props.children) : ""
}

function codeLanguage(node: ReactNode): string | null {
  const child = Array.isArray(node) && node.length === 1 ? node[0] : node
  if (!isValidElement<{ className?: string }>(child)) return null
  return /(?:^|\s)language-([A-Za-z0-9_+-]+)/u.exec(child.props.className ?? "")?.[1] ?? null
}

function CodeBlock(props: Readonly<{
  children?: ReactNode
  copy: Pick<ChatProductCopy, "copy" | "copied" | "downloadCode">
}>) {
  const [copied, setCopied] = useState(false)
  const language = codeLanguage(props.children)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(renderedText(props.children).replace(/\n$/u, ""))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }
  const text = renderedText(props.children).replace(/\n$/u, "")
  const download = (): void => downloadCodeText({ text, language, document, url: URL })
  return <div className={styles.codeBlock} data-language={language ?? "plain-text"}>
    <div className={styles.codeBlockHeader}>
      <span>{language ?? "Code"}</span>
      <div className={styles.codeBlockActions}>
        <button aria-live="polite" type="button" onClick={() => void copy()}>{copied ? props.copy.copied : props.copy.copy}</button>
        <button type="button" onClick={download}>{props.copy.downloadCode}</button>
      </div>
    </div>
    <pre>{props.children}</pre>
  </div>
}

export function MarkdownText(props: Readonly<{
  text: string
  copy?: Pick<ChatProductCopy, "copy" | "copied" | "downloadCode">
}>) {
  const copy = props.copy ?? DEFAULT_CHAT_COPY
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a: ({ href, children }) => {
            const safe = safeHref(href)
            return safe === null ? <span>{children}</span> : <a href={safe} rel="noreferrer noopener" target="_blank">{children}</a>
          },
          img: ({ src, alt }) => {
            const safe = safeHref(src)
            return safe === null
              ? <span>{alt ?? ""}</span>
              : <a href={safe} rel="noreferrer noopener" target="_blank">{alt?.trim() || safe}</a>
          },
          pre: ({ children }) => <CodeBlock copy={copy}>{children}</CodeBlock>,
        }}
      >{props.text}</ReactMarkdown>
    </div>
  )
}

function scalarSummary(metadata: Readonly<Record<string, unknown>>): readonly Readonly<{ label: string; value: string }>[] {
  const labels: Readonly<Record<string, string>> = {
    title: "Title",
    label: "Label",
    summary: "Summary",
    stage: "Stage",
    format: "Format",
    duration: "Duration",
  }
  return Object.entries(labels).flatMap(([key, label]) => {
    const value = metadata[key]
    return typeof value === "string" && value.length > 0 && value.length <= 512
      ? [{ label, value }]
      : []
  })
}

function SafeSummary(props: Readonly<{ metadata: Readonly<Record<string, unknown>> }>) {
  const rows = scalarSummary(props.metadata)
  if (rows.length === 0) return null
  return <dl className={styles.summaryList}>{rows.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

type ChatDecisionPort = Pick<ChatController, "decideAction" | "decidePlan">

function ActionPartCard(props: {
  readonly part: Extract<ChatPart, { kind: "approval" | "interaction" }>
  readonly runId: string | null
  readonly controller: ChatDecisionPort
  readonly disabled: boolean
  readonly copy: ChatProductCopy
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

  const decide = (decision: Parameters<ChatController["decideAction"]>[0]["decision"]): void => {
    if (props.runId !== null) void props.controller.decideAction({ runId: props.runId, part: props.part, decision })
  }
  const respond = (): void => {
    if (props.part.inputSchemaRef === undefined || schema === null) return
    const fields: Record<string, unknown> = {}
    if (schema.kind === "form") {
      for (const field of schema.fields) {
        const value = formValues[field.name]
        if (value === undefined || value === "") continue
        fields[field.name] = field.type === "number" ? Number(value) : value
      }
    }
    const interactionResponse = schema.kind === "text"
      ? { kind: "text" as const, payload: { text: response.trim() } }
      : schema.kind === "selection"
        ? { kind: "selection" as const, payload: { selected_option_ids: [...selectedOptionIds] } }
        : { kind: "form" as const, payload: { fields } }
    decide({ kind: "respond", payload: { input_schema_ref: props.part.inputSchemaRef, response: interactionResponse } })
  }
  const edit = (): void => {
    if (props.part.inputSchemaRef === undefined) return
    try {
      const edited = record(JSON.parse(editedInput) as unknown)
      if (edited === null) throw new Error("Edited input must be an object.")
      setEditError(null)
      decide({ kind: "edit", payload: { input_schema_ref: props.part.inputSchemaRef, edited_input: edited } })
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Edited input is invalid.")
    }
  }

  return (
    <aside className={styles.controlCard} aria-label={props.part.title}>
      <div className={styles.cardHeading}><span className={styles.controlDot} aria-hidden /><strong>{props.part.title}</strong><span>{props.part.status}</span></div>
      <p>{props.part.description}</p>
      {props.part.riskSummary ? <p className={styles.risk}>{props.part.riskSummary}</p> : null}
      {props.part.allowedActions.includes("approve") ? <label className={styles.riskCheck}><input checked={acknowledgedRisk} onChange={(event) => setAcknowledgedRisk(event.currentTarget.checked)} type="checkbox" /> I understand this action and its scope.</label> : null}
      {props.part.allowedActions.includes("edit") && props.part.inputSchemaRef ? <textarea aria-label="Edited action input" onChange={(event) => setEditedInput(event.target.value)} rows={5} value={editedInput} /> : null}
      {editError ? <p className={styles.inlineError} role="alert">{editError}</p> : null}
      {schema?.kind === "text" ? <textarea maxLength={schema.maxLength} onChange={(event) => setResponse(event.target.value)} rows={3} value={response} /> : null}
      {schema?.kind === "selection" ? <fieldset className={styles.fieldStack}><legend>Choose a response</legend>{schema.options.map((option) => <label key={option.id}><input checked={selectedOptionIds.includes(option.id)} name="interaction-selection" onChange={(event) => setSelectedOptionIds(schema.multiple ? event.currentTarget.checked ? [...selectedOptionIds, option.id] : selectedOptionIds.filter((id) => id !== option.id) : [option.id])} type={schema.multiple ? "checkbox" : "radio"} /> {option.label}</label>)}</fieldset> : null}
      {schema?.kind === "form" ? <fieldset className={styles.fieldStack}><legend>Response details</legend>{schema.fields.map((field) => <label key={field.name}><span>{field.label}</span>{field.type === "boolean" ? <select onChange={(event) => setFormValues({ ...formValues, [field.name]: event.target.value === "true" })} value={formValues[field.name] === undefined ? "" : String(formValues[field.name])}><option disabled value="">Select…</option><option value="true">Yes</option><option value="false">No</option></select> : field.type === "selection" ? <select onChange={(event) => setFormValues({ ...formValues, [field.name]: event.target.value })} value={String(formValues[field.name] ?? "")}><option disabled value="">Select…</option>{field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <input inputMode={field.type === "number" ? "decimal" : undefined} onChange={(event) => setFormValues({ ...formValues, [field.name]: event.target.value })} type="text" value={String(formValues[field.name] ?? "")} />}</label>)}</fieldset> : null}
      {invalidNumber ? <p className={styles.inlineError} role="alert">{props.copy.invalidNumber}</p> : null}
      {props.part.kind === "interaction" && props.part.allowedActions.includes("respond") && (props.part.inputSchemaRef === undefined || schema === null) ? <p className={styles.quiet} role="status">{props.copy.unsupportedInteraction}</p> : null}
      <div className={styles.actions}>
        {props.part.allowedActions.includes("approve") ? <button type="button" disabled={!canDecide || !acknowledgedRisk} onClick={() => decide({ kind: "approve", payload: { acknowledged_risk: true } })}>{props.copy.approve}</button> : null}
        {props.part.allowedActions.includes("reject") ? <button type="button" disabled={!canDecide} onClick={() => decide({ kind: "reject", payload: { reason_code: "user_rejected" } })}>{props.copy.reject}</button> : null}
        {props.part.allowedActions.includes("edit") && props.part.inputSchemaRef ? <button type="button" disabled={!canDecide || editedInput.trim().length === 0} onClick={edit}>{props.copy.submitEdit}</button> : null}
        {props.part.kind === "interaction" && props.part.allowedActions.includes("respond") && props.part.inputSchemaRef && schema !== null ? <button type="button" disabled={!canDecide || !canRespond} onClick={respond}>{props.copy.respond}</button> : null}
      </div>
    </aside>
  )
}

function PlanPartCard(props: {
  readonly part: Extract<ChatPart, { kind: "plan" }>
  readonly runId: string | null
  readonly controller: ChatDecisionPort
  readonly disabled: boolean
  readonly copy: ChatProductCopy
}) {
  const canDecide = props.runId !== null && props.part.status === "pending" && !props.disabled
  return <aside className={styles.controlCard}><div className={styles.cardHeading}><span className={styles.controlDot} aria-hidden /><strong>{props.copy.plan}</strong><span>{props.part.status}</span></div><p>{props.part.summary}</p><ol className={styles.planSteps}>{props.part.steps.map((step) => <li data-status={step.status} key={step.stepRef}><span>{step.label}</span><small>{step.status}</small></li>)}</ol><div className={styles.actions}>{props.part.allowedActions.includes("accept") ? <button type="button" disabled={!canDecide} onClick={() => props.runId === null ? undefined : void props.controller.decidePlan({ runId: props.runId, part: props.part, decision: { kind: "accept", payload: {} } })}>{props.copy.approve}</button> : null}{props.part.allowedActions.includes("reject") ? <button type="button" disabled={!canDecide} onClick={() => props.runId === null ? undefined : void props.controller.decidePlan({ runId: props.runId, part: props.part, decision: { kind: "reject", payload: { reason_code: "user_rejected" } } })}>{props.copy.reject}</button> : null}</div></aside>
}

function PlanProgressCard(props: Readonly<{
  part: Extract<ChatPart, { kind: "plan-progress" }>
  copy: ChatProductCopy
}>) {
  return <aside className={styles.productCard} data-kind="plan-progress"><div className={styles.cardHeading}><strong>{props.copy.planProgress}</strong><span>{props.part.lifecycle}</span></div><p>{props.part.summary}</p><ol className={styles.planSteps}>{props.part.steps.map((step) => <li data-status={step.status} key={step.stepRef}><span>{step.label}</span><small>{step.status}</small></li>)}</ol></aside>
}

function MediaOperationCard(props: Readonly<{
  part: Extract<ChatPart, { kind: "media-operation" }>
  copy: ChatProductCopy
}>) {
  const percent = props.part.progressBps / 100
  let terminal: ReactNode
  switch (props.part.state) {
    case "admission_pending":
    case "authorized":
    case "queued":
    case "active":
    case "finalizing":
    case "cancel_requested":
    case "reconciling":
      terminal = null
      break
    case "completed":
    case "partial":
    case "canceled":
      terminal = <p className={styles.quiet}>{props.copy.outcome}: {props.part.outcomeClass}</p>
      break
    case "failed":
      terminal = <><p className={styles.quiet}>{props.copy.outcome}: {props.part.outcomeClass}</p><OwnerFailure failure={props.part.failure} /></>
      break
    default:
      terminal = neverPart(props.part)
  }
  return <aside className={styles.productCard} data-kind="media-operation" data-state={props.part.state}>
    <div className={styles.cardHeading}><strong>{props.copy.mediaOperation}</strong><span>{props.part.state}</span></div>
    <dl className={styles.summaryList}>
      <div><dt>{props.copy.definition}</dt><dd>{props.part.definitionRef}</dd></div>
      <div><dt>{props.copy.definitionRevision}</dt><dd>{props.part.definitionRevisionRef}</dd></div>
      <div><dt>{props.copy.ownerVersion}</dt><dd>{props.part.ownerVersion}</dd></div>
      {props.part.costProjection === undefined ? null : <div><dt>{props.copy.costProjection}</dt><dd>{props.part.costProjection.costProjectionRef} · v{props.part.costProjection.ownerVersion}</dd></div>}
    </dl>
    <div aria-label={props.copy.mediaProgress} aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} className={styles.progress} role="progressbar"><span style={{ width: `${percent}%` }} /><small>{percent}%</small></div>
    <ol aria-label={props.copy.candidates} className={styles.candidateList}>{props.part.candidates.map((candidate) => <MediaCandidateCard candidate={candidate} copy={props.copy} key={candidate.candidateRef} />)}</ol>
    {terminal}
    <p className={styles.quiet}>{props.copy.lastUpdated} <time dateTime={props.part.updatedAt}>{props.part.updatedAt}</time></p>
  </aside>
}

function OwnerFailure(props: Readonly<{
  failure: ChatMediaFailure
}>) {
  return <p className={styles.ownerFailure} role="status"><strong>{props.failure.code}</strong>{props.failure.safeMessage === undefined ? null : <> · {props.failure.safeMessage}</>}<small>{props.failure.retryClass}</small></p>
}

function MediaCandidateCard(props: Readonly<{ candidate: ChatMediaCandidate; copy: ChatProductCopy }>) {
  const candidate = props.candidate
  let detail: ReactNode
  switch (candidate.state) {
    case "allocated":
    case "producing":
    case "output_received":
    case "validating":
    case "unknown":
    case "cancel_requested":
    case "canceled":
      detail = null
      break
    case "ready":
      detail = <dl className={styles.candidateDetails}><div><dt>{props.copy.finalArtifact}</dt><dd>{candidate.artifactRef}</dd></div><div><dt>{props.copy.artifactVersion}</dt><dd>{candidate.artifactVersionRef}</dd></div></dl>
      break
    case "restricted":
    case "failed":
      detail = <OwnerFailure failure={candidate.failure} />
      break
    default:
      detail = neverPart(candidate)
  }
  return <li data-state={candidate.state}>
    <div className={styles.candidateHeading}><strong>{candidate.candidateRef}</strong><span>{candidate.state}</span></div>
    <small>{props.copy.ownerVersion} {candidate.ownerVersion} · #{candidate.ordinal + 1}</small>
    {detail}
  </li>
}

function ArtifactCard(props: Readonly<{
  part: Extract<ChatPart, { kind: "artifact" }>
  copy: ChatProductCopy
}>) {
  let availability: ReactNode
  switch (props.part.availability) {
    case "processing":
    case "deleted":
      availability = null
      break
    case "ready":
      availability = <dl className={styles.summaryList}><div><dt>{props.copy.imageDetails}</dt><dd>{props.part.display.format} · {props.part.display.width} × {props.part.display.height}</dd></div><div><dt>{props.copy.byteSize}</dt><dd>{props.part.display.byteSize}</dd></div></dl>
      break
    case "restricted":
    case "unavailable":
      availability = <OwnerFailure failure={props.part.failure} />
      break
    default:
      availability = neverPart(props.part)
  }
  return <aside className={styles.productCard} data-kind="artifact" data-state={props.part.availability}>
    <div className={styles.cardHeading}><strong>{props.copy.artifact}</strong><span>{props.part.availability}</span></div>
    <dl className={styles.summaryList}><div><dt>{props.copy.finalArtifact}</dt><dd>{props.part.artifactRef}</dd></div><div><dt>{props.copy.artifactVersion}</dt><dd>{props.part.artifactVersionRef}</dd></div><div><dt>{props.copy.ownerVersion}</dt><dd>{props.part.ownerVersion}</dd></div><div><dt>{props.copy.mediaClass}</dt><dd>{props.part.mediaClass}</dd></div></dl>
    {availability}
    <p className={styles.quiet}>{props.copy.lastUpdated} <time dateTime={props.part.updatedAt}>{props.part.updatedAt}</time></p>
  </aside>
}

function CostCard(props: Readonly<{
  part: Extract<ChatPart, { kind: "cost" }>
  copy: ChatProductCopy
}>) {
  let cost: ReactNode
  switch (props.part.state) {
    case "pending":
      cost = <p className={styles.costAmount}>{props.copy.pending}</p>
      break
    case "estimated":
    case "final":
      cost = <p className={styles.costAmount}>{props.part.amount.amount} {props.part.amount.creditUnit}</p>
      break
    case "corrected":
      cost = <><p className={styles.costAmount}>{props.part.amount.amount} {props.part.amount.creditUnit}</p><p className={styles.quiet}>{props.copy.correction}: v{props.part.correctsOwnerVersion}</p></>
      break
    case "unavailable":
      cost = <p className={styles.ownerFailure} role="status">{props.part.safeReason}</p>
      break
    default:
      cost = neverPart(props.part)
  }
  return <aside className={styles.partCard} data-kind="cost" data-state={props.part.state}>
    <div className={styles.cardHeading}><strong>{props.copy.cost}</strong><span>{props.part.state}</span></div>
    {cost}
    <dl className={styles.summaryList}><div><dt>{props.copy.costProjection}</dt><dd>{props.part.costProjectionRef}</dd></div><div><dt>{props.copy.ownerVersion}</dt><dd>{props.part.ownerVersion}</dd></div><div><dt>{props.copy.freshness}</dt><dd>{props.part.freshness}</dd></div><div><dt>{props.copy.mediaOperation}</dt><dd>{props.part.mediaOperationRef}</dd></div></dl>
    <p className={styles.quiet}>{props.copy.lastUpdated} <time dateTime={props.part.updatedAt}>{props.part.updatedAt}</time></p>
  </aside>
}

function ToolPartCard(props: Readonly<{
  part: Extract<ChatPart, { kind: "tool" }>
  copy: ChatProductCopy
}>) {
  const displayAsError = props.part.isError === true || (props.part.isError === undefined && props.part.status === "error")
  return <aside className={displayAsError ? styles.errorCard : styles.partCard} data-result-error={props.part.isError} data-status={props.part.status}><div className={styles.cardHeading}><strong>{props.part.name}</strong><span>{props.part.status}</span></div><SafeSummary metadata={props.part.args} />{props.part.result === undefined ? null : <p>{props.part.result}</p>}{props.part.isError === true ? <p className={styles.quiet}>{props.copy.toolError}</p> : null}{props.part.truncated === true ? <p className={styles.quiet}>{props.copy.toolResultTruncated}</p> : null}</aside>
}

export function ChatPartView(props: {
  readonly part: ChatPart
  readonly runId: string | null
  readonly controller: ChatDecisionPort
  readonly disabled: boolean
  readonly copy: ChatProductCopy
}) {
  const { part } = props
  switch (part.kind) {
    case "text": return <MarkdownText copy={props.copy} text={part.text} />
    case "reasoning-summary": return <details className={styles.reasoning}><summary>{props.copy.reasoning}</summary><MarkdownText copy={props.copy} text={part.text} /></details>
    case "citation": {
      const href = safeHref(part.locator)
      return <aside className={styles.citation}><span aria-hidden>↗</span><div><strong>{href === null ? part.title : <a href={href} rel="noreferrer noopener" target="_blank">{part.title}</a>}</strong>{part.attribution ? <p>{part.attribution}</p> : null}</div></aside>
    }
    case "tool": return <ToolPartCard copy={props.copy} part={part} />
    case "approval":
    case "interaction": return <ActionPartCard {...props} part={part} />
    case "plan": return <PlanPartCard {...props} part={part} />
    case "plan-progress": return <PlanProgressCard copy={props.copy} part={part} />
    case "subagent": return <aside className={styles.partCard} data-kind="subagent"><div className={styles.cardHeading}><strong>{props.copy.subagent}</strong><span>{part.status}</span></div>{part.summary === undefined ? null : <p>{part.summary}</p>}</aside>
    case "media-operation": return <MediaOperationCard copy={props.copy} part={part} />
    case "artifact": return <ArtifactCard copy={props.copy} part={part} />
    case "cost": return <CostCard copy={props.copy} part={part} />
    case "notice": return <aside className={styles.partCard} data-severity={part.severity}><div className={styles.cardHeading}><strong>{part.code}</strong><span>{part.severity}</span></div><p>{part.message}</p>{part.retryClass === undefined ? null : <p className={styles.quiet}>{part.retryClass}</p>}</aside>
    case "error": return <aside className={styles.errorCard}><div className={styles.cardHeading}><strong>{part.code}</strong><span>{part.retryClass}</span></div><p>{part.message}</p></aside>
    case "unsupported": return <aside className={styles.errorCard}><strong>{props.copy.unsupportedPart}</strong><p>{part.safeFallback}</p></aside>
    default: return neverPart(part)
  }
}

function connectionLabel(state: ChatState, copy: ChatProductCopy): string {
  switch (state.projection.connection.kind) {
    case "idle": return copy.connectionIdle
    case "connecting": return copy.connectionConnecting
    case "live": return copy.connectionLive
    case "reconnecting": return copy.connectionReconnecting
    case "closed": return copy.connectionClosed
    case "auth_required": return copy.connectionAuthRequired
    case "draining": return copy.connectionDraining
    case "repair_required": return copy.connectionRepairRequired
    case "contract_incompatible": return copy.connectionUpgradeRequired
  }
}

function runLabel(state: ChatState, copy: ChatProductCopy): string {
  switch (state.projection.activeRunState) {
    case "launching": return copy.runLaunching
    case "running": return copy.runRunning
    case "paused": return copy.runPaused
    case "cancelling": return copy.runCancelling
    case "outcome_unknown": return copy.runUnknown
    case null: return copy.runIdle
  }
}

function messageText(message: ChatProjectionMessage): string {
  return message.parts.filter((part): part is Extract<ChatPart, { kind: "text" }> => part.kind === "text").map(({ text }) => text).join("\n\n")
}

function MessageActions(props: Readonly<{
  message: ChatProjectionMessage
  controller: ChatController
  disabled: boolean
  copy: ChatProductCopy
}>) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(() => messageText(props.message))
  const copyText = async (): Promise<void> => {
    const text = messageText(props.message)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }
  if (editing) return <div className={styles.inlineEditor}><textarea aria-label="Edit message" maxLength={1_048_576} onChange={(event) => setValue(event.target.value)} rows={4} value={value} /><div className={styles.actions}><button type="button" disabled={props.disabled || value.trim().length === 0} onClick={() => void props.controller.editMessage(props.message.id, value).then((applied) => { if (applied) setEditing(false) })}>{props.copy.saveEdit}</button><button type="button" onClick={() => setEditing(false)}>{props.copy.cancelEdit}</button></div></div>
  return <div className={styles.messageActions}>{messageText(props.message) ? <button type="button" onClick={() => void copyText()}>{copied ? props.copy.copied : props.copy.copy}</button> : null}{props.message.role === "user" ? <button type="button" disabled={props.disabled} onClick={() => setEditing(true)}>{props.copy.edit}</button> : <button type="button" disabled={props.disabled} onClick={() => void props.controller.regenerateMessage(props.message.id)}>{props.copy.regenerate}</button>}</div>
}

const ConversationMessageView = memo(function ConversationMessageView(
  props: ConversationMessageRenderProps,
) {
  return <article className={styles.message} data-role={props.message.role} data-status={props.message.status}>
    <div className={styles.messageMeta}><strong>{props.message.role === "user" ? props.copy.you : props.copy.assistant}</strong><span>{props.message.status}</span></div>
    {props.message.parts.map((part) => <ChatPartView controller={props.controller} copy={props.copy} disabled={props.commandPending} key={part.id} part={part} runId={props.message.runId} />)}
    <MessageActions controller={props.controller} copy={props.copy} disabled={props.mutationDisabled} message={props.message} />
  </article>
}, sameConversationMessageRender)

export function ChatView(props: {
  readonly brandName: string
  readonly controller: ChatController
  readonly state: ChatState
  readonly copy: ChatProductCopy
  readonly sessionId: string
  readonly draftStore?: ComposerDraftStore
  readonly assetUploader?: ReturnType<typeof createAssetUploader> | null
}) {
  const [composer, setComposerState] = useState<ComposerDraft>(() => props.draftStore?.load(props.sessionId) ?? {
    schemaVersion: 1 as const,
    sessionId: props.sessionId,
    revision: globalThis.crypto.randomUUID().replaceAll("-", ""),
    text: "",
    ...(props.state.selectedModelOptionRevisionRef === null
      ? {}
      : { modelOptionRevisionRef: props.state.selectedModelOptionRevisionRef }),
    ...(props.state.selectedEffort === null ? {} : { effort: props.state.selectedEffort }),
    updatedAt: Date.now(),
  })
  const composerRef = useRef(composer)
  const setComposer = (update: (current: ComposerDraft) => ComposerDraft): void => {
    const next = update(composerRef.current)
    composerRef.current = next
    setComposerState(next)
  }
  const reviseComposer = (input: Readonly<{
    text?: string
    modelOptionRevisionRef?: string
    effort?: string | null
  }> = {}): void => {
    setComposer((current) => {
      const modelOptionRevisionRef = input.modelOptionRevisionRef ?? current.modelOptionRevisionRef
      const effort = input.effort === undefined ? current.effort : input.effort
      return {
        schemaVersion: 1,
        sessionId: props.sessionId,
        revision: globalThis.crypto.randomUUID().replaceAll("-", ""),
        text: input.text ?? current.text,
        ...(modelOptionRevisionRef === undefined ? {} : { modelOptionRevisionRef }),
        ...(effort === null || effort === undefined ? {} : { effort }),
        updatedAt: Date.now(),
      }
    })
  }
  const [composing, setComposing] = useState(false)
  const [attachments, setAttachments] = useState<readonly Readonly<{
    id: string
    file: File
    status: "uploading" | "ready" | "failed"
    progress: AssetUploadProgress | null
    attachment: AssetAttachmentRef | null
  }>[]>([])
  const hasModel = props.state.selectedModelOptionRevisionRef !== null
  const commandPending = props.state.projection.command.state === "pending"
  const connected = props.state.projection.connection.kind === "live"
  const activeRun = props.state.projection.activeRunId !== null
  const attachmentPending = attachments.some(({ status }) => status !== "ready")
  const sendDisabled = !hasModel || !connected || activeRun || commandPending || attachmentPending ||
    !hasSubmittableComposerContent(composer.text, attachments)
  const branch = props.state.snapshot?.branches.find(({ branch_id }) => branch_id === props.state.projection.activeBranchId)
  const currentOption = props.state.chatCatalog?.options.find(({ modelOptionRevisionRef }) => modelOptionRevisionRef === props.state.selectedModelOptionRevisionRef)

  useEffect(() => {
    const timer = window.setTimeout(() => props.draftStore?.save(composer), 200)
    return () => window.clearTimeout(timer)
  }, [composer, props.draftStore])
  useEffect(() => () => {
    props.draftStore?.save(composerRef.current)
  }, [props.draftStore])
  useEffect(() => {
    const applied = props.state.appliedDraft
    if (applied?.sessionId !== props.sessionId || applied.revision !== composerRef.current.revision) return
    props.draftStore?.clear(props.sessionId, applied.revision)
    setComposer((current) => current.revision === applied.revision ? {
      schemaVersion: 1,
      sessionId: props.sessionId,
      revision: globalThis.crypto.randomUUID().replaceAll("-", ""),
      text: "",
      updatedAt: Date.now(),
    } : current)
  }, [props.draftStore, props.sessionId, props.state.appliedDraft])
  useEffect(() => {
    const selectedRef = composer.modelOptionRevisionRef
    if (selectedRef === undefined) return
    const selected = props.state.chatCatalog?.options.find(
      (option) => option.modelOptionRevisionRef === selectedRef && option.availability === "available",
    )
    if (selected === undefined) return
    props.controller.selectModelOption(selectedRef)
    if (composer.effort !== undefined && selected.supportedEfforts.includes(composer.effort)) {
      props.controller.selectEffort(composer.effort)
    }
  }, [composer.effort, composer.modelOptionRevisionRef, props.controller, props.state.chatCatalog])

  const beginUpload = (entry: Readonly<{ id: string; file: File }>): void => {
    const uploader = props.assetUploader ?? null
    if (uploader === null) return
    setAttachments((current) => current.map((candidate) => candidate.id === entry.id
      ? { ...candidate, status: "uploading", progress: null, attachment: null }
      : candidate))
    void uploader.upload(entry.file, {
      onProgress: (progress) => setAttachments((current) => current.map((candidate) => candidate.id === entry.id
        ? { ...candidate, progress }
        : candidate)),
    }).then((attachment) => {
      setAttachments((current) => current.map((candidate) => candidate.id === entry.id
        ? { ...candidate, status: "ready", attachment }
        : candidate))
      reviseComposer()
    }).catch(() => {
      setAttachments((current) => current.map((candidate) => candidate.id === entry.id
        ? { ...candidate, status: "failed", attachment: null }
        : candidate))
      reviseComposer()
    })
  }
  const attach = (event: ChangeEvent<HTMLInputElement>): void => {
    const remaining = Math.max(0, 8 - attachments.length)
    const additions = [...(event.target.files ?? [])].slice(0, remaining).map((file) => Object.freeze({
      id: globalThis.crypto.randomUUID(), file, status: "uploading" as const, progress: null, attachment: null,
    }))
    event.target.value = ""
    if (additions.length === 0) return
    setAttachments((current) => [...current, ...additions])
    reviseComposer()
    for (const addition of additions) beginUpload(addition)
  }

  const submitDraft = (): void => {
    if (sendDisabled) return
    const submitted = composerRef.current
    const content = submitted.text
    const ready = attachments.filter((entry): entry is typeof entry & { attachment: AssetAttachmentRef } => entry.attachment !== null)
    const sentAttachmentIds = new Set(ready.map(({ id }) => id))
    void props.controller.submit(content, ready.map(({ attachment }) => attachment), submitted.revision).then((applied) => {
      if (applied) {
        props.draftStore?.clear(props.sessionId, submitted.revision)
        setComposer((current) => current.revision === submitted.revision ? {
          schemaVersion: 1,
          sessionId: props.sessionId,
          revision: globalThis.crypto.randomUUID().replaceAll("-", ""),
          text: "",
          updatedAt: Date.now(),
        } : current)
        setAttachments((current) => current.filter(({ id }) => !sentAttachmentIds.has(id)))
      }
    })
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    submitDraft()
  }
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || composing || event.nativeEvent.isComposing) return
    event.preventDefault()
    submitDraft()
  }
  const mutationDisabled = activeRun || commandPending || !connected

  return <main className={styles.shell}>
    <header className={styles.header}><div><span className={styles.eyebrow}>{props.copy.workspaceLabel}</span><h1>{props.state.snapshot?.session.title ?? props.brandName}</h1></div><nav className={styles.headerNav} aria-label="Workspace"><a href="/account">{props.copy.account}</a></nav></header>
    <section className={styles.runBand} data-run={props.state.projection.activeRunState ?? "idle"} aria-live="polite"><div><span className={styles.liveDot} aria-hidden /><strong>{runLabel(props.state, props.copy)}</strong><small>{connectionLabel(props.state, props.copy)}</small></div><div className={styles.branchControls}><label><span>{props.copy.branch}</span><select aria-label={props.copy.switchBranch} disabled={mutationDisabled} onChange={(event) => void props.controller.activateBranch(event.target.value)} value={props.state.projection.activeBranchId ?? ""}>{props.state.snapshot?.branches.map((candidate, index) => <option key={candidate.branch_id} value={candidate.branch_id}>{candidate.branch_id === props.state.projection.activeBranchId ? `${props.copy.currentBranch} · ` : ""}${candidate.origin} ${index + 1}</option>)}</select></label>{branch ? <button type="button" disabled={mutationDisabled} onClick={() => void props.controller.forkBranch(branch.branch_id)}>{props.copy.forkBranch}</button> : null}{activeRun ? <button type="button" className={styles.stop} onClick={() => void props.controller.cancel()} disabled={commandPending}>{props.copy.stop}</button> : null}</div></section>
    {props.state.failure ? <section className={styles.failure} role="alert"><strong>{props.state.failure.message}</strong>{["refetch_snapshot", "refresh_grant", "retry_same_cursor", "poll_or_stream", "reconcile_receipt"].includes(props.state.failure.action) ? <button type="button" onClick={() => void props.controller.recover()}>{props.copy.refreshConversation}</button> : null}</section> : null}
    {props.state.projection.repair.required ? <section className={styles.repair} role="status">{props.copy.repairRequired}</section> : null}
    <ConversationThread
      copy={props.copy}
      isStreaming={activeRun}
      key={`${props.sessionId}:${props.state.projection.activeBranchId ?? "no-branch"}:${props.state.snapshot?.snapshot_watermark.cursor ?? "no-snapshot"}`}
      messages={props.state.projection.messages}
      phase={props.state.phase}
      renderMessage={(message) => <ConversationMessageView commandPending={commandPending} controller={props.controller} copy={props.copy} key={message.id} message={message} mutationDisabled={mutationDisabled} />}
    />
    {props.state.phase === "ready" ? <form className={styles.composer} onSubmit={submit}>
      <div className={styles.composerControls}>{props.state.chatCatalog ? <ModelOptionSelector catalog={props.state.chatCatalog} copy={props.copy} disabled={false} onChange={(value) => {
        props.controller.selectModelOption(value)
        const selected = props.state.chatCatalog?.options.find((option) => option.modelOptionRevisionRef === value)
        const effort = selected === undefined || selected.supportedEfforts.length === 0
          ? null
          : props.state.selectedEffort !== null && selected.supportedEfforts.includes(props.state.selectedEffort)
            ? props.state.selectedEffort
            : selected.supportedEfforts.includes("medium")
              ? "medium"
              : selected.supportedEfforts[0] ?? null
        reviseComposer({ modelOptionRevisionRef: value, effort })
      }} value={props.state.selectedModelOptionRevisionRef} /> : null}{currentOption && currentOption.supportedEfforts.length > 0 ? <label className={styles.compactSelector}><span>{props.copy.effort}</span><select onChange={(event) => {
        props.controller.selectEffort(event.target.value)
        reviseComposer({ effort: event.target.value })
      }} value={props.state.selectedEffort ?? ""}>{currentOption.supportedEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></label> : null}</div>
      {!hasModel && props.state.phase === "ready" ? <p className={styles.modelNotice}>{props.copy.modelRequired}</p> : null}
      {attachments.length > 0 ? <ul className={styles.attachments} aria-live="polite">{attachments.map((entry) => <li key={entry.id} data-status={entry.status}><span aria-hidden>◆</span><div><strong>{entry.file.name}</strong><small>{entry.status === "uploading" ? `${props.copy.uploadingFile} ${entry.progress === null ? "" : `${Math.round(entry.progress.uploadedBytes / entry.progress.totalBytes * 100)}%`}` : entry.status === "ready" ? props.copy.attachmentReady : props.copy.attachmentFailed}</small></div>{entry.status === "failed" ? <button type="button" onClick={() => beginUpload(entry)}>{props.copy.retryUpload}</button> : null}<button type="button" disabled={entry.status === "uploading"} onClick={() => { setAttachments((current) => current.filter(({ id }) => id !== entry.id)); reviseComposer() }}>{props.copy.removeAttachment}</button></li>)}</ul> : null}
      <div className={styles.composerBox}><textarea aria-describedby={activeRun ? "kokoro-active-run-draft" : undefined} aria-label={props.copy.messageLabel} maxLength={1_048_576} onChange={(event) => reviseComposer({ text: event.target.value })} onCompositionEnd={() => setComposing(false)} onCompositionStart={() => setComposing(true)} onKeyDown={onComposerKeyDown} placeholder={activeRun ? props.copy.activeRunPlaceholder : props.copy.messagePlaceholder} rows={3} value={composer.text} /><button type="submit" disabled={sendDisabled}>{commandPending ? props.copy.sending : props.copy.send}<span aria-hidden>↗</span></button></div>{activeRun ? <p className={styles.composerHint} id="kokoro-active-run-draft" role="status">{props.copy.draftWhileRunning}</p> : <p className={styles.composerHint}>Enter to send · Shift + Enter for a new line</p>}
      {props.assetUploader !== null && props.assetUploader !== undefined ? <label className={styles.attachButton} data-disabled={attachments.length >= 8}><input type="file" multiple disabled={attachments.length >= 8} onChange={attach} /><span aria-hidden>＋</span>{props.copy.attachFiles}</label> : null}
    </form> : null}
  </main>
}

export type ChatProductProps = Readonly<{
  bootstrap: Readonly<{ defaultProjectRef: string; modelOptionCatalogs: readonly ModelOptionCatalog[] }> | null
  brandName: string
  browserRuntimeScope: string
  csrfToken?: string
  initialSessionId?: string
  copy?: Partial<ChatProductCopy>
}>

export function ChatProduct(props: ChatProductProps) {
  const copy = useMemo(() => resolveChatCopy(props.copy), [props.copy])
  const chatCatalog = props.bootstrap?.modelOptionCatalogs.find(({ surfaceId }) => surfaceId === "chat") ?? null
  const client = useMemo(() => createSessionClient({ transport: createBrowserSessionTransport({ csrfToken: props.csrfToken }) }), [props.csrfToken])
  const commandRecoveryStore = useMemo(() => {
    if (typeof window === "undefined") return undefined
    try {
      return createSessionCommandRecoveryStore({
        storage: window.sessionStorage,
        scope: props.browserRuntimeScope,
        pruneOtherScopes: true,
      })
    } catch {
      return undefined
    }
  }, [props.browserRuntimeScope])
  const draftStore = useMemo(() => {
    if (typeof window === "undefined") return undefined
    try {
      return createComposerDraftStore({
        storage: window.sessionStorage,
        scope: props.browserRuntimeScope,
        pruneOtherScopes: true,
      })
    } catch {
      return undefined
    }
  }, [props.browserRuntimeScope])
  const controller = useMemo(() => createChatController({ client, trustedLocale: typeof document === "undefined" ? "en-US" : document.documentElement.lang || "en-US", chatCatalog, defaultProjectRef: props.bootstrap?.defaultProjectRef ?? null, ...(commandRecoveryStore === undefined ? {} : { commandRecoveryStore }) }), [chatCatalog, client, commandRecoveryStore, props.bootstrap?.defaultProjectRef])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const organizer = useMemo(() => createSessionOrganizer({ client, projectRef: props.bootstrap?.defaultProjectRef ?? null }), [client, props.bootstrap?.defaultProjectRef])
  const organizerState = useSyncExternalStore(organizer.subscribe, organizer.getSnapshot, organizer.getSnapshot)
  const [assetUploader, setAssetUploader] = useState<ReturnType<typeof createAssetUploader> | null>(null)

  useEffect(() => {
    const projectRef = props.bootstrap?.defaultProjectRef
    if (props.csrfToken === undefined || projectRef === undefined) return
    let uploader: ReturnType<typeof createAssetUploader> | null = null
    try {
      uploader = createAssetUploader({
        csrfToken: props.csrfToken,
        store: createLocalAssetRecoveryStore({
          storage: window.localStorage,
          scope: `${props.browserRuntimeScope}:${projectRef}`,
          pruneOtherScopes: true,
        }),
      })
    } catch {
      try {
        uploader = createAssetUploader({
          csrfToken: props.csrfToken,
          store: createLocalAssetRecoveryStore({
            storage: window.sessionStorage,
            scope: `${props.browserRuntimeScope}:${projectRef}`,
            pruneOtherScopes: true,
          }),
        })
      } catch {
        uploader = null
      }
    }
    setAssetUploader(uploader)
    return () => {
      uploader?.dispose()
      setAssetUploader((current) => current === uploader ? null : current)
    }
  }, [props.bootstrap?.defaultProjectRef, props.browserRuntimeScope, props.csrfToken])

  useEffect(() => {
    void (async () => {
      if (props.initialSessionId) await controller.open(props.initialSessionId)
      await controller.resumePendingCommand()
    })()
    return () => controller.close()
  }, [controller, props.initialSessionId])
  useEffect(() => {
    void organizer.load()
    return () => organizer.close()
  }, [organizer])

  const openSession = (sessionId: string): void => {
    window.history.replaceState(window.history.state, "", `/?session=${encodeURIComponent(sessionId)}`)
    void controller.open(sessionId)
  }
  const createSession = (): void => {
    void controller.create().then((sessionId) => {
      if (sessionId === null) return
      window.history.replaceState(window.history.state, "", `/?session=${encodeURIComponent(sessionId)}`)
      void organizer.refresh()
    })
  }
  const productAvailable = props.bootstrap !== null && chatCatalog !== null
  const rail = <SessionRail activeSessionId={state.sessionId} available={productAvailable && state.projection.command.state !== "pending"} brandName={props.brandName} controller={organizer} copy={copy} onNew={createSession} onOpen={openSession} state={organizerState} />

  if (state.phase === "idle") return <div className={styles.appShell}>{rail}<main className={styles.startShell}><span className={styles.startMark} aria-hidden>✦</span><span className={styles.eyebrow}>{props.brandName}</span><h1>{copy.startTitle}</h1><p>{copy.startDescription}</p><button type="button" disabled={!productAvailable || state.projection.command.state === "pending"} onClick={createSession}>{state.projection.command.state === "pending" ? copy.creatingChat : copy.newChat}</button>{!productAvailable ? <p className={styles.failure} role="status">{copy.unavailable}</p> : null}{state.failure ? <p className={styles.failure} role="alert">{state.failure.message}</p> : null}</main></div>
  return <div className={styles.appShell}>{rail}<ChatView key={`${props.browserRuntimeScope}:${state.sessionId ?? "unavailable"}`} assetUploader={assetUploader} brandName={props.brandName} controller={controller} copy={copy} draftStore={draftStore} sessionId={state.sessionId ?? "unavailable"} state={state} /></div>
}

function ModelOptionSelector(props: {
  readonly catalog: ModelOptionCatalog
  readonly value: string | null
  readonly disabled: boolean
  readonly onChange: (value: string) => void
  readonly copy: ChatProductCopy
}) {
  return <label className={styles.compactSelector}><span>{props.copy.model}</span><select aria-label={props.copy.model} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)} value={props.value ?? ""}>{props.value === null ? <option disabled value="">{props.copy.noModel}</option> : null}{props.catalog.options.map((option) => <option disabled={option.availability !== "available"} key={option.modelOptionRevisionRef} value={option.modelOptionRevisionRef}>{option.label}{option.badges.length > 0 ? ` · ${option.badges.join(", ")}` : ""}</option>)}</select></label>
}
