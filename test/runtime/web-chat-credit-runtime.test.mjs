import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionClientError, createSessionClient } from "@kokoro/session-client";

import * as runtimeFixture from "../fixtures/web-chat-credit-runtime.mjs";
import {
  REQUIRED_RUNTIME_MATERIALS,
  createWebRuntimeObservation,
  runWebChatCreditRuntimeFixture,
  setupWebChatCreditRuntime,
} from "../fixtures/web-chat-credit-runtime.mjs";
import { createBrowserHttpClient } from "../fixtures/web-chat-credit-runtime-network.mjs";
import { createSessionTransport } from "../fixtures/web-chat-credit-runtime-journey.mjs";

const WEB_ROOT = new URL("../../", import.meta.url);

function fixtureEnvironment(privateDirectory) {
  return {
    KOKORO_WEB_FIXTURE_PRIVATE_DIR: privateDirectory,
    KOKORO_WEB_FIXTURE_SITE_ID: "site:web-chat-credit-runtime",
    KOKORO_WEB_FIXTURE_SITE_RELEASE_REF: "site:web-chat-credit-runtime:release:1",
    KOKORO_WEB_FIXTURE_SITE_PROJECT_BINDING_REF: "binding:web-chat-credit-runtime",
    KOKORO_WEB_FIXTURE_DEPLOYMENT_REF: "deployment:web-chat-credit-runtime",
    KOKORO_WEB_FIXTURE_WEB_ARTIFACT_DIGEST: "d".repeat(64),
    KOKORO_WEB_FIXTURE_CANDIDATE_HOST: "web-chat-credit.fixture.local",
    KOKORO_WEB_FIXTURE_PUBLIC_ORIGIN: "https://web-chat-credit.fixture.local:4343",
    KOKORO_WEB_FIXTURE_PRODUCT_AUDIENCE: "site-product",
    KOKORO_WEB_FIXTURE_PROJECT_REF: "project:web-chat-credit-runtime",
    KOKORO_WEB_FIXTURE_MODEL_OPTION_REVISION_REF: `model-option:sha256:${"a".repeat(64)}`,
  };
}

function runtimeMaterial(requirement) {
  if (requirement === "KOKORO_WEB_FIXTURE_UPSTREAM_ENDPOINTS_FILE") {
    return `${JSON.stringify({
      schemaVersion: 1,
      platformOrigin: "https://127.0.0.1:4100",
      sessionOrigin: "https://127.0.0.1:3900",
    })}\n`;
  }
  if (requirement === "KOKORO_WEB_FIXTURE_BROWSER_AUTH_FILE") {
    return `${JSON.stringify({
      schemaVersion: 1,
      email: "runtime-fixture@example.com",
      password: "runtime-fixture-password-at-least-32-characters",
    })}\n`;
  }
  if (requirement.endsWith("_CERT_FILE") || requirement.endsWith("_CA_FILE")) {
    return "-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----\n";
  }
  if (requirement.endsWith("_KEY_FILE")) {
    return "-----BEGIN PRIVATE KEY-----\nZml4dHVyZS1rZXk=\n-----END PRIVATE KEY-----\n";
  }
  return "runtime-fixture-private-material-at-least-32-characters";
}

test("setup generates and builds one independent Site candidate without the reference fixture", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-runtime-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  for (const requirement of REQUIRED_RUNTIME_MATERIALS) {
    const path = join(privateDirectory, `${requirement.toLowerCase()}.fixture`);
    await writeFile(path, runtimeMaterial(requirement), { mode: 0o600 });
    environment[requirement] = path;
  }

  const result = await setupWebChatCreditRuntime(environment);

  assert.deepEqual(Object.keys(result), [
    "schemaVersion",
    "kind",
    "siteId",
    "candidateHost",
    "publicOrigin",
    "candidateDirectory",
    "runtimeStateFile",
    "publicCertificateAuthorityFile",
    "chatPath",
    "sessionApiPrefix",
    "accountPath",
    "accountDashboardPath",
    "readiness",
    "missingRuntimeMaterials",
  ]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "web-chat-credit-runtime-setup");
  assert.equal(result.readiness, "ready_to_start");
  assert.deepEqual(result.missingRuntimeMaterials, []);
  assert.equal(result.chatPath, "/");
  assert.equal(result.sessionApiPrefix, "/api/session");
  assert.equal(result.accountPath, "/account");
  assert.equal(result.accountDashboardPath, "/api/account/dashboard");
  const publicAuthority = new X509Certificate(await readFile(result.publicCertificateAuthorityFile));
  assert.equal(publicAuthority.ca, true);
  assert.equal((await stat(join(result.candidateDirectory, ".next/standalone/server.js"))).isFile(), true);
  assert.equal((await stat(join(result.candidateDirectory, "src/app/api/session/[...path]/route.ts"))).isFile(), true);
  assert.equal((await stat(join(result.candidateDirectory, "src/app/api/account/[action]/route.ts"))).isFile(), true);
  assert.equal((await stat(join(result.candidateDirectory, "src/app/account/page.tsx"))).isFile(), true);

  const manifest = JSON.parse(await readFile(join(result.candidateDirectory, "package.json"), "utf8"));
  assert.equal(manifest.name, "@kokoro/web-chat-credit-runtime-site");
  assert.equal(JSON.stringify(manifest).includes("reference-site"), false);
  assert.equal(JSON.stringify(result).includes("apps/reference-site"), false);

  const state = JSON.parse(await readFile(result.runtimeStateFile, "utf8"));
  await Promise.all([
    writeFile(environment.KOKORO_WEB_FIXTURE_SITE_MTLS_CERT_FILE, await readFile(state.publicTlsCertificateFile), { mode: 0o600 }),
    writeFile(environment.KOKORO_WEB_FIXTURE_SITE_MTLS_KEY_FILE, await readFile(state.publicTlsKeyFile), { mode: 0o600 }),
    writeFile(environment.KOKORO_WEB_FIXTURE_PLATFORM_CA_FILE, await readFile(state.publicCertificateAuthorityFile), { mode: 0o600 }),
    writeFile(environment.KOKORO_WEB_FIXTURE_SESSION_CA_FILE, await readFile(state.publicCertificateAuthorityFile), { mode: 0o600 }),
  ]);
  const runtime = await runtimeFixture.serveWebChatCreditRuntime(environment);
  t.after(() => runtime.close());
  const publicAuthorityBytes = await readFile(result.publicCertificateAuthorityFile);
  const response = await new Promise((resolvePromise, rejectPromise) => {
    const request = httpsRequest({
      hostname: "127.0.0.1",
      port: Number(new URL(result.publicOrigin).port),
      path: "/api/health/live",
      method: "GET",
      servername: result.candidateHost,
      ca: publicAuthorityBytes,
      headers: { host: new URL(result.publicOrigin).host },
    }, (incoming) => {
      incoming.resume();
      incoming.once("end", () => resolvePromise(incoming.statusCode));
    });
    request.once("error", rejectPromise);
    request.end();
  });
  assert.equal(response, 204);
  const deliveryBody = JSON.stringify({
    flow: "login",
    email: "runtime-fixture@example.com",
    password: "runtime-fixture-password-at-least-32-characters",
  });
  const deliveryStatus = await new Promise((resolvePromise, rejectPromise) => {
    const request = httpsRequest({
      hostname: "127.0.0.1",
      port: Number(new URL(result.publicOrigin).port),
      path: "/api/auth/delivery-state",
      method: "POST",
      servername: result.candidateHost,
      ca: publicAuthorityBytes,
      headers: {
        host: new URL(result.publicOrigin).host,
        origin: result.publicOrigin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(deliveryBody)),
      },
    }, (incoming) => {
      incoming.resume();
      incoming.once("end", () => resolvePromise(incoming.statusCode));
    });
    request.once("error", rejectPromise);
    request.end(deliveryBody);
  });
  assert.equal(deliveryStatus, 204);
  const csrfResponse = await new Promise((resolvePromise, rejectPromise) => {
    const request = httpsRequest({
      hostname: "127.0.0.1",
      port: Number(new URL(result.publicOrigin).port),
      path: "/api/auth/csrf",
      method: "GET",
      servername: result.candidateHost,
      ca: publicAuthorityBytes,
      headers: { host: new URL(result.publicOrigin).host },
    }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.once("end", () => resolvePromise({
        status: incoming.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", rejectPromise);
    request.end();
  });
  assert.equal(csrfResponse.status, 200);
  const csrf = JSON.parse(csrfResponse.body);
  assert.equal(typeof csrf.csrfToken, "string");
  assert.ok(csrf.csrfToken.length >= 16);
  assert.deepEqual(runtime.record, {
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-serve",
    publicOrigin: result.publicOrigin,
    publicCertificateAuthorityFile: result.publicCertificateAuthorityFile,
    readiness: "ready",
  });
  await runtime.close();
});

test("setup reports the exact missing runtime material set without weakening the build", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-runtime-missing-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));

  const result = await setupWebChatCreditRuntime(fixtureEnvironment(privateDirectory), { buildCandidate: false });

  assert.equal(result.readiness, "runtime_material_required");
  assert.deepEqual(result.missingRuntimeMaterials, REQUIRED_RUNTIME_MATERIALS);
});

test("setup records only private file paths when every runtime material is present", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-runtime-ready-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  for (const requirement of REQUIRED_RUNTIME_MATERIALS) {
    const path = join(privateDirectory, `${requirement.toLowerCase()}.fixture`);
    await writeFile(path, runtimeMaterial(requirement), { mode: 0o600 });
    environment[requirement] = path;
  }

  const result = await setupWebChatCreditRuntime(environment, { buildCandidate: false });

  assert.equal(result.readiness, "ready_to_start");
  assert.deepEqual(result.missingRuntimeMaterials, []);
  const state = JSON.parse(await readFile(result.runtimeStateFile, "utf8"));
  assert.deepEqual(Object.keys(state), [
    "schemaVersion",
    "kind",
    "candidateDirectory",
    "candidateHost",
    "publicOrigin",
    "siteId",
    "siteReleaseRef",
    "siteProjectBindingRef",
    "deploymentRef",
    "webArtifactDigest",
    "productAudience",
    "projectRef",
    "modelOptionRevisionRef",
    "runtimeMaterialFiles",
    "publicCertificateAuthorityFile",
    "publicTlsCertificateFile",
    "publicTlsKeyFile",
    "observationFile",
  ]);
  assert.deepEqual(Object.keys(state.runtimeMaterialFiles), REQUIRED_RUNTIME_MATERIALS);
  assert.equal(JSON.stringify(result).includes("fixture\n"), false);
});

test("setup rejects malformed private runtime material before reporting start readiness", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-runtime-invalid-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  for (const requirement of REQUIRED_RUNTIME_MATERIALS) {
    const path = join(privateDirectory, `${requirement.toLowerCase()}.fixture`);
    await writeFile(
      path,
      requirement === "KOKORO_WEB_FIXTURE_UPSTREAM_ENDPOINTS_FILE" ? "{}\n" : runtimeMaterial(requirement),
      { mode: 0o600 },
    );
    environment[requirement] = path;
  }

  await assert.rejects(
    setupWebChatCreditRuntime(environment, { buildCandidate: false }),
    /WEB_FIXTURE_UPSTREAM_ENDPOINTS_INVALID/u,
  );
});

test("setup maps unexpected infrastructure errors to one bounded public code", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-runtime-diagnostic-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  await setupWebChatCreditRuntime(environment, { buildCandidate: false });

  await assert.rejects(
    setupWebChatCreditRuntime(environment, { buildCandidate: false }),
    (error) => {
      assert.equal(error.message, "WEB_FIXTURE_SETUP_FAILED");
      assert.equal(error.message.includes(privateDirectory), false);
      return true;
    },
  );
});

test("observe admits only a bounded owner-safe Web result", () => {
  const input = {
    generatedSiteHostResolved: true,
    browserSessionTurn: true,
    userMessageCount: 1,
    assistantTerminalCount: 1,
    accountDashboardReadCount: 2,
    availableDecreased: true,
    consumedIncreased: true,
    availableConsumedDeltaEqual: true,
    internalReferenceLeakFree: true,
  };
  const observation = createWebRuntimeObservation(input);

  assert.deepEqual(observation, {
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-observation",
    generatedSiteHostResolved: true,
    browserSessionTurn: true,
    userMessageCount: 1,
    assistantTerminalCount: 1,
    accountDashboardReadCount: 2,
    availableDecreased: true,
    consumedIncreased: true,
    availableConsumedDeltaEqual: true,
    internalReferenceLeakFree: true,
  });
  assert.throws(() => createWebRuntimeObservation({
    ...input,
    userMessageCount: 2,
  }), /WEB_FIXTURE_OBSERVATION_INVALID/u);
  assert.throws(() => createWebRuntimeObservation({
    ...input,
    internalGatewayRef: "gateway-secret-ref",
  }), /WEB_FIXTURE_OBSERVATION_INVALID/u);
});

test("the child entry accepts the package-manager argument separator", async () => {
  await assert.rejects(
    runWebChatCreditRuntimeFixture(["--", "serve"], {}),
    /WEB_FIXTURE_PRIVATE_DIR_INVALID/u,
  );
});

test("standalone preparation copies immutable Next static assets into the runnable artifact", async (t) => {
  assert.equal(typeof runtimeFixture.prepareStandaloneCandidate, "function");
  const candidateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-static-test-"));
  t.after(() => rm(candidateDirectory, { recursive: true, force: true }));
  await mkdir(join(candidateDirectory, ".next/static/chunks"), { recursive: true });
  await mkdir(join(candidateDirectory, ".next/standalone"), { recursive: true });
  await writeFile(join(candidateDirectory, ".next/static/chunks/runtime.js"), "fixture", "utf8");
  await writeFile(join(candidateDirectory, ".next/standalone/server.js"), "", "utf8");

  await runtimeFixture.prepareStandaloneCandidate(candidateDirectory);

  assert.equal(
    await readFile(join(candidateDirectory, ".next/standalone/.next/static/chunks/runtime.js"), "utf8"),
    "fixture",
  );
});

test("the loopback HTTPS proxy accepts only the generated Site Host", async (t) => {
  assert.equal(typeof runtimeFixture.startStrictPublicProxy, "function");
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-proxy-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  for (const requirement of REQUIRED_RUNTIME_MATERIALS) {
    const path = join(privateDirectory, `${requirement.toLowerCase()}.fixture`);
    await writeFile(path, runtimeMaterial(requirement), { mode: 0o600 });
    environment[requirement] = path;
  }
  const setup = await setupWebChatCreditRuntime(environment, { buildCandidate: false });
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  const upstream = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(request.headers.host);
  });
  await new Promise((resolvePromise, rejectPromise) => {
    upstream.once("error", rejectPromise);
    upstream.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => upstream.close(() => resolvePromise())));
  const upstreamAddress = upstream.address();
  assert.notEqual(upstreamAddress, null);
  assert.equal(typeof upstreamAddress, "object");

  const proxy = await runtimeFixture.startStrictPublicProxy({
    candidateHost: setup.candidateHost,
    publicOrigin: setup.publicOrigin,
    certificateFile: state.publicTlsCertificateFile,
    privateKeyFile: state.publicTlsKeyFile,
    upstreamPort: upstreamAddress.port,
  });
  t.after(() => proxy.close());

  const publicAuthority = await readFile(setup.publicCertificateAuthorityFile);
  async function request(host) {
    return new Promise((resolvePromise, rejectPromise) => {
      const request = httpsRequest({
        hostname: "127.0.0.1",
        port: new URL(setup.publicOrigin).port,
        path: "/health",
        method: "GET",
        servername: setup.candidateHost,
        ca: publicAuthority,
        headers: { host },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolvePromise({
          status: response.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      request.once("error", rejectPromise);
      request.end();
    });
  }

  const expectedHost = new URL(setup.publicOrigin).host;
  assert.deepEqual(await request(expectedHost), { status: 200, body: expectedHost });
  assert.deepEqual(await request("wrong.fixture.local:4343"), { status: 421, body: "" });
});

test("the browser fixture aborts a live SSE socket when the Session client closes", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-browser-abort-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  const setup = await setupWebChatCreditRuntime(environment, { buildCandidate: false });
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  let resolveUpstreamClosed;
  const upstreamClosed = new Promise((resolvePromise) => { resolveUpstreamClosed = resolvePromise; });
  const upstream = createServer((_request, response) => {
    response.once("close", resolveUpstreamClosed);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(": connected\n\n");
  });
  await new Promise((resolvePromise, rejectPromise) => {
    upstream.once("error", rejectPromise);
    upstream.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => {
    upstream.closeAllConnections?.();
    upstream.close(() => resolvePromise());
  }));
  const upstreamAddress = upstream.address();
  assert.notEqual(upstreamAddress, null);
  assert.equal(typeof upstreamAddress, "object");
  const proxy = await runtimeFixture.startStrictPublicProxy({
    candidateHost: setup.candidateHost,
    publicOrigin: setup.publicOrigin,
    certificateFile: state.publicTlsCertificateFile,
    privateKeyFile: state.publicTlsKeyFile,
    upstreamPort: upstreamAddress.port,
  });
  t.after(() => proxy.close());
  const client = createBrowserHttpClient(state);
  const controller = new AbortController();
  const response = await client.stream({ path: "/stream", signal: controller.signal });
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);

  controller.abort(new Error("fixture stream closed"));

  await Promise.race([
    upstreamClosed,
    new Promise((_resolvePromise, rejectPromise) => {
      setTimeout(() => rejectPromise(new Error("browser fixture did not close SSE upstream")), 500).unref();
    }),
  ]);
  await reader.cancel().catch(() => undefined);
});

test("the Session consumer reconnects when the strict proxy loses its upstream before SSE headers", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-proxy-sse-retry-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  const setup = await setupWebChatCreditRuntime(environment, { buildCandidate: false });
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  let requestCount = 0;
  const upstream = createServer((request, response) => {
    requestCount += 1;
    if (requestCount === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(": connected\n\n");
  });
  await new Promise((resolvePromise, rejectPromise) => {
    upstream.once("error", rejectPromise);
    upstream.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => {
    upstream.closeAllConnections?.();
    upstream.close(() => resolvePromise());
  }));
  const upstreamAddress = upstream.address();
  assert.notEqual(upstreamAddress, null);
  assert.equal(typeof upstreamAddress, "object");
  const proxy = await runtimeFixture.startStrictPublicProxy({
    candidateHost: setup.candidateHost,
    publicOrigin: setup.publicOrigin,
    certificateFile: state.publicTlsCertificateFile,
    privateKeyFile: state.publicTlsKeyFile,
    upstreamPort: upstreamAddress.port,
  });
  t.after(() => proxy.close());
  const connectionStates = [];
  const client = createSessionClient({
    transport: createSessionTransport(
      createBrowserHttpClient(state),
      state,
      "v1.1786032000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    ),
    reconnectDelayMs: 1,
    reconnectMaxDelayMs: 1,
    random: () => 0,
  });
  const handle = client.openPresentation({
    sessionId: "session-runtime",
    resume: () => ({
      queryCursor: "signed.cursor.0",
      headers: { "last-event-id": "signed.cursor.0" },
      cursorBinding: { cursor: "signed.cursor.0", sessionId: "session-runtime" },
    }),
    onFrame: () => ({ kind: "durable" }),
    onConnection: (connection) => connectionStates.push(connection.kind),
  });
  t.after(() => handle.close());

  await Promise.race([
    handle.ready,
    new Promise((_resolvePromise, rejectPromise) => {
      setTimeout(() => rejectPromise(new Error("Session SSE did not reconnect")), 1_000).unref();
    }),
  ]);

  assert.equal(requestCount, 2);
  assert.equal(connectionStates.includes("repair_required"), false);
  handle.close();
});

test("the production journey forwards Session cancellation to the browser transport", async () => {
  const controller = new AbortController();
  let forwardedSignal;
  const transport = createSessionTransport({
    async stream(input) {
      forwardedSignal = input.signal;
      return { status: 200, headers: new Headers(), body: null };
    },
  }, {
    publicOrigin: "https://web-chat-credit.fixture.local:4343",
  }, "v1.1786032000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

  await transport.stream({
    method: "GET",
    path: "/v1/sessions/session-1/events?after=signed.cursor.0",
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });

  assert.equal(forwardedSignal, controller.signal);
});

test("observe reads only the durable owner-safe result written by exercise", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-observe-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  for (const requirement of REQUIRED_RUNTIME_MATERIALS) {
    const path = join(privateDirectory, `${requirement.toLowerCase()}.fixture`);
    await writeFile(path, runtimeMaterial(requirement), { mode: 0o600 });
    environment[requirement] = path;
  }
  const setup = await setupWebChatCreditRuntime(environment, { buildCandidate: false });
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  const expected = createWebRuntimeObservation({
    generatedSiteHostResolved: true,
    browserSessionTurn: true,
    userMessageCount: 1,
    assistantTerminalCount: 1,
    accountDashboardReadCount: 2,
    availableDecreased: true,
    consumedIncreased: true,
    availableConsumedDeltaEqual: true,
    internalReferenceLeakFree: true,
  });
  await writeFile(state.observationFile, `${JSON.stringify(expected)}\n`, { mode: 0o600 });

  assert.deepEqual(await runWebChatCreditRuntimeFixture(["observe"], environment), expected);
  assert.equal(JSON.stringify(expected).includes("credit_micros"), false);
  assert.equal(JSON.stringify(expected).includes("gateway"), false);
});

function dashboard(available, consumed) {
  return {
    features: { security: true, redemption: false, products: true, credits: true },
    availability: { security: "available", products: "available", credits: "available" },
    sessions: [],
    products: [],
    credits: [{
      unit: "credit_micros",
      buckets: [{
        bucketClass: "grant",
        available: String(available),
        held: "0",
        consumed: String(consumed),
        expiredOrReversed: "0",
      }],
    }],
    freshness: { products: "current", credits: "current" },
  };
}

async function readyFixture(t, prefix) {
  const privateDirectory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  for (const requirement of REQUIRED_RUNTIME_MATERIALS) {
    const path = join(privateDirectory, `${requirement.toLowerCase()}.fixture`);
    await writeFile(path, runtimeMaterial(requirement), { mode: 0o600 });
    environment[requirement] = path;
  }
  await setupWebChatCreditRuntime(environment, { buildCandidate: false });
  return environment;
}

test("exercise closes login, dashboard, Session SSE terminal, replay, and Credit readback in order", async (t) => {
  assert.equal(typeof runtimeFixture.exerciseWebChatCreditRuntime, "function");
  const environment = await readyFixture(t, "kokoro-web-exercise-test-");
  const calls = [];
  const firstReceipt = { command: "submit", status: "applied" };
  let finishTerminal;
  const runtime = {
    browser: {
      async authenticate(auth) {
        calls.push("authenticate");
        assert.equal(auth.email, "runtime-fixture@example.com");
        return { generatedSiteHostResolved: true };
      },
      async readDashboard() {
        calls.push("dashboard");
        return calls.filter((call) => call === "dashboard").length === 1
          ? dashboard(100, 0)
          : dashboard(90, 10);
      },
    },
    session: {
      async create(projectRef) {
        calls.push("create");
        assert.equal(projectRef, "project:web-chat-credit-runtime");
        return { sessionId: "session-runtime", branchId: "branch-runtime", sessionVersion: 1 };
      },
      open(sessionId) {
        calls.push("open");
        assert.equal(sessionId, "session-runtime");
        const terminal = new Promise((resolvePromise) => { finishTerminal = resolvePromise; });
        return {
          ready: Promise.resolve().then(() => calls.push("stream-ready")),
          terminal: terminal.then((value) => {
            calls.push("stream-terminal");
            return value;
          }),
          close() { calls.push("stream-close"); },
        };
      },
      async submit(input) {
        calls.push("submit");
        assert.equal(input.modelOptionRevisionRef, `model-option:sha256:${"a".repeat(64)}`);
        finishTerminal({ outcome: "completed" });
        return { logicalRequest: { commandId: "same-command" }, receipt: firstReceipt };
      },
      async replay(logicalRequest) {
        calls.push("replay");
        assert.deepEqual(logicalRequest, { commandId: "same-command" });
        return firstReceipt;
      },
      async waitForTerminalSnapshot(sessionId) {
        calls.push("snapshot");
        assert.equal(sessionId, "session-runtime");
        return { userMessageCount: 1, assistantTerminalCount: 1, costSettled: true };
      },
    },
  };

  const result = await runtimeFixture.exerciseWebChatCreditRuntime(environment, { runtime });

  assert.deepEqual(result, createWebRuntimeObservation({
    generatedSiteHostResolved: true,
    browserSessionTurn: true,
    userMessageCount: 1,
    assistantTerminalCount: 1,
    accountDashboardReadCount: 2,
    availableDecreased: true,
    consumedIncreased: true,
    availableConsumedDeltaEqual: true,
    internalReferenceLeakFree: true,
  }));
  assert.deepEqual(calls, [
    "authenticate", "dashboard", "create", "open", "stream-ready", "submit",
    "stream-terminal", "stream-close", "replay", "snapshot", "dashboard",
  ]);
  assert.deepEqual(await runWebChatCreditRuntimeFixture(["observe"], environment), result);
});

test("exercise fails closed when any Account authority is unavailable", async (t) => {
  assert.equal(typeof runtimeFixture.exerciseWebChatCreditRuntime, "function");
  const environment = await readyFixture(t, "kokoro-web-dashboard-closed-test-");
  let sessionCreated = false;
  await assert.rejects(runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    runtime: {
      browser: {
        async authenticate() { return { generatedSiteHostResolved: true }; },
        async readDashboard() {
          return { ...dashboard(100, 0), availability: {
            security: "available", products: "unavailable", credits: "available",
          } };
        },
      },
      session: {
        async create() { sessionCreated = true; throw new Error("unexpected"); },
      },
    },
  }), /WEB_FIXTURE_DASHBOARD_PRODUCTS_UNAVAILABLE/u);
  assert.equal(sessionCreated, false);
});

test("exercise maps unexpected Session create failures to a stable phase code", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-session-create-diagnostic-test-");
  const internal = "private client detail must not cross the fixture boundary";

  await assert.rejects(runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    runtime: {
      browser: {
        async authenticate() { return { generatedSiteHostResolved: true }; },
        async readDashboard() { return dashboard(100, 0); },
      },
      session: {
        async create() { throw new Error(internal); },
      },
    },
  }), (error) => {
    assert.equal(error.message, "WEB_FIXTURE_SESSION_CREATE_FAILED");
    assert.equal(error.message.includes(internal), false);
    return true;
  });
});

test("exercise retains only bounded Session client diagnostics", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-session-client-diagnostic-test-");
  const failure = new SessionClientError("http", "private Session response detail", {
    status: 503,
    problem: {
      error: {
        code: "ADMISSION_TEMPORARILY_UNAVAILABLE",
        message: "private upstream detail",
        retry_class: "same_request_safe",
        action: "retry_with_backoff",
      },
      correlation_id: "private-correlation-id",
    },
  });

  await assert.rejects(runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    runtime: {
      browser: {
        async authenticate() { return { generatedSiteHostResolved: true }; },
        async readDashboard() { return dashboard(100, 0); },
      },
      session: {
        async create() { throw failure; },
      },
    },
  }), (error) => {
    assert.equal(
      error.message,
      "WEB_FIXTURE_SESSION_CREATE_FAILED_ADMISSION_TEMPORARILY_UNAVAILABLE",
    );
    assert.equal(error.message.includes("private"), false);
    return true;
  });
});

test("exercise distinguishes an upstream Session grant rejection from Site authentication", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-session-grant-source-test-");
  const failure = (action) => new SessionClientError("auth_required", "private Session response detail", {
    status: 401,
    problem: {
      error: {
        code: "SESSION_ACCESS_GRANT_REQUIRED",
        message: "private upstream detail",
        retry_class: "after_user_action",
        action,
      },
      correlation_id: "private-correlation-id",
    },
  });

  const attempt = (action) => runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    runtime: {
      browser: {
        async authenticate() { return { generatedSiteHostResolved: true }; },
        async readDashboard() { return dashboard(100, 0); },
      },
      session: {
        async create() { throw failure(action); },
      },
    },
  });

  await assert.rejects(attempt("refresh_grant"), (error) => {
    assert.equal(
      error.message,
      "WEB_FIXTURE_SESSION_CREATE_FAILED_SESSION_ACCESS_GRANT_REQUIRED_SESSION_UPSTREAM",
    );
    assert.equal(error.message.includes("private"), false);
    return true;
  });
  await assert.rejects(attempt("reauthenticate"), (error) => {
    assert.equal(
      error.message,
      "WEB_FIXTURE_SESSION_CREATE_FAILED_SESSION_ACCESS_GRANT_REQUIRED_SITE_AUTH",
    );
    assert.equal(error.message.includes("private"), false);
    return true;
  });
});

test("exercise distinguishes upstream Session unavailability from finite Site BFF phases", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-session-unavailable-source-test-");
  const failure = (kind, action, retryClass, failurePhase) => {
    const error = new SessionClientError(kind, "private unavailable detail", {
      status: 503,
      problem: {
        error: {
          code: "INTERNAL_UNAVAILABLE",
          message: "private upstream detail",
          retry_class: retryClass,
          action,
        },
        correlation_id: "private-correlation-id",
      },
      ...(failurePhase === undefined ? {} : { failurePhase }),
    });
    return error;
  };
  const attempt = (error) => runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    runtime: {
      browser: {
        async authenticate() { return { generatedSiteHostResolved: true }; },
        async readDashboard() { return dashboard(100, 0); },
      },
      session: {
        async create() {
          return { sessionId: "session-runtime", branchId: "branch-runtime", sessionVersion: 1 };
        },
        open() {
          return { ready: Promise.resolve(), terminal: new Promise(() => {}), close() {} };
        },
        async submit() { throw error; },
      },
    },
  });

  await assert.rejects(attempt(failure("repair_required", "retry_same_cursor", "after_delay")), (error) => {
    assert.equal(
      error.message,
      "WEB_FIXTURE_SESSION_SUBMIT_FAILED_INTERNAL_UNAVAILABLE_SESSION_UPSTREAM",
    );
    assert.equal(error.message.includes("private"), false);
    return true;
  });
  await assert.rejects(attempt(failure("command_conflict", "reconcile_receipt", "reconcile_receipt")), (error) => {
    assert.equal(
      error.message,
      "WEB_FIXTURE_SESSION_SUBMIT_FAILED_INTERNAL_UNAVAILABLE_SESSION_UPSTREAM",
    );
    assert.equal(error.message.includes("private"), false);
    return true;
  });
  await assert.rejects(attempt(failure(
    "command_conflict",
    "reconcile_receipt",
    "reconcile_receipt",
    "grant_issue",
  )), (error) => {
    assert.equal(
      error.message,
      "WEB_FIXTURE_SESSION_SUBMIT_FAILED_INTERNAL_UNAVAILABLE_SITE_BFF_GRANT_ISSUE",
    );
    assert.equal(error.message.includes("private"), false);
    return true;
  });
});

test("production browser authentication carries the NextAuth credentials ceremony in one cookie jar", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-nextauth-test-");
  const state = JSON.parse(await readFile(join(environment.KOKORO_WEB_FIXTURE_PRIVATE_DIR, "runtime-state.json"), "utf8"));
  const authCalls = [];
  let dashboardReads = 0;
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    if (request.url === "/api/auth/delivery-state" && request.method === "POST") {
      authCalls.push("delivery");
      assert.equal(request.headers.origin, state.publicOrigin);
      assert.equal(request.headers["sec-fetch-site"], "same-origin");
      assert.equal(JSON.parse(body).email, "runtime-fixture@example.com");
      response.writeHead(204, { "set-cookie": "__Host-kokoro.auth-delivery=prepared; Secure; HttpOnly; Path=/" });
      response.end();
      return;
    }
    if (request.url === "/api/auth/csrf" && request.method === "GET") {
      authCalls.push("csrf");
      assert.match(request.headers.cookie ?? "", /__Host-kokoro\.auth-delivery=prepared/u);
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "__Host-authjs.csrf-token=csrf-cookie; Secure; HttpOnly; Path=/",
      });
      response.end(JSON.stringify({ csrfToken: "browser-nextauth-csrf-token" }));
      return;
    }
    if (request.url === "/api/auth/callback/credentials" && request.method === "POST") {
      authCalls.push("callback");
      assert.match(request.headers.cookie ?? "", /__Host-authjs\.csrf-token=csrf-cookie/u);
      const form = new URLSearchParams(body);
      assert.equal(form.get("csrfToken"), "browser-nextauth-csrf-token");
      assert.equal(form.get("password"), "runtime-fixture-password-at-least-32-characters");
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "__Host-kokoro.session-token=opaque-session; Secure; HttpOnly; Path=/",
      });
      response.end(JSON.stringify({ url: `${state.publicOrigin}/` }));
      return;
    }
    if (request.url === "/api/auth/session" && request.method === "GET") {
      authCalls.push("session");
      assert.match(request.headers.cookie ?? "", /__Host-kokoro\.session-token=opaque-session/u);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ authState: "authenticated", expires: "2026-08-07T00:00:00.000Z" }));
      return;
    }
    if (request.url === "/api/account/dashboard" && request.method === "GET") {
      dashboardReads += 1;
      assert.match(request.headers.cookie ?? "", /__Host-kokoro\.session-token=opaque-session/u);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(dashboardReads === 1 ? dashboard(100, 0) : dashboard(90, 10)));
      return;
    }
    response.writeHead(404, { "content-length": "0" });
    response.end();
  });
  await new Promise((resolvePromise, rejectPromise) => {
    upstream.once("error", rejectPromise);
    upstream.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => upstream.close(() => resolvePromise())));
  const address = upstream.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const proxy = await runtimeFixture.startStrictPublicProxy({
    candidateHost: state.candidateHost,
    publicOrigin: state.publicOrigin,
    certificateFile: state.publicTlsCertificateFile,
    privateKeyFile: state.publicTlsKeyFile,
    upstreamPort: address.port,
  });
  t.after(() => proxy.close());
  let finishTerminal;
  const terminal = new Promise((resolvePromise) => { finishTerminal = resolvePromise; });
  const receipt = { command: "submit", status: "applied" };
  const session = {
    async create() { return { sessionId: "session-runtime", branchId: "branch-runtime", sessionVersion: 1 }; },
    open() { return { ready: Promise.resolve(), terminal, close() {} }; },
    async submit() {
      finishTerminal({ outcome: "completed" });
      return { logicalRequest: { commandId: "same-command" }, receipt };
    },
    async replay() { return receipt; },
    async waitForTerminalSnapshot() {
      return { userMessageCount: 1, assistantTerminalCount: 1, costSettled: true };
    },
  };

  const result = await runtimeFixture.exerciseWebChatCreditRuntime(environment, { session });

  assert.equal(result.browserSessionTurn, true);
  assert.deepEqual(authCalls, ["delivery", "csrf", "callback", "session"]);
  assert.equal(dashboardReads, 2);
});

test("production browser authentication reports a rejected delivery preparation", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-nextauth-rejection-test-");
  const state = JSON.parse(await readFile(join(
    environment.KOKORO_WEB_FIXTURE_PRIVATE_DIR,
    "runtime-state.json",
  ), "utf8"));
  const upstream = createServer((_request, response) => {
    response.writeHead(403, { "content-length": "0" });
    response.end();
  });
  await new Promise((resolvePromise, rejectPromise) => {
    upstream.once("error", rejectPromise);
    upstream.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => upstream.close(() => resolvePromise())));
  const address = upstream.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const proxy = await runtimeFixture.startStrictPublicProxy({
    candidateHost: state.candidateHost,
    publicOrigin: state.publicOrigin,
    certificateFile: state.publicTlsCertificateFile,
    privateKeyFile: state.publicTlsKeyFile,
    upstreamPort: address.port,
  });
  t.after(() => proxy.close());

  await assert.rejects(
    runtimeFixture.exerciseWebChatCreditRuntime(environment),
    /WEB_FIXTURE_AUTH_DELIVERY_FORBIDDEN/u,
  );
});

test("production browser authentication reports rejected credentials", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-nextauth-credentials-test-");
  const state = JSON.parse(await readFile(join(
    environment.KOKORO_WEB_FIXTURE_PRIVATE_DIR,
    "runtime-state.json",
  ), "utf8"));
  const upstream = createServer((request, response) => {
    if (request.url === "/api/auth/delivery-state") {
      response.writeHead(204, {
        "set-cookie": "__Host-kokoro.auth-delivery=prepared; Secure; HttpOnly; Path=/",
      });
      response.end();
      return;
    }
    if (request.url === "/api/auth/csrf") {
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "__Host-authjs.csrf-token=csrf-cookie; Secure; HttpOnly; Path=/",
      });
      response.end(JSON.stringify({ csrfToken: "browser-nextauth-csrf-token" }));
      return;
    }
    if (request.url === "/api/auth/callback/credentials") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        url: `${state.publicOrigin}/login?error=CredentialsSignin&code=credentials`,
      }));
      return;
    }
    response.writeHead(404, { "content-length": "0" });
    response.end();
  });
  await new Promise((resolvePromise, rejectPromise) => {
    upstream.once("error", rejectPromise);
    upstream.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => upstream.close(() => resolvePromise())));
  const address = upstream.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const proxy = await runtimeFixture.startStrictPublicProxy({
    candidateHost: state.candidateHost,
    publicOrigin: state.publicOrigin,
    certificateFile: state.publicTlsCertificateFile,
    privateKeyFile: state.publicTlsKeyFile,
    upstreamPort: address.port,
  });
  t.after(() => proxy.close());

  await assert.rejects(
    runtimeFixture.exerciseWebChatCreditRuntime(environment),
    /WEB_FIXTURE_AUTH_CREDENTIALS_REJECTED/u,
  );
});

test("the fixture boundary imports the scaffold package export and never a production source path", async () => {
  const entry = new URL("../fixtures/web-chat-credit-runtime.mjs", import.meta.url);
  const sources = await Promise.all([
    entry,
    new URL("../fixtures/web-chat-credit-runtime-network.mjs", import.meta.url),
    new URL("../fixtures/web-chat-credit-runtime-journey.mjs", import.meta.url),
  ].map((path) => readFile(path, "utf8")));
  const source = sources.join("\n");

  assert.match(source, /import\("@kokoro\/site-scaffold"\)/u);
  assert.match(source, /from "@kokoro\/session-client"/u);
  assert.doesNotMatch(source, /packages\/site-scaffold\/src|apps\/reference-site/u);
  assert.doesNotMatch(source, /kokoro-(?:platform|session|agent)\//u);
  assert.equal(entry.pathname.startsWith(WEB_ROOT.pathname), true);
});
