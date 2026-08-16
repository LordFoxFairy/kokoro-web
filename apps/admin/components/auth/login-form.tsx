"use client";

import Link from "next/link";

import { useT } from "@/i18n/context";

export type LoginAction = (formData: FormData) => Promise<void>;

export function LoginForm({ action }: Readonly<{ action: LoginAction }>): React.ReactElement {
  const t = useT();

  return (
    <section className="auth-panel" aria-labelledby="login-heading">
      <div className="auth-brand" aria-label={`${t("app.name")} ${t("app.product")}`}>
        <span className="auth-brand-mark" aria-hidden="true">K</span>
        <span>
          <strong>{t("app.name")}</strong>
          <small>{t("app.product")}</small>
        </span>
      </div>
      <div className="auth-copy">
        <h1 id="login-heading">{t("auth.login.title")}</h1>
        <p>{t("auth.login.description")}</p>
      </div>
      <form action={action} className="auth-form">
        <label htmlFor="admin-email">{t("auth.login.email")}</label>
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          placeholder={t("auth.login.placeholder")}
          required
        />
        <button type="submit">{t("auth.login.submit")}</button>
      </form>
      <p className="auth-notice">{t("auth.login.notice")}</p>
    </section>
  );
}

export function VerificationState({ error: _error }: Readonly<{ error: string | null }>): React.ReactElement {
  void _error;
  const t = useT();

  return (
    <section className="auth-panel auth-panel-centered" aria-labelledby="verification-heading">
      <div className="auth-brand-mark auth-status-mark" aria-hidden="true">@</div>
      <div role="status" aria-live="polite">
        <h1 id="verification-heading">{t("auth.verify.title")}</h1>
        <p>{t("auth.verify.description")}</p>
      </div>
      <Link className="auth-back-link" href="/login">{t("auth.verify.back")}</Link>
    </section>
  );
}
