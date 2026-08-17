import "server-only";

import { createTransport } from "nodemailer";
import type { NodemailerConfig } from "next-auth/providers/nodemailer";

import type { AdminRuntimeConfig } from "../config/config";

export type SendVerificationRequest = NodemailerConfig["sendVerificationRequest"];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function invalid(): never {
  throw new Error("invalid Magic Link delivery request");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createVerificationSender(config: AdminRuntimeConfig): SendVerificationRequest {
  if (config.smtp === null) throw new Error("email authentication is disabled");
  const smtp = config.smtp;
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    ...(smtp.auth === null
      ? {}
      : { auth: { user: smtp.auth.user, pass: smtp.auth.password } }),
  });
  return async ({ identifier, url, expires }) => {
    let callback: URL;
    try {
      callback = new URL(url);
    } catch {
      return invalid();
    }
    if (
      !emailPattern.test(identifier)
      || identifier.length > 320
      || callback.origin !== config.auth.url
      || callback.pathname !== "/api/auth/callback/nodemailer"
      || callback.username
      || callback.password
      || callback.hash
      || !Number.isFinite(expires.getTime())
    ) {
      return invalid();
    }
    const minutes = Math.max(1, Math.round(config.magicLinkMaxAgeSeconds / 60));
    const safeUrl = escapeHtml(callback.href);
    await transport.sendMail({
      to: identifier,
      from: smtp.from,
      subject: "Kokoro Admin sign-in link",
      text: `Open this sign-in link within ${minutes} minutes: ${callback.href}\nIf you did not request it, ignore this message.`,
      html: `<p>Open this sign-in link within <strong>${minutes} minutes</strong>:</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>If you did not request it, ignore this message.</p>`,
    });
  };
}
