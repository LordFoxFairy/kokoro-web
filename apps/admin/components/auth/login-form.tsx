"use client";

import { LockOutlined, LoginOutlined, MailOutlined, SafetyCertificateFilled } from "@ant-design/icons";
import { Alert, Button, Input, Segmented } from "antd";
import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { useT } from "@/i18n/context";

export type LoginAction = (formData: FormData) => Promise<void>;

function SubmitButton({ mode }: Readonly<{ mode: "password" | "email" }>): React.ReactElement {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button
      aria-label={t(mode === "password" ? "auth.login.submit" : "auth.login.emailSubmit")}
      block
      htmlType="submit"
      icon={mode === "password" ? <LoginOutlined /> : <MailOutlined />}
      loading={pending}
      size="large"
      type="primary"
    >
      {t(mode === "password" ? "auth.login.submit" : "auth.login.emailSubmit")}
    </Button>
  );
}

export function LoginForm({ passwordAction, emailAction, emailEnabled = true, error = null }: Readonly<{
  passwordAction: LoginAction;
  emailAction: LoginAction;
  emailEnabled?: boolean;
  error?: string | null;
}>): React.ReactElement {
  const t = useT();
  const [mode, setMode] = useState<"password" | "email">("password");

  return (
    <section className="auth-panel" aria-labelledby="login-heading">
      <div className="auth-brand" aria-label={`${t("app.name")} ${t("app.product")}`}>
        <span className="auth-brand-mark" aria-hidden="true"><SafetyCertificateFilled /></span>
        <span>
          <strong>{t("app.name")}</strong>
          <small>{t("app.product")}</small>
        </span>
      </div>
      <div className="auth-copy">
        <h1 id="login-heading">{t("auth.login.title")}</h1>
        <p>{t("auth.login.description")}</p>
      </div>
      {emailEnabled ? (
        <Segmented
          aria-label={t("auth.login.method")}
          block
          className="auth-method"
          onChange={(value) => setMode(value as "password" | "email")}
          options={[
            { label: t("auth.login.passwordMethod"), value: "password", icon: <LockOutlined /> },
            { label: t("auth.login.emailMethod"), value: "email", icon: <MailOutlined /> },
          ]}
          value={mode}
        />
      ) : null}
      {error === null ? null : (
        <Alert
          className="auth-error"
          message={t(error === "unavailable" ? "auth.login.error.unavailable" : "auth.login.error.credentials")}
          role="alert"
          showIcon
          type="error"
        />
      )}
      <form action={mode === "password" ? passwordAction : emailAction} className="auth-form">
        <label htmlFor="admin-email">{t("auth.login.email")}</label>
        <Input
          prefix={<MailOutlined aria-hidden="true" />}
          id="admin-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          placeholder={t("auth.login.placeholder")}
          required
        />
        <div className="auth-method-fields">
          {mode === "password" ? (
            <div className="auth-password-fields">
            <label htmlFor="admin-password">{t("auth.login.password")}</label>
            <Input.Password
              prefix={<LockOutlined aria-hidden="true" />}
              id="admin-password"
              name="password"
              autoComplete="current-password"
              minLength={12}
              maxLength={128}
              required
            />
            </div>
          ) : (
            <p className="auth-method-description">{t("auth.login.emailDescription")}</p>
          )}
        </div>
        <SubmitButton mode={mode} />
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
