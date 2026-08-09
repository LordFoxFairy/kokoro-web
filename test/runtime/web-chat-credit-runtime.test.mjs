import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
import {
  availableLoopbackPort,
  createBrowserHttpClient,
} from "../fixtures/web-chat-credit-runtime-network.mjs";
import { createSessionTransport } from "../fixtures/web-chat-credit-runtime-journey.mjs";
import {
  createBrowserAudit,
  redeemAccountInChromium,
} from "../fixtures/web-chat-credit-runtime-browser.mjs";

const WEB_ROOT = new URL("../../", import.meta.url);

async function waitForPathRemoval(path, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await stat(path);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (Date.now() >= deadline) assert.fail(`path was not removed within ${timeoutMs}ms`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}

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
  if (requirement === "KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE") {
    return "KC1-ABCDEFGH-0123456789-0123456789ABCDEFGHJKMNPQRSTVWXYZ-ABCDEFGH";
  }
  if (requirement.endsWith("_CERT_FILE") || requirement.endsWith("_CA_FILE")) {
    return "-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----\n";
  }
  if (requirement.endsWith("_KEY_FILE")) {
    return "-----BEGIN PRIVATE KEY-----\nZml4dHVyZS1rZXk=\n-----END PRIVATE KEY-----\n";
  }
  return "runtime-fixture-private-material-at-least-32-characters";
}

function redemptionEvidence() {
  return {
    accountRedemptionPage: true,
    redemptionPreviewed: true,
    redemptionConfirmed: true,
    redemptionBalanceIncreased: true,
    redemptionProductVisible: true,
    redemptionSameFlowReplay: true,
    redemptionRecoveryContinuedViaUi: true,
    redemptionSecretLeakFree: true,
    browserMutationAuthorityEnforced: true,
    browserTlsAuthorityPinned: true,
    browserProfileRemoved: true,
    redemptionDashboardReadCount: 3,
    redemptionExecuteRequestCount: 2,
    redemptionRecoveryRequestCount: 1,
    browserConsoleCount: 0,
    browserPageErrorCount: 0,
  };
}

function runtimeLifecycleEvidence() {
  return {
    serverLogLeakFree: true,
    webRuntimeClosed: true,
  };
}

test("browser redemption replaces private browser failures with one stable code and removes its profile", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-browser-failure-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const setup = await setupWebChatCreditRuntime(
    fixtureEnvironment(privateDirectory),
    { buildCandidate: false },
  );
  const rawCode = "KC1-01234567-0123456789-0123456789ABCDEFGHJKMNPQRSTVWXYZ-01234567";
  let profileDirectory;
  await assert.rejects(redeemAccountInChromium({
    publicOrigin: setup.publicOrigin,
    candidateHost: setup.candidateHost,
    publicCertificateAuthorityFile: setup.publicCertificateAuthorityFile,
    publicTlsCertificateFile: JSON.parse(await readFile(setup.runtimeStateFile, "utf8"))
      .publicTlsCertificateFile,
    auth: {
      schemaVersion: 1,
      email: "runtime-fixture@example.com",
      password: "runtime-fixture-password-at-least-32-characters",
    },
    rawCode,
  }, {
    browserType: {
      async launchPersistentContext(path) {
        profileDirectory = path;
        throw new Error(`private browser failure ${rawCode}`);
      },
    },
  }), (error) => {
    assert.equal(error.message, "WEB_FIXTURE_BROWSER_REDEMPTION_FAILED");
    assert.equal(error.message.includes(rawCode), false);
    return true;
  });
  assert.equal(typeof profileDirectory, "string");
  await assert.rejects(stat(profileDirectory), { code: "ENOENT" });
});

test("browser redemption blocks service workers and clears the Chromium cache around the journey", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-browser-cache-fence-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const setup = await setupWebChatCreditRuntime(
    fixtureEnvironment(privateDirectory),
    { buildCandidate: false },
  );
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  const commands = [];
  let launchOptions;
  let detached = 0;
  let contextClosed = 0;
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    on() {},
    async goto() {
      commands.push(["PAGE.goto", undefined]);
      throw new Error("fixture journey stopped after cache fence");
    },
  };

  await assert.rejects(redeemAccountInChromium({
    publicOrigin: setup.publicOrigin,
    candidateHost: setup.candidateHost,
    publicCertificateAuthorityFile: setup.publicCertificateAuthorityFile,
    publicTlsCertificateFile: state.publicTlsCertificateFile,
    auth: {
      schemaVersion: 1,
      email: "runtime-fixture@example.com",
      password: "runtime-fixture-password-at-least-32-characters",
    },
    rawCode: runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE"),
  }, {
    browserType: {
      async launchPersistentContext(_path, options) {
        launchOptions = options;
        return {
          pages() { return [page]; },
          async close() { contextClosed += 1; },
          async newCDPSession(candidate) {
            assert.equal(candidate, page);
            return {
              async send(command, parameters) { commands.push([command, parameters]); },
              async detach() { detached += 1; },
            };
          },
        };
      },
    },
  }), /WEB_FIXTURE_BROWSER_REDEMPTION_FAILED/u);

  assert.equal(launchOptions.serviceWorkers, "block");
  assert.deepEqual(commands, [
    ["Network.enable", undefined],
    ["Network.setCacheDisabled", { cacheDisabled: true }],
    ["Network.clearBrowserCache", undefined],
    ["PAGE.goto", undefined],
    ["Network.clearBrowserCache", undefined],
    ["Network.disable", undefined],
  ]);
  assert.equal(detached, 1);
  assert.equal(contextClosed, 1);
});

test("browser audit counts only same-origin successful non-service-worker dashboard responses", async () => {
  const origin = new URL("https://web-chat-credit.fixture.local:4343");
  const rawCode = runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE");
  const cases = [
    { url: "https://cross-origin.fixture.local:4343/api/account/dashboard", status: 200, fromServiceWorker: false, count: 0 },
    { url: `${origin.origin}/api/account/dashboard`, status: 500, fromServiceWorker: false, count: 0 },
    { url: `${origin.origin}/api/account/dashboard`, status: 200, fromServiceWorker: true, count: 0 },
    { url: `${origin.origin}/api/account/dashboard`, status: 200, fromServiceWorker: false, count: 1 },
  ];

  for (const fixture of cases) {
    const handlers = new Map();
    const audit = createBrowserAudit(origin, rawCode);
    audit.attach({
      on(event, handler) { handlers.set(event, handler); },
    });
    const request = {
      method() { return "GET"; },
      url() { return fixture.url; },
    };
    handlers.get("response")({
      fromServiceWorker() { return fixture.fromServiceWorker; },
      request() { return request; },
      status() { return fixture.status; },
    });

    const evidence = await audit.finalize();
    assert.equal(evidence.redemptionDashboardReadCount, fixture.count);
    assert.equal(evidence.browserMutationAuthorityEnforced, false);
  }

  const handlers = new Map();
  const audit = createBrowserAudit(origin, rawCode);
  audit.attach({ on(event, handler) { handlers.set(event, handler); } });
  const respond = (suffix, method) => {
    const request = {
      method() { return method; },
      url() { return `${origin.origin}/api/account/${suffix}`; },
    };
    handlers.get("response")({
      fromServiceWorker() { return false; },
      request() { return request; },
      status() { return 200; },
    });
  };
  for (let count = 0; count < 3; count += 1) respond("dashboard", "GET");
  for (let count = 0; count < 2; count += 1) respond("execute", "POST");
  respond("recover", "POST");
  const counts = await audit.finalize();
  assert.deepEqual({
    dashboard: counts.redemptionDashboardReadCount,
    execute: counts.redemptionExecuteRequestCount,
    recover: counts.redemptionRecoveryRequestCount,
  }, { dashboard: 3, execute: 2, recover: 1 });
});

test("browser redemption bounds a never-resolving persistent Chromium launch", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-browser-timeout-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const setup = await setupWebChatCreditRuntime(
    fixtureEnvironment(privateDirectory),
    { buildCandidate: false },
  );
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  let profileDirectory;
  const startedAt = Date.now();

  await assert.rejects(redeemAccountInChromium({
    publicOrigin: setup.publicOrigin,
    candidateHost: setup.candidateHost,
    publicCertificateAuthorityFile: setup.publicCertificateAuthorityFile,
    publicTlsCertificateFile: state.publicTlsCertificateFile,
    auth: {
      schemaVersion: 1,
      email: "runtime-fixture@example.com",
      password: "runtime-fixture-password-at-least-32-characters",
    },
    rawCode: runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE"),
  }, {
    browserType: {
      async launchPersistentContext(path) {
        profileDirectory = path;
        return new Promise(() => {});
      },
    },
    totalTimeoutMs: 25,
    cleanupTimeoutMs: 25,
  }), /WEB_FIXTURE_BROWSER_REDEMPTION_FAILED/u);

  assert.ok(Date.now() - startedAt < 2_000);
  assert.equal(typeof profileDirectory, "string");
  await assert.rejects(stat(profileDirectory), { code: "ENOENT" });
});

test("browser redemption closes a context that resolves after its deadline and removes the recreated profile", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-browser-late-launch-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const setup = await setupWebChatCreditRuntime(
    fixtureEnvironment(privateDirectory),
    { buildCandidate: false },
  );
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  const rawCode = runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE");
  let finishLaunch;
  const launchGate = new Promise((resolvePromise) => { finishLaunch = resolvePromise; });
  let observeLateContext;
  const lateContextObserved = new Promise((resolvePromise) => { observeLateContext = resolvePromise; });
  let profileDirectory;
  let closeCalls = 0;
  let pagesCalls = 0;

  const redemption = redeemAccountInChromium({
    publicOrigin: setup.publicOrigin,
    candidateHost: setup.candidateHost,
    publicCertificateAuthorityFile: setup.publicCertificateAuthorityFile,
    publicTlsCertificateFile: state.publicTlsCertificateFile,
    auth: {
      schemaVersion: 1,
      email: "runtime-fixture@example.com",
      password: "runtime-fixture-password-at-least-32-characters",
    },
    rawCode,
  }, {
    browserType: {
      async launchPersistentContext(path) {
        profileDirectory = path;
        await launchGate;
        await mkdir(path, { recursive: true });
        await writeFile(join(path, "late-launch-secret"), rawCode, { mode: 0o600 });
        return {
          pages() {
            pagesCalls += 1;
            observeLateContext();
            return [];
          },
          async newPage() { throw new Error("late journey must not start"); },
          async close() {
            closeCalls += 1;
            observeLateContext();
          },
        };
      },
    },
    totalTimeoutMs: 25,
    cleanupTimeoutMs: 60,
  });

  await assert.rejects(redemption, /WEB_FIXTURE_BROWSER_REDEMPTION_FAILED/u);
  assert.equal(typeof profileDirectory, "string");
  await assert.rejects(stat(profileDirectory), { code: "ENOENT" });

  finishLaunch();
  await lateContextObserved;
  await waitForPathRemoval(profileDirectory);

  assert.equal(closeCalls, 1);
  assert.equal(pagesCalls, 0);
  await assert.rejects(stat(profileDirectory), { code: "ENOENT" });
});

test("browser redemption bounds a never-resolving Chromium close and still removes its profile", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-browser-close-timeout-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const setup = await setupWebChatCreditRuntime(
    fixtureEnvironment(privateDirectory),
    { buildCandidate: false },
  );
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  let profileDirectory;
  const startedAt = Date.now();

  await assert.rejects(redeemAccountInChromium({
    publicOrigin: setup.publicOrigin,
    candidateHost: setup.candidateHost,
    publicCertificateAuthorityFile: setup.publicCertificateAuthorityFile,
    publicTlsCertificateFile: state.publicTlsCertificateFile,
    auth: {
      schemaVersion: 1,
      email: "runtime-fixture@example.com",
      password: "runtime-fixture-password-at-least-32-characters",
    },
    rawCode: runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE"),
  }, {
    browserType: {
      async launchPersistentContext(path) {
        profileDirectory = path;
        return {
          pages() { throw new Error("private journey failure"); },
          async close() { return new Promise(() => {}); },
        };
      },
    },
    totalTimeoutMs: 100,
    cleanupTimeoutMs: 30,
  }), /WEB_FIXTURE_BROWSER_REDEMPTION_FAILED/u);

  assert.ok(Date.now() - startedAt < 2_000);
  assert.equal(typeof profileDirectory, "string");
  await assert.rejects(stat(profileDirectory), { code: "ENOENT" });
});

function accountBrowserPage() {
  return `<!doctype html><html><body>
<h1>Account</h1><p id="status" role="status"></p>
<section id="redemption"><h2>Redeem a code</h2>
  <form id="preview-form"><label>Code<input autocomplete="off" name="code" required></label><button type="submit">Preview</button></form>
  <div id="preview" hidden><h3 id="product-label"></h3><button id="confirm" type="button">Confirm redemption</button><button id="continue" hidden type="button">Continue confirmation result</button></div>
</section>
<section id="products"><h2>Products &amp; entitlements</h2><ul></ul></section>
<section id="credits"><h2>Credits</h2><p>grant: <strong>100</strong> available</p></section>
<script>
const csrf = "fixture-browser-csrf-token-at-least-32-characters";
const headers = { "content-type": "application/json", "x-kokoro-browser-csrf": csrf };
const previewFlow = "launch-preview-flow";
const confirmFlow = "launch-confirm-flow";
const previewForm = document.querySelector("#preview-form");
const preview = document.querySelector("#preview");
const confirm = document.querySelector("#confirm");
const continuation = document.querySelector("#continue");
const status = document.querySelector("#status");
const invoke = (action, body) => fetch("/api/account/" + action, {
  method: "POST", credentials: "same-origin", headers, body: JSON.stringify(body),
});
async function loadDashboard() {
  const response = await fetch("/api/account/dashboard", { credentials: "same-origin", cache: "no-store" });
  const dashboard = await response.json();
  document.querySelector("#credits strong").textContent = dashboard.available;
  document.querySelector("#products ul").innerHTML = dashboard.product === null ? "" : "<li>" + dashboard.product + "</li>";
}
previewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = String(new FormData(previewForm).get("code") || "");
  document.documentElement.setAttribute("data-retained-code", code);
  await invoke("prepare", { operation: "redemption.preview", flowRef: previewFlow });
  const response = await invoke("execute", { operation: "redemption.preview", flowRef: previewFlow, code });
  const result = await response.json();
  await loadDashboard();
  previewForm.reset();
  document.querySelector("#product-label").textContent = result.product;
  preview.hidden = false;
});
confirm.addEventListener("click", async () => {
  confirm.disabled = true;
  try {
    await invoke("prepare", { operation: "redemption.confirm", flowRef: confirmFlow });
    const response = await invoke("execute", {
      operation: "redemption.confirm", flowRef: confirmFlow,
      previewFlowRef: previewFlow, legalAccepted: true,
    });
    await response.json();
  } catch {
    confirm.hidden = true;
    continuation.hidden = false;
  } finally {
    confirm.disabled = false;
  }
});
continuation.addEventListener("click", async () => {
  continuation.disabled = true;
  const response = await invoke("recover", { operation: "redemption.confirm", flowRef: confirmFlow });
  const result = await response.json();
  if (result.state === "succeeded" && result.productState === "fulfilled") {
    await loadDashboard();
    status.textContent = "Code redeemed. Your account has been refreshed.";
    preview.hidden = true;
    previewForm.hidden = false;
  }
});
void loadDashboard();
</script></body></html>`;
}

test("real Chromium recovers through the Account Continue UI and rejects a retained DOM attribute", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-browser-ui-recovery-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  const publicPort = await availableLoopbackPort();
  environment.KOKORO_WEB_FIXTURE_PUBLIC_ORIGIN =
    `https://${environment.KOKORO_WEB_FIXTURE_CANDIDATE_HOST}:${publicPort}`;
  const setup = await setupWebChatCreditRuntime(environment, { buildCandidate: false });
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  const rawCode = runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE");
  const serverFacts = { dashboard: 0, execute: 0, recover: 0, violation: false, redeemed: false };
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const json = () => {
      try { return JSON.parse(body); } catch { serverFacts.violation = true; return {}; }
    };
    const reply = (status, value, extraHeaders = {}) => {
      const serialized = value === undefined ? "" : JSON.stringify(value);
      response.writeHead(status, {
        "cache-control": "no-store",
        "content-length": String(Buffer.byteLength(serialized)),
        ...(serialized === "" ? {} : { "content-type": "application/json" }),
        ...extraHeaders,
      });
      response.end(serialized);
    };
    if (request.url === "/account" && !request.headers.cookie?.includes("fixture-session=1")) {
      const html = `<!doctype html><html><body><label>Email<input aria-label="Email"></label>
<label>Password<input aria-label="Password" type="password"></label><button>Continue</button>
<script>document.querySelector("button").addEventListener("click", async () => {
  await fetch("/fixture-login", { method: "POST" }); window.location.href = "/";
});</script></body></html>`;
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "content-length": String(Buffer.byteLength(html)),
      });
      response.end(html);
      return;
    }
    if (request.url === "/account" && request.method === "GET") {
      const html = accountBrowserPage();
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "content-length": String(Buffer.byteLength(html)),
      });
      response.end(html);
      return;
    }
    if (request.url === "/fixture-login" && request.method === "POST") {
      reply(204, undefined, { "set-cookie": "fixture-session=1; Secure; HttpOnly; SameSite=Strict; Path=/" });
      return;
    }
    if (request.url === "/" && request.method === "GET") {
      const html = "<!doctype html><h1>Workspace</h1>";
      response.writeHead(200, { "content-type": "text/html", "content-length": String(Buffer.byteLength(html)) });
      response.end(html);
      return;
    }
    if (request.url === "/api/account/dashboard" && request.method === "GET") {
      serverFacts.dashboard += 1;
      reply(200, {
        available: serverFacts.redeemed ? "125" : "100",
        product: serverFacts.redeemed ? "Permanent credits" : null,
      });
      return;
    }
    if (request.url === "/api/account/prepare" && request.method === "POST") {
      const value = json();
      serverFacts.violation ||= !["redemption.preview", "redemption.confirm"].includes(value.operation);
      reply(204);
      return;
    }
    if (request.url === "/api/account/execute" && request.method === "POST") {
      const value = json();
      serverFacts.execute += 1;
      if (value.operation === "redemption.preview") {
        serverFacts.violation ||= value.code !== rawCode;
        reply(200, { state: "ready", product: "Permanent credits" });
        return;
      }
      serverFacts.violation ||= value.operation !== "redemption.confirm" || value.code !== undefined;
      serverFacts.redeemed = true;
      reply(200, { state: "succeeded", productState: "fulfilled" });
      return;
    }
    if (request.url === "/api/account/recover" && request.method === "POST") {
      const value = json();
      serverFacts.recover += 1;
      serverFacts.violation ||= value.operation !== "redemption.confirm" || value.flowRef !== "launch-confirm-flow";
      reply(200, { state: "succeeded", productState: "fulfilled" });
      return;
    }
    if (request.url === "/account" && request.method === "GET") return;
    if (request.url === "/account" || request.url === "/login") return;
    reply(404);
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
    candidateHost: setup.candidateHost,
    publicOrigin: setup.publicOrigin,
    certificateFile: state.publicTlsCertificateFile,
    privateKeyFile: state.publicTlsKeyFile,
    upstreamPort: address.port,
  });
  t.after(() => proxy.close());

  await assert.rejects(redeemAccountInChromium({
    publicOrigin: setup.publicOrigin,
    candidateHost: setup.candidateHost,
    publicCertificateAuthorityFile: setup.publicCertificateAuthorityFile,
    publicTlsCertificateFile: state.publicTlsCertificateFile,
    auth: {
      schemaVersion: 1,
      email: "runtime-fixture@example.com",
      password: "runtime-fixture-password-at-least-32-characters",
    },
    rawCode,
  }), /WEB_FIXTURE_BROWSER_REDEMPTION_FAILED/u);

  assert.deepEqual(serverFacts, {
    dashboard: 3,
    execute: 2,
    recover: 1,
    violation: false,
    redeemed: true,
  });
});

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
  assert.deepEqual(JSON.parse(await readFile(state.lifecycleEvidenceFile, "utf8")), {
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-lifecycle-evidence",
    serverLogLeakFree: true,
    webRuntimeClosed: true,
  });
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
    "lifecycleEvidenceFile",
  ]);
  assert.deepEqual(Object.keys(state.runtimeMaterialFiles), REQUIRED_RUNTIME_MATERIALS);
  assert.equal(JSON.stringify(result).includes("fixture\n"), false);
  assert.equal(JSON.stringify(state).includes("KC1-"), false);
});

test("serve closes the Web runtime and detects a redemption code split across child log chunks", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-runtime-lifecycle-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  const publicPort = await availableLoopbackPort();
  environment.KOKORO_WEB_FIXTURE_PUBLIC_ORIGIN =
    `https://${environment.KOKORO_WEB_FIXTURE_CANDIDATE_HOST}:${publicPort}`;
  for (const requirement of REQUIRED_RUNTIME_MATERIALS) {
    const path = join(privateDirectory, `${requirement.toLowerCase()}.fixture`);
    await writeFile(path, runtimeMaterial(requirement), { mode: 0o600 });
    environment[requirement] = path;
  }
  const setup = await setupWebChatCreditRuntime(environment, { buildCandidate: false });
  const state = JSON.parse(await readFile(setup.runtimeStateFile, "utf8"));
  await mkdir(join(state.candidateDirectory, ".next", "standalone"), { recursive: true });
  await mkdir(join(state.candidateDirectory, ".next", "static"), { recursive: true });
  await writeFile(join(state.candidateDirectory, ".next", "standalone", "server.js"), `
const { createServer } = require("node:http");
const code = "${runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE")}";
const server = createServer((_request, response) => {
  response.writeHead(204);
  response.end();
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME, () => {
  process.stdout.write(code.slice(0, 19));
  setTimeout(() => process.stdout.write(code.slice(19)), 5);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`, { mode: 0o600 });

  const runtime = await runtimeFixture.serveWebChatCreditRuntime(environment);
  await runtime.close();

  assert.deepEqual(JSON.parse(await readFile(state.lifecycleEvidenceFile, "utf8")), {
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-lifecycle-evidence",
    serverLogLeakFree: false,
    webRuntimeClosed: true,
  });
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

test("setup admits only a canonical 0600 redemption code file", async (t) => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-runtime-redemption-code-test-"));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const environment = fixtureEnvironment(privateDirectory);
  for (const requirement of REQUIRED_RUNTIME_MATERIALS) {
    const path = join(privateDirectory, `${requirement.toLowerCase()}.fixture`);
    await writeFile(path, runtimeMaterial(requirement), { mode: 0o600 });
    environment[requirement] = path;
  }
  const redemptionCodeFile = join(privateDirectory, "redemption-code.fixture");
  await writeFile(redemptionCodeFile, runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE"), {
    mode: 0o600,
  });
  environment.KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE = redemptionCodeFile;
  await chmod(environment.KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE, 0o644);

  await assert.rejects(
    setupWebChatCreditRuntime(environment, { buildCandidate: false }),
    /WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID/u,
  );

  await chmod(environment.KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE, 0o400);
  await assert.rejects(
    setupWebChatCreditRuntime(environment, { buildCandidate: false }),
    /WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID/u,
  );

  await chmod(environment.KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE, 0o600);
  await writeFile(environment.KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE, "KC1-invalid", "utf8");
  await assert.rejects(
    setupWebChatCreditRuntime(environment, { buildCandidate: false }),
    /WEB_FIXTURE_REDEMPTION_CODE_INVALID/u,
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
    ...redemptionEvidence(),
    ...runtimeLifecycleEvidence(),
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
    ...redemptionEvidence(),
    ...runtimeLifecycleEvidence(),
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
    ...redemptionEvidence(),
    ...runtimeLifecycleEvidence(),
  });
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    serverLogLeakFree: _serverLogLeakFree,
    webRuntimeClosed: _webRuntimeClosed,
    ...journey
  } = expected;
  await writeFile(state.observationFile, `${JSON.stringify({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-journey-evidence",
    ...journey,
  })}\n`, { mode: 0o600 });

  await assert.rejects(
    runWebChatCreditRuntimeFixture(["observe"], environment),
    /WEB_FIXTURE_OBSERVATION_UNAVAILABLE/u,
  );
  await writeFile(state.lifecycleEvidenceFile, `${JSON.stringify({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-lifecycle-evidence",
    ...runtimeLifecycleEvidence(),
  })}\n`, { mode: 0o600 });

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

function sessionCommandIdentity() {
  return {
    command_id: "command-runtime-12345678",
    idempotency_key: "web:command-runtime-12345678",
    digest_algorithm: "SHA256_CANONICAL_JSON_V2",
    request_digest: "b".repeat(64),
  };
}

function logicalSubmitRequest() {
  return {
    sessionId: "session-runtime",
    body: { command: sessionCommandIdentity() },
  };
}

function sessionCommandResponse(status = "applied", updatedAt = "2026-08-09T12:00:01.000Z") {
  return {
    command_receipt: {
      operation: "submit_message",
      ...sessionCommandIdentity(),
      updated_at: updatedAt,
      status,
      payload: {
        kind: "run-launch-created",
        payload: {
          session_id: "session-runtime",
          branch_id: "branch-runtime",
          trigger_message_id: "message-user-runtime",
          assistant_message_id: "message-assistant-runtime",
          launch_id: "launch-runtime",
          proposed_run_id: "run-runtime",
          session_version: 2,
          branch_version: 2,
        },
      },
    },
  };
}

test("logical replay admits accepted to applied and stable applied receipts", () => {
  assert.equal(typeof runtimeFixture.validateLogicalReplay, "function");
  assert.doesNotThrow(() => runtimeFixture.validateLogicalReplay(
    logicalSubmitRequest(),
    sessionCommandResponse("accepted", "2026-08-09T12:00:00.000Z"),
    sessionCommandResponse("applied", "2026-08-09T12:00:01.000Z"),
  ));
  assert.doesNotThrow(() => runtimeFixture.validateLogicalReplay(
    logicalSubmitRequest(),
    sessionCommandResponse("applied", "2026-08-09T12:00:01.000Z"),
    sessionCommandResponse("applied", "2026-08-09T12:00:01.000Z"),
  ));
});

test("logical replay rejects every immutable identity or payload drift", () => {
  assert.equal(typeof runtimeFixture.validateLogicalReplay, "function");
  const initial = sessionCommandResponse("accepted", "2026-08-09T12:00:00.000Z");
  const mutations = [
    ["operation", (receipt) => { receipt.operation = "edit_message"; }],
    ["command_id", (receipt) => { receipt.command_id = "command-runtime-drifted"; }],
    ["idempotency_key", (receipt) => { receipt.idempotency_key = "web:command-runtime-drifted"; }],
    ["digest_algorithm", (receipt) => { receipt.digest_algorithm = "SHA256_CANONICAL_JSON_V1"; }],
    ["request_digest", (receipt) => { receipt.request_digest = "c".repeat(64); }],
    ["payload", (receipt) => { receipt.payload.payload.session_version += 1; }],
  ];

  for (const [field, mutate] of mutations) {
    const replay = structuredClone(sessionCommandResponse("applied", "2026-08-09T12:00:01.000Z"));
    mutate(replay.command_receipt);
    assert.throws(
      () => runtimeFixture.validateLogicalReplay(logicalSubmitRequest(), initial, replay),
      /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u,
      field,
    );

    const driftedInitial = structuredClone(initial);
    mutate(driftedInitial.command_receipt);
    assert.throws(
      () => runtimeFixture.validateLogicalReplay(
        logicalSubmitRequest(),
        driftedInitial,
        sessionCommandResponse("applied", "2026-08-09T12:00:01.000Z"),
      ),
      /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u,
      `initial receipt mismatch: ${field}`,
    );
  }

  for (const [field, mutate] of mutations.slice(0, 5)) {
    const driftedInitial = structuredClone(initial);
    const driftedReplay = structuredClone(sessionCommandResponse("applied", "2026-08-09T12:00:01.000Z"));
    mutate(driftedInitial.command_receipt);
    mutate(driftedReplay.command_receipt);
    assert.throws(
      () => runtimeFixture.validateLogicalReplay(logicalSubmitRequest(), driftedInitial, driftedReplay),
      /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u,
      `logical request mismatch: ${field}`,
    );
  }
});

test("logical replay rejects status regressions, illegal statuses, and invalid time movement", () => {
  assert.equal(typeof runtimeFixture.validateLogicalReplay, "function");
  const rejectedStatusPairs = [
    ["accepted", "accepted"],
    ["applied", "accepted"],
    ["denied", "applied"],
    ["pending", "applied"],
    ["outcome_unknown", "applied"],
    ["accepted", "denied"],
    ["accepted", "pending"],
    ["accepted", "outcome_unknown"],
  ];

  for (const [initialStatus, replayStatus] of rejectedStatusPairs) {
    assert.throws(
      () => runtimeFixture.validateLogicalReplay(
        logicalSubmitRequest(),
        sessionCommandResponse(initialStatus, "2026-08-09T12:00:00.000Z"),
        sessionCommandResponse(replayStatus, "2026-08-09T12:00:01.000Z"),
      ),
      /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u,
      `${initialStatus} -> ${replayStatus}`,
    );
  }
  assert.throws(() => runtimeFixture.validateLogicalReplay(
    logicalSubmitRequest(),
    sessionCommandResponse("accepted", "2026-08-09T12:00:01.000Z"),
    sessionCommandResponse("applied", "2026-08-09T12:00:00.999Z"),
  ), /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u);
  assert.throws(() => runtimeFixture.validateLogicalReplay(
    logicalSubmitRequest(),
    sessionCommandResponse("accepted", "2026-08-09T12:00:00.0009Z"),
    sessionCommandResponse("applied", "2026-08-09T12:00:00.0001Z"),
  ), /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u);
  assert.throws(() => runtimeFixture.validateLogicalReplay(
    logicalSubmitRequest(),
    sessionCommandResponse("applied", "2026-08-09T12:00:00.000Z"),
    sessionCommandResponse("applied", "2026-08-09T12:00:00.001Z"),
  ), /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u);
  for (const equivalentInstant of [
    "2026-08-09T08:00:00.000-04:00",
    "2026-08-09T12:00:00.0000Z",
  ]) {
    assert.throws(() => runtimeFixture.validateLogicalReplay(
      logicalSubmitRequest(),
      sessionCommandResponse("applied", "2026-08-09T12:00:00.000Z"),
      sessionCommandResponse("applied", equivalentInstant),
    ), /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u, equivalentInstant);
  }
  assert.throws(() => runtimeFixture.validateLogicalReplay(
    logicalSubmitRequest(),
    sessionCommandResponse("accepted", "2026-08-09T12:00:00.000Z"),
    sessionCommandResponse("applied", "2026-08-09 12:00:01Z"),
  ), /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u);
  assert.throws(() => runtimeFixture.validateLogicalReplay(
    logicalSubmitRequest(),
    sessionCommandResponse("accepted", "2026-02-30T12:00:00.000Z"),
    sessionCommandResponse("applied", "2026-08-09T12:00:01.000Z"),
  ), /WEB_FIXTURE_LOGICAL_REPLAY_INVALID/u);
});

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

function successfulExerciseRuntime() {
  let finishTerminal;
  let dashboardReads = 0;
  const receipt = sessionCommandResponse();
  return {
    browser: {
      async authenticate() { return { generatedSiteHostResolved: true }; },
      async readDashboard() {
        dashboardReads += 1;
        return dashboardReads === 1 ? dashboard(100, 0) : dashboard(90, 10);
      },
    },
    session: {
      async create() {
        return { sessionId: "session-runtime", branchId: "branch-runtime", sessionVersion: 1 };
      },
      open() {
        const terminal = new Promise((resolvePromise) => { finishTerminal = resolvePromise; });
        return { ready: Promise.resolve(), terminal, close() {} };
      },
      async submit() {
        finishTerminal({ outcome: "completed" });
        return { logicalRequest: logicalSubmitRequest(), receipt };
      },
      async replay() { return receipt; },
      async waitForTerminalSnapshot() {
        return { userMessageCount: 1, assistantTerminalCount: 1, costSettled: true };
      },
    },
  };
}

test("exercise honors an injected Session terminal timeout budget", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-terminal-timeout-seam-test-");
  const runtime = successfulExerciseRuntime();
  runtime.session.open = () => ({
    ready: Promise.resolve(),
    terminal: new Promise(() => undefined),
    close() {},
  });
  runtime.session.submit = async () => ({
    logicalRequest: logicalSubmitRequest(),
    receipt: sessionCommandResponse(),
  });
  let watchdog;
  try {
    await assert.rejects(Promise.race([
      runtimeFixture.exerciseWebChatCreditRuntime(environment, {
        runtime,
        terminalTimeoutMs: 20,
      }),
      new Promise((_resolve, reject) => {
        watchdog = setTimeout(
          () => reject(new Error("WEB_FIXTURE_TERMINAL_TIMEOUT_SEAM_IGNORED")),
          100,
        );
      }),
    ]), /WEB_FIXTURE_SESSION_TERMINAL_TIMEOUT/u);
  } finally {
    clearTimeout(watchdog);
  }
});

test("exercise starts the Session terminal budget after ready and accepted submit", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-terminal-timeout-start-test-");
  const runtime = successfulExerciseRuntime();
  let finishTerminal;
  runtime.session.open = () => ({
    ready: new Promise((resolvePromise) => setTimeout(resolvePromise, 60)),
    terminal: new Promise((resolvePromise) => { finishTerminal = resolvePromise; }),
    close() {},
  });
  runtime.session.submit = async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
    setTimeout(() => finishTerminal({ outcome: "completed" }), 100);
    return {
      logicalRequest: logicalSubmitRequest(),
      receipt: sessionCommandResponse(),
    };
  };

  const result = await runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    runtime,
    terminalTimeoutMs: 180,
    redemptionBrowser: { async redeem() { return redemptionEvidence(); } },
  });

  assert.equal(result.kind, "web-chat-credit-runtime-exercised");
});

test("exercise observes a terminal rejection during submit without leaking it", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-terminal-rejection-test-");
  const runtime = successfulExerciseRuntime();
  let rejectTerminal;
  runtime.session.open = () => ({
    ready: Promise.resolve(),
    terminal: new Promise((_resolve, reject) => { rejectTerminal = reject; }),
    close() {},
  });
  runtime.session.submit = async () => {
    rejectTerminal(new Error("private terminal failure"));
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    return {
      logicalRequest: logicalSubmitRequest(),
      receipt: sessionCommandResponse(),
    };
  };
  const unhandled = [];
  const captureUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", captureUnhandled);
  try {
    await assert.rejects(
      runtimeFixture.exerciseWebChatCreditRuntime(environment, { runtime }),
      { message: "WEB_FIXTURE_SESSION_TERMINAL_FAILED" },
    );
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", captureUnhandled);
  }
});

test("exercise preserves submit failure when terminal also rejects without leaking it", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-submit-terminal-rejection-test-");
  const runtime = successfulExerciseRuntime();
  let rejectTerminal;
  runtime.session.open = () => ({
    ready: Promise.resolve(),
    terminal: new Promise((_resolve, reject) => { rejectTerminal = reject; }),
    close() {},
  });
  runtime.session.submit = async () => {
    rejectTerminal(new Error("private terminal failure"));
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    throw new Error("private submit failure");
  };
  const unhandled = [];
  const captureUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", captureUnhandled);
  try {
    await assert.rejects(
      runtimeFixture.exerciseWebChatCreditRuntime(environment, { runtime }),
      { message: "WEB_FIXTURE_SESSION_SUBMIT_FAILED" },
    );
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", captureUnhandled);
  }
});

test("exercise reopens the redemption code without following a post-setup symlink", async (t) => {
  const environment = await readyFixture(t, "kokoro-web-redemption-code-race-test-");
  const original = environment.KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE;
  const replacement = join(environment.KOKORO_WEB_FIXTURE_PRIVATE_DIR, "replacement-code.fixture");
  await writeFile(replacement, runtimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE"), { mode: 0o600 });
  await rm(original);
  await symlink(replacement, original);
  let browserInvoked = false;

  await assert.rejects(runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    runtime: successfulExerciseRuntime(),
    redemptionBrowser: {
      async redeem() {
        browserInvoked = true;
        return redemptionEvidence();
      },
    },
  }), /WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID/u);
  assert.equal(browserInvoked, false);
});

test("exercise closes login, dashboard, Session SSE terminal, replay, and Credit readback in order", async (t) => {
  assert.equal(typeof runtimeFixture.exerciseWebChatCreditRuntime, "function");
  const environment = await readyFixture(t, "kokoro-web-exercise-test-");
  const calls = [];
  const firstReceipt = sessionCommandResponse("accepted", "2026-08-09T12:00:00.000Z");
  const replayReceipt = sessionCommandResponse("applied", "2026-08-09T12:00:01.000Z");
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
        return { logicalRequest: logicalSubmitRequest(), receipt: firstReceipt };
      },
      async replay(logicalRequest) {
        calls.push("replay");
        assert.deepEqual(logicalRequest, logicalSubmitRequest());
        return replayReceipt;
      },
      async waitForTerminalSnapshot(sessionId) {
        calls.push("snapshot");
        assert.equal(sessionId, "session-runtime");
        return { userMessageCount: 1, assistantTerminalCount: 1, costSettled: true };
      },
    },
  };
  const redemptionBrowser = {
    async redeem(input) {
      calls.push("redeem-browser");
      assert.deepEqual(Object.keys(input), [
        "publicOrigin",
        "candidateHost",
        "publicCertificateAuthorityFile",
        "publicTlsCertificateFile",
        "auth",
        "rawCode",
      ]);
      assert.equal(input.publicOrigin, environment.KOKORO_WEB_FIXTURE_PUBLIC_ORIGIN);
      assert.equal(input.candidateHost, environment.KOKORO_WEB_FIXTURE_CANDIDATE_HOST);
      assert.match(input.publicCertificateAuthorityFile, /authority\.pem$/u);
      assert.match(input.publicTlsCertificateFile, /server\.pem$/u);
      assert.equal(input.auth.email, "runtime-fixture@example.com");
      assert.match(input.rawCode, /^KC1-/u);
      return redemptionEvidence();
    },
  };

  const result = await runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    runtime,
    redemptionBrowser,
  });

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
    ...redemptionEvidence(),
    ...runtimeLifecycleEvidence(),
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-exercised",
    browserJourneyClosed: true,
  });
  assert.deepEqual(calls, [
    "authenticate", "dashboard", "create", "open", "stream-ready", "submit",
    "stream-terminal", "stream-close", "replay", "snapshot", "dashboard", "redeem-browser",
  ]);
  const state = JSON.parse(await readFile(join(
    environment.KOKORO_WEB_FIXTURE_PRIVATE_DIR,
    "runtime-state.json",
  ), "utf8"));
  const journey = JSON.parse(await readFile(state.observationFile, "utf8"));
  assert.equal(journey.kind, "web-chat-credit-runtime-journey-evidence");
  assert.equal(JSON.stringify(journey).includes("KC1-"), false);
  await assert.rejects(
    runWebChatCreditRuntimeFixture(["observe"], environment),
    /WEB_FIXTURE_OBSERVATION_UNAVAILABLE/u,
  );
  await writeFile(state.lifecycleEvidenceFile, `${JSON.stringify({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-lifecycle-evidence",
    ...runtimeLifecycleEvidence(),
  })}\n`, { mode: 0o600 });
  assert.deepEqual(await runWebChatCreditRuntimeFixture(["observe"], environment), expected);
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
    "grant_authority",
  )), (error) => {
    assert.equal(
      error.message,
      "WEB_FIXTURE_SESSION_SUBMIT_FAILED_INTERNAL_UNAVAILABLE_SITE_BFF_GRANT_AUTHORITY",
    );
    assert.equal(error.message.includes("private"), false);
    return true;
  });
  await assert.rejects(attempt(failure(
    "command_conflict",
    "reconcile_receipt",
    "reconcile_receipt",
    "grant_validation",
  )), (error) => {
    assert.equal(
      error.message,
      "WEB_FIXTURE_SESSION_SUBMIT_FAILED_INTERNAL_UNAVAILABLE_SITE_BFF_GRANT_VALIDATION",
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
  const receipt = sessionCommandResponse();
  const session = {
    async create() { return { sessionId: "session-runtime", branchId: "branch-runtime", sessionVersion: 1 }; },
    open() { return { ready: Promise.resolve(), terminal, close() {} }; },
    async submit() {
      finishTerminal({ outcome: "completed" });
      return { logicalRequest: logicalSubmitRequest(), receipt };
    },
    async replay() { return receipt; },
    async waitForTerminalSnapshot() {
      return { userMessageCount: 1, assistantTerminalCount: 1, costSettled: true };
    },
  };

  const result = await runtimeFixture.exerciseWebChatCreditRuntime(environment, {
    session,
    redemptionBrowser: { async redeem() { return redemptionEvidence(); } },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-exercised",
    browserJourneyClosed: true,
  });
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
    new URL("../fixtures/web-chat-credit-runtime-browser.mjs", import.meta.url),
  ].map((path) => readFile(path, "utf8")));
  const source = sources.join("\n");

  assert.match(source, /import\("@kokoro\/site-scaffold"\)/u);
  assert.match(source, /from "@kokoro\/session-client"/u);
  assert.match(source, /from "playwright"/u);
  assert.match(source, /launchPersistentContext\(profileDirectory/u);
  assert.match(source, /--ignore-certificate-errors-spki-list=/u);
  assert.match(source, /Fetch\.fulfillRequest/u);
  assert.match(source, /document\.documentElement\.outerHTML/u);
  assert.match(source, /Continue confirmation result/u);
  assert.match(source, /WEB_FIXTURE_BROWSER_CODE_RETENTION_INVALID/u);
  assert.match(source, /O_NOFOLLOW/u);
  assert.match(
    source,
    /const \[originalRequest\] = await Promise\.all\(\[\s*page\.waitForRequest\([\s\S]*?getByRole\("button", \{ name: "Confirm redemption", exact: true \}\)\.click\(\),\s*confirmationFault\.completion,\s*\]\)/u,
  );
  assert.doesNotMatch(source, /const originalRequestPromise = page\.waitForRequest/u);
  assert.doesNotMatch(source, /\]\);\s*await confirmationFault\.completion/u);
  assert.doesNotMatch(source, /packages\/site-scaffold\/src|apps\/reference-site/u);
  assert.doesNotMatch(source, /kokoro-(?:platform|session|agent)\//u);
  assert.doesNotMatch(source, /ignoreHTTPSErrors|browserType\.launch\(/u);
  assert.doesNotMatch(source, /page\.evaluate\([\s\S]{0,4000}?fetch\(/u);
  assert.doesNotMatch(source, /process\.stderr\.write\(chunk\)/u);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.setItem/u);
  assert.equal(entry.pathname.startsWith(WEB_ROOT.pathname), true);
});
