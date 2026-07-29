"use client"

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"

import styles from "./account-product.module.css"

type Features = Readonly<{ security: boolean; redemption: boolean; products: boolean; credits: boolean }>
type Dashboard = Readonly<{
  features: Features
  availability: Readonly<{ security: string; products: string; credits: string }>
  sessions: readonly Readonly<{ current: boolean; deviceLabel: string; createdAt: string; lastSeenAt: string; expiresAt: string; status: string }>[]
  products: readonly Readonly<{ safeLabel: string; kind: string; state: string; expiresAt: string | null; plan: null | Readonly<{ safeLabel: string }>; entitlements: readonly Readonly<{ safeLabel: string; state: string; expiresAt: string | null }>[] }>[]
  credits: readonly Readonly<{ unit: string; buckets: readonly Readonly<{ bucketClass: string; available: string; held: string; consumed: string; expiredOrReversed: string }>[] }>[]
  freshness: Readonly<{ products: string; credits: string }>
}>
type RedemptionPreview = Readonly<{
  state: "ready"
  product: string
  plan: string | null
  kind: string
  expiresAt: string
  term: Readonly<{ action: string; automaticRenewal: false; startsAt: string | null; endsAt: string | null }>
  entitlements: readonly Readonly<{ safeLabel: string; expiresAt: string | null }>[]
  credits: readonly Readonly<{ amount: string; unit: string; bucketClass: string; expiresAt: string | null }>[]
  legalAcceptanceRequired: boolean
}>

function flowRef(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return `launch-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`
}

function headers(csrfToken: string): HeadersInit {
  return { "content-type": "application/json", "x-kokoro-browser-csrf": csrfToken }
}

async function prepare(prefix: string, csrfToken: string, operation: string, flow: string): Promise<void> {
  const response = await fetch(`${prefix}/prepare`, {
    method: "POST", credentials: "same-origin", headers: headers(csrfToken),
    body: JSON.stringify({ operation, flowRef: flow }),
  })
  if (!response.ok) throw new Error("This action is temporarily unavailable.")
}

async function execute(prefix: string, csrfToken: string, operation: string, flow: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const invoke = (action: "execute" | "recover") => fetch(`${prefix}/${action}`, {
    method: "POST", credentials: "same-origin", headers: headers(csrfToken),
    body: JSON.stringify(action === "execute" ? { operation, flowRef: flow, ...payload } : { operation, flowRef: flow }),
  })
  const reconcile = () => ["identity.verify-email", "identity.revoke-sessions", "redemption.confirm"].includes(operation)
    ? invoke("recover")
    : invoke("execute")
  let response: Response
  try {
    response = await invoke("execute")
    if ([502, 503, 504].includes(response.status)) response = await reconcile()
  } catch { response = await reconcile() }
  if (!response.ok) throw new Error("The result is unavailable. Continue to reconcile the same action.")
  return await response.json() as Record<string, unknown>
}

export function IdentityLaunch(props: Readonly<{
  brandName: string
  csrfToken: string
  mode: "register" | "verify"
  apiPrefix?: string
  transactionRef?: string
}>) {
  const prefix = props.apiPrefix ?? "/api/account"
  const [status, setStatus] = useState("")
  const [pending, setPending] = useState(false)
  const automaticVerificationStarted = useRef(false)

  async function verify(transactionRef: string, transactionSecret: string) {
    setPending(true); setStatus("Verifying your email…")
    const flow = flowRef()
    try {
      await prepare(prefix, props.csrfToken, "identity.verify-email", flow)
      const result = await execute(prefix, props.csrfToken, "identity.verify-email", flow, { transactionRef, transactionSecret })
      setStatus(result.state === "verified" ? "Email verified. You can now sign in." : "Verification is still being reconciled. You can safely retry this link.")
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unavailable") }
    finally { setPending(false) }
  }

  useEffect(() => {
    if (props.mode !== "verify" || !props.transactionRef || automaticVerificationStarted.current || window.location.hash.length < 2) return
    automaticVerificationStarted.current = true
    const fragment = window.location.hash.slice(1)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`)
    let secret = ""
    try {
      const named = new URLSearchParams(fragment).get("transactionSecret")
      secret = named ?? decodeURIComponent(fragment)
    } catch { secret = "" }
    if (secret.length < 32 || secret.length > 2048) {
      setStatus("This verification link is incomplete. Paste the verification secret below or request a new email.")
      return
    }
    void verify(props.transactionRef, secret)
  // The ref makes this one-shot even under React Strict Mode; verify deliberately stays local to this ceremony.
  }, [props.mode, props.transactionRef])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true); setStatus("")
    const data = new FormData(event.currentTarget)
    if (props.mode === "verify") {
      await verify(props.transactionRef ?? String(data.get("transactionRef") ?? ""), String(data.get("transactionSecret") ?? ""))
      return
    }
    const operation = "identity.register"
    const flow = flowRef()
    try {
      await prepare(prefix, props.csrfToken, operation, flow)
      const result = await execute(prefix, props.csrfToken, operation, flow, {
        email: String(data.get("email") ?? ""), password: String(data.get("password") ?? ""),
        legalAccepted: data.get("legalAccepted") === "yes",
      })
      setStatus(result.state === "verification_pending" ? "Check your email to continue." : "Registration is still being reconciled. You can safely retry.")
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unavailable") }
    finally { setPending(false) }
  }

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true); setStatus("")
    const email = String(new FormData(event.currentTarget).get("email") ?? "")
    const flow = flowRef()
    try {
      await prepare(prefix, props.csrfToken, "identity.resend-verification", flow)
      await execute(prefix, props.csrfToken, "identity.resend-verification", flow, { email })
      setStatus("If that address has a pending account, a new verification email is on its way.")
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unavailable") }
    finally { setPending(false) }
  }
  return <main className={styles.shell}>
    <header className={styles.header}><div><p className={styles.quiet}>{props.brandName}</p><h1>{props.mode === "register" ? "Create your account" : "Verify your email"}</h1></div></header>
    <section className={styles.card}><form className={styles.form} onSubmit={submit}>
      {props.mode === "register" ? <>
        <label>Email<input autoComplete="email" name="email" required type="email" /></label>
        <label>Password<input autoComplete="new-password" minLength={12} name="password" required type="password" /></label>
        <label><input name="legalAccepted" required type="checkbox" value="yes" /> I accept this Site&apos;s published terms.</label>
      </> : <>
        {props.transactionRef === undefined ? <label>Verification reference<input name="transactionRef" required /></label> : null}
        <label>Verification secret<input autoComplete="one-time-code" minLength={32} name="transactionSecret" required /></label>
      </>}
      <button disabled={pending} type="submit">{pending ? "Continuing…" : "Continue"}</button>
      <p className={styles.status} role="status">{status}</p>
    </form>
    <hr />
    <form className={styles.form} onSubmit={resend}>
      <h2>Need a new verification email?</h2>
      <label>Email<input autoComplete="email" name="email" required type="email" /></label>
      <button disabled={pending} type="submit">Resend verification email</button>
    </form></section>
  </main>
}

export function AccountProduct(props: Readonly<{ brandName: string; csrfToken: string; apiPrefix?: string }>) {
  const prefix = props.apiPrefix ?? "/api/account"
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [status, setStatus] = useState("Loading account…")
  const [previewFlow, setPreviewFlow] = useState<string | null>(null)
  const [preview, setPreview] = useState<RedemptionPreview | null>(null)
  const [redemptionAccepted, setRedemptionAccepted] = useState(false)
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${prefix}/dashboard`, { credentials: "same-origin", cache: "no-store" })
      if (!response.ok) throw new Error()
      setDashboard(await response.json() as Dashboard); setStatus("")
    } catch { setStatus("Account information is temporarily unavailable.") }
  }, [prefix])
  useEffect(() => { void load() }, [load])

  async function effect(operation: string, payload: Record<string, unknown>) {
    const flow = flowRef(); setStatus("Working…")
    try { await prepare(prefix, props.csrfToken, operation, flow); const result = await execute(prefix, props.csrfToken, operation, flow, payload); setStatus(`Result: ${String(result.state ?? "updated")}`); await load(); return { flow, result } }
    catch (error) { setStatus(error instanceof Error ? error.message : "Unavailable"); return null }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = String(new FormData(event.currentTarget).get("code") ?? "")
    const output = await effect("redemption.preview", { code })
    if (output !== null && output.result.state === "ready") {
      setPreviewFlow(output.flow); setPreview(output.result as RedemptionPreview); setRedemptionAccepted(false)
    }
    event.currentTarget.reset()
  }

  return <main className={styles.shell}>
    <header className={styles.header}><div><p className={styles.quiet}>{props.brandName}</p><h1>Account</h1></div><a href="/">Back to workspace</a></header>
    <p className={styles.status} role="status">{status}</p>
    {dashboard ? <div className={styles.grid}>
      {dashboard.features.redemption ? <section className={styles.card}><h2>Redeem a code</h2>
        {preview === null ? <form className={styles.form} onSubmit={redeem}><label>Code<input autoComplete="off" name="code" required /></label><button type="submit">Preview</button></form>
          : <div><h3>{preview.product}</h3>
            <p>{preview.plan ? `Plan: ${preview.plan}. ` : ""}{preview.term.action === "none" ? "No subscription change." : `Subscription action: ${preview.term.action}.`} Automatic renewal: no.</p>
            {preview.term.startsAt ? <p>Starts {preview.term.startsAt}</p> : null}{preview.term.endsAt ? <p>Ends {preview.term.endsAt}</p> : null}
            {preview.entitlements.length > 0 ? <><h4>Entitlements</h4><ul>{preview.entitlements.map((item, index) => <li key={`${item.safeLabel}-${index}`}>{item.safeLabel}{item.expiresAt ? ` · expires ${item.expiresAt}` : ""}</li>)}</ul></> : null}
            {preview.credits.length > 0 ? <><h4>Credits</h4><ul>{preview.credits.map((item, index) => <li key={`${item.unit}-${item.bucketClass}-${index}`}>{item.amount} {item.unit} · {item.bucketClass}{item.expiresAt ? ` · expires ${item.expiresAt}` : ""}</li>)}</ul></> : null}
            {preview.legalAcceptanceRequired ? <label><input checked={redemptionAccepted} onChange={(event) => setRedemptionAccepted(event.currentTarget.checked)} type="checkbox" /> I accept the published terms for this redemption.</label> : null}
            <button className={styles.button} disabled={preview.legalAcceptanceRequired && !redemptionAccepted} onClick={() => { if (previewFlow) void effect("redemption.confirm", { previewFlowRef: previewFlow, legalAccepted: !preview.legalAcceptanceRequired || redemptionAccepted }) }} type="button">Confirm redemption</button>
          </div>}
      </section> : null}
      {dashboard.features.security ? <section className={styles.card}><h2>Security sessions</h2>{dashboard.availability.security === "unavailable" ? <p className={styles.quiet}>Session security is temporarily unavailable.</p> : <><ul className={styles.list}>{dashboard.sessions.map((session, index) => <li className={styles.row} key={`${session.createdAt}-${index}`}><strong>{session.deviceLabel}</strong> {session.current ? "(current)" : ""}<br/><span className={styles.quiet}>Last active {session.lastSeenAt}</span></li>)}</ul><button className={styles.buttonSecondary} onClick={() => void effect("identity.revoke-sessions", { target: "others" })} type="button">Sign out other sessions</button></>}</section> : null}
      {dashboard.features.products ? <section className={styles.card}><h2>Products & entitlements</h2>{dashboard.availability.products === "unavailable" ? <p className={styles.quiet}>Products are temporarily unavailable.</p> : <ul className={styles.list}>{dashboard.products.map((product, index) => <li className={styles.row} key={`${product.safeLabel}-${index}`}><strong>{product.safeLabel}</strong><br/><span className={styles.quiet}>{product.state} · {product.kind}</span>{product.entitlements.map((item, itemIndex) => <div key={`${item.safeLabel}-${itemIndex}`}>{item.safeLabel}</div>)}</li>)}</ul>}</section> : null}
      {dashboard.features.credits ? <section className={styles.card}><h2>Credits</h2>{dashboard.availability.credits === "unavailable" ? <p className={styles.quiet}>Credits are temporarily unavailable.</p> : dashboard.credits.map((unit) => <div key={unit.unit}><h3>{unit.unit}</h3>{unit.buckets.map((bucket) => <p key={bucket.bucketClass}>{bucket.bucketClass}: <strong>{bucket.available}</strong> available</p>)}</div>)}</section> : null}
    </div> : null}
  </main>
}
