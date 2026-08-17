import "server-only";

import NextAuth from "next-auth";

import { createVerificationSender } from "./server/auth/email";
import { createAdminAuthOptions } from "./server/auth/options";
import { createTrustedAuthHandlers } from "./server/auth/route";
import { loadAdminConfig } from "./server/config/config";
import { createIamAuthAdapterClient } from "./server/iam/auth-adapter-client";
import { createWorkloadTransport } from "./server/iam/transport";
import { createAuthLogger } from "./server/logging/auth-logger";

const config = loadAdminConfig();
const authAdapterClient = createIamAuthAdapterClient(createWorkloadTransport(config.iam));
const runtime = NextAuth(createAdminAuthOptions(config, {
  authAdapterClient,
  ...(config.smtp === null ? {} : { sendVerificationRequest: createVerificationSender(config) }),
  logger: createAuthLogger(),
}));

export const handlers = createTrustedAuthHandlers(runtime.handlers, config.auth.url);
export const auth = runtime.auth;
export const signIn = runtime.signIn;
export const signOut = runtime.signOut;
