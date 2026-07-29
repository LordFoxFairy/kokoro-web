"use client"

import { signIn } from "next-auth/react"
import { type FormEvent, useState } from "react"

import { MarketingTopBar } from "@/ui/marketing/marketing-top-bar"

import styles from "./login-panel.module.css"

export function PasswordLogin(props: Readonly<{ brandName: string; transactionRef?: string }>) {
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFailure(null)
    setPending(true)
    const fields = new FormData(event.currentTarget)
    const values = props.transactionRef === undefined
      ? { flow: "login", email: String(fields.get("email") ?? ""), password: String(fields.get("password") ?? "") }
      : { flow: "mfa", transactionRef: props.transactionRef, code: String(fields.get("code") ?? "") }
    try {
      const prepare = (advance: boolean) => fetch("/api/auth/delivery-state", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, ...(advance ? { advance: true } : {}) }),
      })
      const prepared = await prepare(false)
      if (!prepared.ok) throw new Error("Unable to prepare sign-in")
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await signIn("credentials", { ...values, redirect: false })
        const recoveryRequired = result?.error === "CredentialsSignin" &&
          (result as typeof result & { code?: string }).code === "delivery_recovery_required"
        if (recoveryRequired) {
          if (!(await prepare(true)).ok) throw new Error("Unable to prepare sign-in recovery")
          continue
        }
        if (result?.ok) {
          // Re-enter the server-owned login route so it can branch between the
          // pending MFA challenge and the authenticated workspace.
          window.location.assign("/login")
          return
        }
        throw new Error("Email, password, or verification code was rejected")
      }
      throw new Error("Sign-in recovery is still in progress. Continue again.")
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Sign-in is unavailable")
      setPending(false)
    }
  }

  return (
    <div className={styles.screen}>
      <MarketingTopBar brandName={props.brandName} />
      {failure ? <div className={styles.toast} role="alert">{failure}</div> : null}
      <div className={styles.stage}>
        <form className={styles.card} onSubmit={submit}>
          <h1 className={styles.title}>{props.transactionRef ? "Verify sign-in" : "Sign in"}</h1>
          <p className={styles.subtitle}>{props.transactionRef
            ? "Enter the verification code from your authenticator or a recovery code."
            : "Use the email and password for this account."}</p>
          {props.transactionRef === undefined ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Email</span>
                <input className={styles.input} autoComplete="email" maxLength={320} name="email" required type="email" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Password</span>
                <input className={styles.input} autoComplete="current-password" maxLength={1024} name="password" required type="password" />
              </label>
            </>
          ) : (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Verification code</span>
              <input className={styles.input} autoComplete="one-time-code" maxLength={64} name="code" required />
            </label>
          )}
          <button className={styles.primaryBtn} disabled={pending} type="submit">
            {pending ? "Continuing…" : "Continue"}<span className={styles.primaryArrow} aria-hidden>→</span>
          </button>
          {props.transactionRef === undefined ? <p className={styles.switchLine}>New here? <a href="/register">Create an account</a></p> : null}
        </form>
      </div>
    </div>
  )
}
