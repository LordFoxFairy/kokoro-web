"use client"

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"
import QRCode from "qrcode"

import styles from "./account-product.module.css"
export type LegalDocument = Readonly<{ label: string; href: string }>

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
  legalDocuments: readonly LegalDocument[]
}>

type SecurityOperation = "identity.enroll-totp" | "identity.disable-totp" | "identity.regenerate-recovery-codes"
type SecurityCeremonyState = Readonly<{
  operation: SecurityOperation
  flow: string
  step: "password" | "mfa" | "totp_confirmation" | "recovery_codes"
  challengeKind?: "totp" | "recovery"
  manualEntrySecret?: string
  otpauthUri?: string
  recoveryCodes?: readonly string[]
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

function SecuritySettings(props: Readonly<{
  prefix: string
  csrfToken: string
  onCompleted(): Promise<void>
}>) {
  const [ceremony, setCeremony] = useState<SecurityCeremonyState | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [qrCode, setQrCode] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    let active = true
    const uri = ceremony?.otpauthUri
    if (!uri) { setQrCode(""); return () => { active = false } }
    void QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 220 })
      .then((data) => { if (active) setQrCode(data) })
      .catch(() => { if (active) setQrCode("") })
    return () => { active = false }
  }, [ceremony?.otpauthUri])

  async function start(operation: SecurityOperation) {
    const flow = flowRef()
    setPending(true); setMessage(""); setAcknowledged(false)
    try {
      await prepare(props.prefix, props.csrfToken, operation, flow)
      setCeremony({ operation, flow, step: "password" })
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unavailable") }
    finally { setPending(false) }
  }

  async function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (ceremony === null) return
    const data = new FormData(event.currentTarget)
    const payload = ceremony.step === "password"
      ? { password: String(data.get("password") ?? "") }
      : { code: String(data.get("code") ?? "") }
    setPending(true); setMessage("")
    try {
      const result = await execute(props.prefix, props.csrfToken, ceremony.operation, ceremony.flow, payload)
      if (result.state === "mfa_required") {
        setCeremony({ ...ceremony, step: "mfa", challengeKind: result.challengeKind === "recovery" ? "recovery" : "totp" })
        setMessage(`Enter your ${result.challengeKind === "recovery" ? "recovery code" : "authenticator code"}.`)
      } else if (result.state === "totp_confirmation_required") {
        setCeremony({
          ...ceremony,
          step: "totp_confirmation",
          ...(typeof result.manualEntrySecret === "string" ? { manualEntrySecret: result.manualEntrySecret } : {}),
          ...(typeof result.otpauthUri === "string" ? { otpauthUri: result.otpauthUri } : {}),
        })
        setMessage(ceremony.operation === "identity.enroll-totp"
          ? "Scan the QR code, then confirm with the new authenticator code."
          : "Enter a current authenticator code to confirm disabling it.")
      } else if (result.state === "succeeded" && Array.isArray(result.recoveryCodes) && result.recoveryCodes.every((value) => typeof value === "string")) {
        setCeremony({ ...ceremony, step: "recovery_codes", recoveryCodes: result.recoveryCodes as string[] })
        setMessage("Save these recovery codes now. They will not be shown again.")
      } else if (result.state === "succeeded") {
        setCeremony(null); setMessage("Security settings updated.")
        await props.onCompleted()
      } else if (result.retry === "same_action") {
        setMessage("The update was committed, but its one-time response is still being recovered. Continue this same action.")
      } else {
        setMessage("This security ceremony must be restarted safely.")
        setCeremony(null)
      }
      event.currentTarget.reset()
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unavailable") }
    finally { setPending(false) }
  }

  async function copyRecoveryCodes() {
    if (!ceremony?.recoveryCodes) return
    try {
      await navigator.clipboard.writeText(ceremony.recoveryCodes.join("\n"))
      setMessage("Recovery codes copied. Keep them somewhere private.")
    } catch { setMessage("Copy failed. Download or save each code manually.") }
  }

  function downloadRecoveryCodes() {
    if (!ceremony?.recoveryCodes) return
    const url = URL.createObjectURL(new Blob([`${ceremony.recoveryCodes.join("\n")}\n`], { type: "text/plain" }))
    const link = document.createElement("a")
    link.href = url; link.download = "kokoro-recovery-codes.txt"; link.click()
    URL.revokeObjectURL(url)
  }

  async function closeRecoveryCodes() {
    if (!acknowledged) return
    setCeremony(null); setAcknowledged(false); setMessage("Recovery codes saved.")
    await props.onCompleted()
  }

  return <div className={styles.securitySettings}>
    <h3>Authenticator and recovery</h3>
    {ceremony === null ? <div className={styles.actionList}>
      <button className={styles.buttonSecondary} disabled={pending} onClick={() => void start("identity.enroll-totp")} type="button">Set up authenticator</button>
      <button className={styles.buttonSecondary} disabled={pending} onClick={() => void start("identity.regenerate-recovery-codes")} type="button">Generate new recovery codes</button>
      <button className={styles.dangerButton} disabled={pending} onClick={() => void start("identity.disable-totp")} type="button">Disable authenticator</button>
    </div> : ceremony.step === "recovery_codes" ? <div className={styles.recoveryPanel}>
      <p><strong>Recovery codes</strong></p>
      <ul className={styles.codeList}>{ceremony.recoveryCodes?.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
      <div className={styles.actionList}><button className={styles.buttonSecondary} onClick={() => void copyRecoveryCodes()} type="button">Copy codes</button><button className={styles.buttonSecondary} onClick={downloadRecoveryCodes} type="button">Download .txt</button></div>
      <label className={styles.legalAcceptance}><input checked={acknowledged} onChange={(event) => setAcknowledged(event.currentTarget.checked)} type="checkbox" /><span>I saved these codes in a private place.</span></label>
      <button className={styles.button} disabled={!acknowledged} onClick={() => void closeRecoveryCodes()} type="button">Done</button>
    </div> : <form className={styles.form} onSubmit={advance}>
      {ceremony.step === "password" ? <label>Current password<input autoComplete="current-password" name="password" required type="password" /></label> : null}
      {ceremony.step === "totp_confirmation" && ceremony.otpauthUri ? <div className={styles.enrollmentSecret}>
        {qrCode ? <img alt="Authenticator setup QR code" height="220" src={qrCode} width="220" /> : <p className={styles.quiet}>Preparing QR code…</p>}
        <p className={styles.quiet}>Manual setup key</p><code className={styles.manualSecret}>{ceremony.manualEntrySecret}</code>
      </div> : null}
      {ceremony.step !== "password" ? <label>{ceremony.challengeKind === "recovery" ? "Recovery code" : "Authenticator code"}<input autoComplete="one-time-code" inputMode="numeric" name="code" required /></label> : null}
      <div className={styles.actionList}><button disabled={pending} type="submit">{pending ? "Checking…" : "Continue"}</button><button className={styles.buttonSecondary} disabled={pending} onClick={() => setCeremony(null)} type="button">Cancel</button></div>
    </form>}
    <p className={styles.status} role="status">{message}</p>
  </div>
}

export function IdentityLaunch(props: Readonly<{
  brandName: string
  csrfToken: string
  mode: "register" | "verify"
  apiPrefix?: string
  transactionRef?: string
  legalDocuments?: readonly LegalDocument[]
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
    const password = String(data.get("password") ?? "")
    if (password !== String(data.get("passwordConfirmation") ?? "")) {
      setStatus("Passwords do not match.")
      setPending(false)
      return
    }
    try {
      await prepare(prefix, props.csrfToken, operation, flow)
      const result = await execute(prefix, props.csrfToken, operation, flow, {
        email: String(data.get("email") ?? ""), password,
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
        <label>Password<input autoComplete="new-password" minLength={15} name="password" required type="password" /></label>
        <p className={styles.quiet}>Use at least 15 characters.</p>
        <label>Confirm password<input autoComplete="new-password" minLength={15} name="passwordConfirmation" required type="password" /></label>
        {props.legalDocuments && props.legalDocuments.length > 0 ? <label className={styles.legalAcceptance}><input name="legalAccepted" required type="checkbox" value="yes" /><span>I agree to {props.legalDocuments.map((document, index) => <span key={document.href}>{index > 0 ? index === (props.legalDocuments?.length ?? 0) - 1 ? " and " : ", " : ""}<a href={document.href} rel="noreferrer noopener" target="_blank">{document.label}</a></span>)}.</span></label> : <p className={styles.unavailable} role="alert">Registration is unavailable until this Site publishes its legal documents.</p>}
      </> : <>
        {props.transactionRef === undefined ? <label>Verification reference<input name="transactionRef" required /></label> : null}
        <label>Verification secret<input autoComplete="one-time-code" minLength={32} name="transactionSecret" required /></label>
      </>}
      <button disabled={pending || props.mode === "register" && (!props.legalDocuments || props.legalDocuments.length === 0)} type="submit">{pending ? "Continuing…" : "Continue"}</button>
      <p className={styles.status} role="status">{status}</p>
    </form>
    <p className={styles.authNav}>{props.mode === "register" ? <>Already have an account? <a href="/login">Sign in</a></> : <>Ready to continue? <a href="/login">Sign in</a></>}</p>
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
            {preview.legalAcceptanceRequired ? <label className={styles.legalAcceptance}><input checked={redemptionAccepted} onChange={(event) => setRedemptionAccepted(event.currentTarget.checked)} type="checkbox" /><span>I agree to {preview.legalDocuments.map((document, index) => <span key={document.href}>{index > 0 ? index === preview.legalDocuments.length - 1 ? " and " : ", " : ""}<a href={document.href} rel="noreferrer noopener" target="_blank">{document.label}</a></span>)} for this redemption.</span></label> : null}
            <button className={styles.button} disabled={preview.legalAcceptanceRequired && !redemptionAccepted} onClick={() => { if (previewFlow) void effect("redemption.confirm", { previewFlowRef: previewFlow, legalAccepted: !preview.legalAcceptanceRequired || redemptionAccepted }) }} type="button">Confirm redemption</button>
          </div>}
      </section> : null}
      {dashboard.features.security ? <section className={styles.card}><h2>Security</h2>{dashboard.availability.security === "unavailable" ? <p className={styles.quiet}>Account security is temporarily unavailable.</p> : <><h3>Signed-in sessions</h3><ul className={styles.list}>{dashboard.sessions.map((session, index) => <li className={styles.row} key={`${session.createdAt}-${index}`}><strong>{session.deviceLabel}</strong> {session.current ? "(current)" : ""}<br/><span className={styles.quiet}>Last active {session.lastSeenAt}</span></li>)}</ul><button className={styles.buttonSecondary} onClick={() => void effect("identity.revoke-sessions", { target: "others" })} type="button">Sign out other sessions</button><SecuritySettings csrfToken={props.csrfToken} onCompleted={load} prefix={prefix} /></>}</section> : null}
      {dashboard.features.products ? <section className={styles.card}><h2>Products & entitlements</h2>{dashboard.availability.products === "unavailable" ? <p className={styles.quiet}>Products are temporarily unavailable.</p> : <ul className={styles.list}>{dashboard.products.map((product, index) => <li className={styles.row} key={`${product.safeLabel}-${index}`}><strong>{product.safeLabel}</strong><br/><span className={styles.quiet}>{product.state} · {product.kind}</span>{product.entitlements.map((item, itemIndex) => <div key={`${item.safeLabel}-${itemIndex}`}>{item.safeLabel}</div>)}</li>)}</ul>}</section> : null}
      {dashboard.features.credits ? <section className={styles.card}><h2>Credits</h2>{dashboard.availability.credits === "unavailable" ? <p className={styles.quiet}>Credits are temporarily unavailable.</p> : dashboard.credits.map((unit) => <div key={unit.unit}><h3>{unit.unit}</h3>{unit.buckets.map((bucket) => <p key={bucket.bucketClass}>{bucket.bucketClass}: <strong>{bucket.available}</strong> available</p>)}</div>)}</section> : null}
    </div> : null}
  </main>
}
