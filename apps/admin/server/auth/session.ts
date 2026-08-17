import "server-only";

import { cookies } from "next/headers";

import { auth } from "../../auth";
import { loadAdminConfig } from "../config/config";
import { createIamSessionClient } from "../iam/session-client";
import { createWorkloadTransport } from "../iam/transport";
import { createAdminSessionBoundary } from "./session-boundary";

const config = loadAdminConfig();
const boundary = createAdminSessionBoundary({
  config,
  loadSession: auth,
  loadCookies: cookies,
  sessionClient: createIamSessionClient(createWorkloadTransport(config.iam)),
});

export const requireAdminSession = boundary.requireAdminSession;
export const requireAdminCapability = boundary.requireAdminCapability;
export const requireIamActor = boundary.requireIamActor;
