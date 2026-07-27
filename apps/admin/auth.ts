import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { authConfig } from "./auth.config";
import { operatorAdapter } from "@/lib/auth/adapter";
import {
  createAdminAuthClient,
  createAdminAuthTransport,
  type AdminAuthClient,
} from "@/lib/auth/client";
import { sendVerificationRequest } from "@/lib/auth/email";
import { logAuthEvent } from "@/lib/auth/events";
import { getEnv } from "@/lib/env";

const norm = (email: string): string => email.trim().toLowerCase();
let concreteAdminAuthClient: AdminAuthClient | undefined;

function getAdminAuthClient(): AdminAuthClient {
  if (concreteAdminAuthClient !== undefined) return concreteAdminAuthClient;
  const env = getEnv();
  concreteAdminAuthClient = createAdminAuthClient({
    transport: createAdminAuthTransport({
      gatewayUrl: env.KOKORO_GATEWAY_URL,
      proxySecret: env.KOKORO_ADMIN_PROXY_SECRET,
      environment: env.NODE_ENV,
      timeoutMs: 5_000,
    }),
  });
  return concreteAdminAuthClient;
}

const adminAuthClient: AdminAuthClient = {
  findOperatorByEmail: (email) => getAdminAuthClient().findOperatorByEmail(email),
  findOperatorById: (id) => getAdminAuthClient().findOperatorById(id),
  createVerificationToken: (value) => getAdminAuthClient().createVerificationToken(value),
  consumeVerificationToken: (value) => getAdminAuthClient().consumeVerificationToken(value),
  recordAuthEvent: (value) => getAdminAuthClient().recordAuthEvent(value),
};

const configuredMaxAge = Number(process.env.MAGIC_LINK_MAX_AGE);
const magicLinkMaxAge = Number.isSafeInteger(configuredMaxAge) && configuredMaxAge > 0 ? configuredMaxAge : 600;
const emailFrom = process.env.EMAIL_FROM?.trim() || "no-reply@kokoro.local";

// Node runtime：叠加 Platform Admin Auth Connect adapter + Nodemailer magic-link 到 edge-safe 基础 config。
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: operatorAdapter(adminAuthClient),
  providers: [
    Nodemailer({
      server: {},
      from: emailFrom,
      maxAge: magicLinkMaxAge,
      sendVerificationRequest,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // node 侧守门：仅 active 运营账号可发链接/登录（拒陌生邮箱在发信前就挡住），非 active 拒 + 留痕。
    async signIn({ user }) {
      const email = norm(user.email ?? "");
      if (!email) return false;
      const account = await adminAuthClient.findOperatorByEmail(email);
      if (!account || account.status !== "active") {
        await logAuthEvent(adminAuthClient, { email, event: "denied", reason: account ? "inactive" : "unknown" });
        return false;
      }
      return true;
    },
  },
  events: {
    async signIn({ user }) {
      if (user.email) await logAuthEvent(adminAuthClient, { email: norm(user.email), event: "signin" });
    },
    async signOut(message) {
      const email = "token" in message ? message.token?.email : undefined;
      if (email) await logAuthEvent(adminAuthClient, { email: norm(email), event: "signout" });
    },
  },
});
