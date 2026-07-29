"use client";

import { signIn } from "next-auth/react";
import { type FormEvent, useState } from "react";

export function LoginForm(props: { readonly transactionRef?: string }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setPending(true);
    const fields = new FormData(event.currentTarget);
    const transactionRef = props.transactionRef;
    const values = transactionRef === undefined
      ? { flow: "login", email: String(fields.get("email") ?? ""), password: String(fields.get("password") ?? "") }
      : { flow: "mfa", transactionRef, code: String(fields.get("code") ?? "") };
    try {
      const prepare = (advance: boolean) => fetch("/api/auth/delivery-state", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, ...(advance ? { advance: true } : {}) }),
      });
      const prepared = await prepare(false);
      if (!prepared.ok) throw new Error("Unable to prepare sign-in");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await signIn("credentials", { ...values, redirect: false });
        const recoveryRequired = result?.error === "CredentialsSignin" &&
          (result as typeof result & { code?: string }).code === "delivery_recovery_required";
        if (recoveryRequired) {
          const advanced = await prepare(true);
          if (!advanced.ok) throw new Error("Unable to prepare sign-in recovery");
          continue;
        }
        if (result?.ok) { window.location.assign("/"); return; }
        throw new Error("Sign-in was rejected");
      }
      throw new Error("Sign-in recovery is still in progress; continue again");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Sign-in is unavailable");
      setPending(false);
    }
  }

  return <form onSubmit={submit}>
    {props.transactionRef === undefined ? <>
      <label>Email<input autoComplete="email" name="email" required type="email" /></label>
      <label>Password<input autoComplete="current-password" name="password" required type="password" /></label>
    </> : <label>Verification code<input autoComplete="one-time-code" name="code" required /></label>}
    <button disabled={pending} type="submit">{pending ? "Continuing…" : "Continue"}</button>
    {failure ? <p role="alert">{failure}</p> : null}
  </form>;
}
