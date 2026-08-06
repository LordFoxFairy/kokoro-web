import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { createSessionClient } from "@kokoro/session-client";
import { createAguiPresentationDecoder } from "@kokoro/session-client/agui-presentation";
import {
  BROWSER_COMMAND_DIGEST_ALGORITHM,
  canonicalBrowserCommandDigestPreimage,
} from "@kokoro/session-client/contracts";

import { createBrowserHttpClient } from "./web-chat-credit-runtime-network.mjs";

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function jsonBody(response, errorCode) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
  } catch {
    throw new Error(errorCode);
  }
}

async function authenticateBrowser(http, state, auth) {
  const commonHeaders = { origin: state.publicOrigin, "sec-fetch-site": "same-origin" };
  const prepared = await http.request({
    path: "/api/auth/delivery-state",
    method: "POST",
    headers: { ...commonHeaders, "content-type": "application/json" },
    body: JSON.stringify({ flow: "login", email: auth.email, password: auth.password }),
  });
  if (prepared.status === 403) throw new Error("WEB_FIXTURE_AUTH_DELIVERY_FORBIDDEN");
  if (prepared.status !== 204) throw new Error("WEB_FIXTURE_AUTH_DELIVERY_REJECTED");
  const csrfResponse = await http.request({ path: "/api/auth/csrf", headers: { "sec-fetch-site": "same-origin" } });
  const csrf = csrfResponse.status === 200 ? jsonBody(csrfResponse, "WEB_FIXTURE_AUTH_CSRF_REJECTED") : null;
  if (!exactObject(csrf, ["csrfToken"]) || typeof csrf.csrfToken !== "string" || csrf.csrfToken.length < 16) {
    throw new Error("WEB_FIXTURE_AUTH_CSRF_REJECTED");
  }
  const form = new URLSearchParams({
    email: auth.email,
    password: auth.password,
    csrfToken: csrf.csrfToken,
    callbackUrl: `${state.publicOrigin}/`,
  }).toString();
  const signedIn = await http.request({
    path: "/api/auth/callback/credentials",
    method: "POST",
    headers: {
      ...commonHeaders,
      "content-type": "application/x-www-form-urlencoded",
      "x-auth-return-redirect": "1",
    },
    body: form,
  });
  const callback = signedIn.status === 200 ? jsonBody(signedIn, "WEB_FIXTURE_AUTH_CALLBACK_REJECTED") : null;
  if (!exactObject(callback, ["url"]) || typeof callback.url !== "string") {
    throw new Error("WEB_FIXTURE_AUTH_CALLBACK_REJECTED");
  }
  let callbackUrl;
  try {
    callbackUrl = new URL(callback.url);
  } catch {
    throw new Error("WEB_FIXTURE_AUTH_CALLBACK_REJECTED");
  }
  if (callbackUrl.origin !== state.publicOrigin) throw new Error("WEB_FIXTURE_AUTH_CALLBACK_REJECTED");
  const callbackError = callbackUrl.searchParams.get("error");
  if (callbackError === "CredentialsSignin") throw new Error("WEB_FIXTURE_AUTH_CREDENTIALS_REJECTED");
  if (callbackError !== null) throw new Error("WEB_FIXTURE_AUTH_CALLBACK_REJECTED");
  const sessionResponse = await http.request({ path: "/api/auth/session", headers: { "sec-fetch-site": "same-origin" } });
  const session = sessionResponse.status === 200 ? jsonBody(sessionResponse, "WEB_FIXTURE_AUTH_SESSION_REJECTED") : null;
  if (session === null || typeof session !== "object" || session.authState !== "authenticated") {
    throw new Error("WEB_FIXTURE_AUTH_SESSION_REJECTED");
  }
  return Object.freeze({ generatedSiteHostResolved: true });
}

function issueBrowserCsrf(secret) {
  const expiresAt = Math.floor(Date.now() / 1_000) + 900;
  const payload = `v1.${expiresAt}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

async function commandIdentity(operation, targets, effect) {
  const commandId = randomUUID().replaceAll("-", "");
  return Object.freeze({
    command_id: commandId,
    idempotency_key: `web:${commandId}`,
    digest_algorithm: BROWSER_COMMAND_DIGEST_ALGORITHM,
    request_digest: createHash("sha256").update(canonicalBrowserCommandDigestPreimage({
      operation,
      targets,
      effect,
    })).digest("hex"),
  });
}

export function createSessionTransport(http, state, browserCsrfToken) {
  const requestInput = (request) => ({
    path: `/api/session${request.path}`,
    method: request.method,
    headers: {
      ...request.headers,
      origin: state.publicOrigin,
      "sec-fetch-site": "same-origin",
      ...(request.method === "GET" ? {} : { "x-csrf-token": browserCsrfToken }),
      ...(request.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  return Object.freeze({
    async request(request) {
      const response = await http.request(requestInput(request));
      return Object.freeze({
        status: response.status,
        headers: response.headers,
        body: response.body.byteLength === 0 ? null : jsonBody(response, "WEB_FIXTURE_SESSION_RESPONSE_INVALID"),
      });
    },
    async stream(request) {
      const response = await http.stream(requestInput(request));
      return Object.freeze({ status: response.status, headers: response.headers, body: response.body });
    },
  });
}

function terminalPromise() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({ promise, resolve: resolvePromise, reject: rejectPromise });
}

function receiptApplied(response, operation, kind) {
  const receipt = response.command_receipt;
  if (
    (receipt.status !== "accepted" && receipt.status !== "applied") ||
    receipt.operation !== operation || receipt.payload.kind !== kind
  ) throw new Error("WEB_FIXTURE_SESSION_RECEIPT_INVALID");
  return receipt;
}

export async function createProductionJourneyRuntime(input) {
  const { state } = input;
  const http = createBrowserHttpClient(state);
  const browserCsrfSecret = await input.readExactMaterial("KOKORO_WEB_FIXTURE_BROWSER_CSRF_SECRET_FILE");
  const client = createSessionClient({
    transport: createSessionTransport(http, state, issueBrowserCsrf(browserCsrfSecret)),
    reconnectDelayMs: 100,
    reconnectMaxDelayMs: 1_000,
  });
  return Object.freeze({
    browser: Object.freeze({
      async authenticate(auth) {
        return authenticateBrowser(http, state, auth);
      },
      async readDashboard() {
        const response = await http.request({
          path: "/api/account/dashboard",
          headers: { "sec-fetch-site": "same-origin" },
        });
        if (response.status === 401) throw new Error("WEB_FIXTURE_DASHBOARD_AUTH_REJECTED");
        if (response.status !== 200) throw new Error("WEB_FIXTURE_DASHBOARD_HTTP_REJECTED");
        return jsonBody(response, "WEB_FIXTURE_DASHBOARD_RESPONSE_INVALID");
      },
    }),
    session: Object.freeze({
      async create(projectRef) {
        const effect = { project_ref: projectRef, context_policy: "standard" };
        const response = await client.createSession({
          command: await commandIdentity("create_session", {}, effect),
          ...effect,
        });
        const receipt = receiptApplied(response, "create_session", "session-created");
        if (receipt.payload.payload.context_policy !== "standard") {
          throw new Error("WEB_FIXTURE_SESSION_RECEIPT_INVALID");
        }
        return Object.freeze({
          sessionId: receipt.payload.payload.session_id,
          branchId: receipt.payload.payload.initial_branch_id,
          sessionVersion: receipt.payload.payload.session_version,
        });
      },
      open(sessionId) {
        const terminal = terminalPromise();
        let streamHandle;
        const ready = (async () => {
          const hydration = await client.hydrate(sessionId);
          if (hydration.kind !== "ready") throw new Error("WEB_FIXTURE_SESSION_HYDRATION_INVALID");
          const decoder = createAguiPresentationDecoder({
            grant: hydration.grant,
            snapshotAuthority: hydration.snapshotAuthority,
          });
          streamHandle = client.openPresentation({
            sessionId,
            resume: decoder.getResumeRequest,
            onFrame(frame) {
              const prepared = decoder.prepare(frame);
              const decoded = prepared.decoded;
              if (decoded.kind === "replay") {
                prepared.commit("replayed");
                return { kind: "replay" };
              }
              prepared.commit("applied");
              if (decoded.kind === "control") {
                return decoded.data.retryAfterMs === undefined
                  ? { kind: "draining" }
                  : { kind: "draining", retryAfterMs: decoded.data.retryAfterMs };
              }
              if (decoded.data.event.type === "RUN_FINISHED") terminal.resolve({ outcome: "completed" });
              if (decoded.data.event.type === "RUN_ERROR") terminal.reject(new Error("WEB_FIXTURE_SESSION_TERMINAL_FAILED"));
              return { kind: "durable" };
            },
            onConnection(connection) {
              if (["auth_required", "repair_required", "contract_incompatible"].includes(connection.kind)) {
                terminal.reject(new Error("WEB_FIXTURE_SESSION_STREAM_INVALID"));
              }
            },
          });
          await streamHandle.ready;
          return hydration;
        })();
        return Object.freeze({
          ready,
          terminal: terminal.promise,
          close() { streamHandle?.close(); },
        });
      },
      async submit(input) {
        const hydration = await input.stream.ready;
        const snapshot = hydration.snapshot;
        const effect = {
          expected_session_version: snapshot.session.version,
          branch_id: snapshot.session.active_branch_id,
          parent_message_id: snapshot.session.active_leaf_message_id ?? null,
          trusted_locale: "en-US",
          parts: [{
            schema_version: 1,
            kind: "text",
            payload: { text: "Reply with one short acknowledgement." },
          }],
          attachment_refs: [],
          model_option_revision_ref: input.modelOptionRevisionRef,
        };
        const body = Object.freeze({
          command: await commandIdentity("submit_message", { session_id: input.session.sessionId }, effect),
          ...effect,
        });
        const response = await client.submitMessage(input.session.sessionId, body);
        receiptApplied(response, "submit_message", "run-launch-created");
        return Object.freeze({
          logicalRequest: Object.freeze({ sessionId: input.session.sessionId, body }),
          receipt: response,
        });
      },
      async replay(logicalRequest) {
        return client.submitMessage(logicalRequest.sessionId, logicalRequest.body);
      },
      async waitForTerminalSnapshot(sessionId) {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const snapshot = await client.fetchSnapshot(sessionId);
          if (snapshot !== null) {
            const userMessageCount = snapshot.messages.filter((message) => message.role === "user").length;
            const assistantTerminalCount = snapshot.messages.filter((message) =>
              message.role === "assistant" && message.lifecycle === "completed").length;
            const costSettled = snapshot.costs.length === 1 &&
              snapshot.costs.every((cost) => cost.cost_status === "settled") &&
              snapshot.runs.length === 1 &&
              snapshot.runs.every((run) => run.execution_status === "completed");
            if (userMessageCount === 1 && assistantTerminalCount === 1 && costSettled) {
              return Object.freeze({ userMessageCount, assistantTerminalCount, costSettled });
            }
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        throw new Error("WEB_FIXTURE_SESSION_TERMINAL_TIMEOUT");
      },
    }),
  });
}

export function admitDashboard(value) {
  if (
    !exactObject(value, ["features", "availability", "sessions", "products", "credits", "freshness"]) ||
    !exactObject(value.features, ["security", "redemption", "products", "credits"]) ||
    Object.values(value.features).some((item) => typeof item !== "boolean") ||
    !exactObject(value.availability, ["security", "products", "credits"]) ||
    !Array.isArray(value.sessions) || !Array.isArray(value.products) || !Array.isArray(value.credits) ||
    !exactObject(value.freshness, ["products", "credits"])
  ) throw new Error("WEB_FIXTURE_DASHBOARD_SCHEMA_INVALID");
  for (const name of ["security", "products", "credits"]) {
    if (value.availability[name] !== "available") {
      throw new Error(`WEB_FIXTURE_DASHBOARD_${name.toUpperCase()}_UNAVAILABLE`);
    }
  }
  if (value.credits.length < 1 || value.credits.length > 64) {
    throw new Error("WEB_FIXTURE_DASHBOARD_CREDIT_INVALID");
  }
  const totals = new Map();
  for (const unit of value.credits) {
    if (
      !exactObject(unit, ["unit", "buckets"]) || typeof unit.unit !== "string" || unit.unit.length < 1 ||
      unit.unit.length > 128 || !Array.isArray(unit.buckets) || unit.buckets.length < 1 || unit.buckets.length > 64 ||
      totals.has(unit.unit)
    ) throw new Error("WEB_FIXTURE_DASHBOARD_CREDIT_INVALID");
    let available = 0n;
    let consumed = 0n;
    for (const bucket of unit.buckets) {
      if (
        !exactObject(bucket, ["bucketClass", "available", "held", "consumed", "expiredOrReversed"]) ||
        typeof bucket.bucketClass !== "string" || bucket.bucketClass.length < 1 || bucket.bucketClass.length > 128 ||
        [bucket.available, bucket.held, bucket.consumed, bucket.expiredOrReversed]
          .some((item) => typeof item !== "string" || !/^(?:0|[1-9][0-9]{0,39})$/u.test(item))
      ) throw new Error("WEB_FIXTURE_DASHBOARD_CREDIT_INVALID");
      available += BigInt(bucket.available);
      consumed += BigInt(bucket.consumed);
    }
    totals.set(unit.unit, Object.freeze({ available, consumed }));
  }
  const forbiddenKey = /internal|gateway|usage|receipt|credential|secret|token|(?:^|_)ref$/iu;
  const pending = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === null || typeof item !== "object") continue;
    for (const [key, child] of Object.entries(item)) {
      if (forbiddenKey.test(key)) throw new Error("WEB_FIXTURE_DASHBOARD_REFERENCE_LEAK");
      pending.push(child);
    }
  }
  return Object.freeze({ totals, internalReferenceLeakFree: true });
}
