import "server-only";

import type { Account, NextAuthConfig, User } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";

import type { AdminRuntimeConfig } from "../config/config";
import type { IamAuthAdapterClient } from "../iam/auth-adapter-client";
import { createIamAuthAdapter } from "./adapter";
import { sessionCookie } from "./cookie";
import type { SendVerificationRequest } from "./email";
import { safeAuthRedirect } from "./redirect";

export type AdminAuthOptionsDependencies = Readonly<{
  authAdapterClient: IamAuthAdapterClient;
  sendVerificationRequest?: SendVerificationRequest;
  logger: NonNullable<NextAuthConfig["logger"]>;
}>;

function activeAdministrator(user: User): boolean {
  return user.platformRole === "admin" && user.status === "active";
}

function verificationRequest(email: Readonly<{ verificationRequest?: boolean }> | undefined): boolean {
  return email?.verificationRequest === true;
}

function safeAccount(account: Account | null | undefined): boolean {
  return account === null || account === undefined || account.provider === "nodemailer";
}

export function createAdminAuthOptions(
  config: AdminRuntimeConfig,
  dependencies: AdminAuthOptionsDependencies,
): NextAuthConfig {
  const emailProvider = config.smtp === null ? [] : [Nodemailer({
    server: {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      ...(config.smtp.auth === null ? {} : { auth: { user: config.smtp.auth.user, pass: config.smtp.auth.password } }),
    },
    from: config.smtp.from,
    maxAge: config.magicLinkMaxAgeSeconds,
    ...(dependencies.sendVerificationRequest === undefined ? {} : { sendVerificationRequest: dependencies.sendVerificationRequest }),
  })];
  return {
    secret: config.auth.secret,
    trustHost: true,
    logger: dependencies.logger,
    adapter: createIamAuthAdapter(dependencies.authAdapterClient),
    session: { strategy: "database", maxAge: 28_800, updateAge: 3_600 },
    cookies: { sessionToken: sessionCookie(config.auth) },
    pages: {
      signIn: "/login",
      verifyRequest: "/auth/verify",
      error: "/auth/verify",
    },
    providers: emailProvider,
    callbacks: {
      signIn({ user, account, email }) {
        if (verificationRequest(email)) return true;
        return safeAccount(account) && activeAdministrator(user);
      },
      session({ session, user }) {
        if (!activeAdministrator(user)) throw new Error("admin authentication required");
        return {
          expires: session.expires,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            platformRole: user.platformRole,
            status: user.status,
          },
        };
      },
      redirect({ url, baseUrl }) {
        return safeAuthRedirect(url, baseUrl);
      },
    },
  };
}
