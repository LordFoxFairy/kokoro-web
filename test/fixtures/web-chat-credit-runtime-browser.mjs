import { createHash, X509Certificate } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, opendir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

const REDEMPTION_CODE =
  /^KC1-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{10}-[0-9A-HJKMNP-TV-Z]{32}-[0-9A-HJKMNP-TV-Z]{8}$/u;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const ACTION_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 120_000;
const CLEANUP_TIMEOUT_MS = 10_000;
const MAXIMUM_PROFILE_FILES = 50_000;
const MAXIMUM_PROFILE_BYTES = 512 * 1024 * 1024;
const PROFILE_SCAN_CHUNK_BYTES = 64 * 1024;

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function browserInput(input) {
  if (
    !exactObject(input, [
      "publicOrigin", "candidateHost", "publicCertificateAuthorityFile",
      "publicTlsCertificateFile", "auth", "rawCode",
    ]) ||
    !exactObject(input.auth, ["schemaVersion", "email", "password"]) ||
    input.auth.schemaVersion !== 1 || typeof input.auth.email !== "string" ||
    typeof input.auth.password !== "string" || !REDEMPTION_CODE.test(input.rawCode) ||
    typeof input.publicCertificateAuthorityFile !== "string" ||
    typeof input.publicTlsCertificateFile !== "string"
  ) throw new Error("WEB_FIXTURE_BROWSER_REDEMPTION_INPUT_INVALID");
  let origin;
  try {
    origin = new URL(input.publicOrigin);
  } catch {
    throw new Error("WEB_FIXTURE_BROWSER_REDEMPTION_INPUT_INVALID");
  }
  if (
    origin.protocol !== "https:" || origin.origin !== input.publicOrigin ||
    origin.hostname !== input.candidateHost || origin.pathname !== "/" ||
    origin.search !== "" || origin.hash !== ""
  ) throw new Error("WEB_FIXTURE_BROWSER_REDEMPTION_INPUT_INVALID");
  return origin;
}

function withTimeout(promise, milliseconds, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(code)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function certificateAuthority(input) {
  const [authorityBytes, certificateBytes] = await Promise.all([
    readFile(input.publicCertificateAuthorityFile),
    readFile(input.publicTlsCertificateFile),
  ]);
  const authority = new X509Certificate(authorityBytes);
  const certificate = new X509Certificate(certificateBytes);
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  const now = Date.now();
  if (
    authority.ca !== true || certificate.ca !== false ||
    !certificate.checkIssued(authority) || !certificate.verify(authority.publicKey) ||
    certificate.checkHost(input.candidateHost) !== input.candidateHost ||
    !Number.isFinite(validFrom) || !Number.isFinite(validTo) || validFrom > now || validTo <= now
  ) throw new Error("WEB_FIXTURE_BROWSER_TLS_AUTHORITY_INVALID");
  const pin = createHash("sha256").update(certificate.publicKey.export({
    type: "spki",
    format: "der",
  })).digest("base64");
  return Object.freeze({
    pin,
    validFrom,
    validTo,
  });
}

async function navigationUsesPinnedTls(response, input, authority) {
  if (response === null || new URL(response.url()).origin !== input.publicOrigin) return false;
  const details = await response.securityDetails();
  const nowSeconds = Math.floor(Date.now() / 1_000);
  return details !== null && details.protocol === "TLS 1.3" &&
    details.subjectName === input.candidateHost &&
    Number.isSafeInteger(details.validFrom) && Number.isSafeInteger(details.validTo) &&
    details.validFrom <= nowSeconds && details.validTo > nowSeconds &&
    details.validFrom * 1_000 === authority.validFrom && details.validTo * 1_000 === authority.validTo;
}

async function availableCreditTotal(page) {
  const heading = page.getByRole("heading", { name: "Credits", exact: true, level: 2 });
  await heading.waitFor({ state: "visible" });
  const valuesLocator = heading.locator("xpath=ancestor::section[1]").locator("strong");
  await valuesLocator.first().waitFor({ state: "visible" });
  const values = await valuesLocator.allTextContents();
  if (values.length < 1 || values.some((value) => !/^(?:0|[1-9][0-9]*)$/u.test(value))) {
    throw new Error("WEB_FIXTURE_BROWSER_CREDIT_READBACK_INVALID");
  }
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

function requestUrl(request) {
  try {
    return new URL(request.url());
  } catch {
    return null;
  }
}

function accountPath(request, suffix) {
  const url = requestUrl(request);
  return url !== null && url.pathname === `/api/account/${suffix}` && url.search === "" && url.hash === "";
}

function requestJson(request) {
  const serialized = request.postData();
  if (serialized === null) throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
  }
  return Object.freeze({ serialized, value });
}

function mutationRecord(request, origin, rawCode) {
  const url = requestUrl(request);
  if (
    url === null || url.origin !== origin.origin || url.search !== "" || url.hash !== "" ||
    request.method() !== "POST"
  ) throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
  const headers = request.headers();
  if (
    headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
    typeof headers["x-kokoro-browser-csrf"] !== "string" ||
    !SAFE_TEXT.test(headers["x-kokoro-browser-csrf"])
  ) throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
  const { serialized, value } = requestJson(request);
  if (url.pathname === "/api/account/prepare") {
    if (
      !exactObject(value, ["operation", "flowRef"]) ||
      !["redemption.preview", "redemption.confirm"].includes(value.operation) ||
      typeof value.flowRef !== "string" || !SAFE_TEXT.test(value.flowRef) || serialized.includes(rawCode)
    ) throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
    return Object.freeze({
      label: value.operation === "redemption.preview" ? "preview.prepare" : "confirm.prepare",
      flowRef: value.flowRef,
      previewFlowRef: null,
      containsCode: false,
    });
  }
  if (url.pathname === "/api/account/execute" && value.operation === "redemption.preview") {
    if (
      !exactObject(value, ["operation", "flowRef", "code"]) ||
      typeof value.flowRef !== "string" || !SAFE_TEXT.test(value.flowRef) || value.code !== rawCode
    ) throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
    return Object.freeze({
      label: "preview.execute",
      flowRef: value.flowRef,
      previewFlowRef: null,
      containsCode: serialized.includes(rawCode),
    });
  }
  if (url.pathname === "/api/account/execute" && value.operation === "redemption.confirm") {
    if (
      !exactObject(value, ["operation", "flowRef", "previewFlowRef", "legalAccepted"]) ||
      typeof value.flowRef !== "string" || !SAFE_TEXT.test(value.flowRef) ||
      typeof value.previewFlowRef !== "string" || !SAFE_TEXT.test(value.previewFlowRef) ||
      value.legalAccepted !== true || serialized.includes(rawCode)
    ) throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
    return Object.freeze({
      label: "confirm.execute",
      flowRef: value.flowRef,
      previewFlowRef: value.previewFlowRef,
      containsCode: false,
    });
  }
  if (url.pathname === "/api/account/recover") {
    if (
      !exactObject(value, ["operation", "flowRef"]) || value.operation !== "redemption.confirm" ||
      typeof value.flowRef !== "string" || !SAFE_TEXT.test(value.flowRef) || serialized.includes(rawCode)
    ) throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
    return Object.freeze({
      label: "confirm.recover",
      flowRef: value.flowRef,
      previewFlowRef: null,
      containsCode: false,
    });
  }
  throw new Error("WEB_FIXTURE_BROWSER_MUTATION_REQUEST_INVALID");
}

export function createBrowserAudit(origin, rawCode) {
  const mutations = [];
  const navigationUrls = [];
  const headerInspections = [];
  let requestViolation = false;
  let responseViolation = false;
  let secretViolation = false;
  let browserConsoleCount = 0;
  let browserPageErrorCount = 0;
  let redemptionDashboardReadCount = 0;
  let redemptionExecuteRequestCount = 0;
  let redemptionRecoveryRequestCount = 0;
  return Object.freeze({
    attach(page) {
      page.on("framenavigated", (frame) => {
        const url = frame.url();
        navigationUrls.push(url);
        secretViolation ||= url.includes(rawCode);
      });
      page.on("console", (message) => {
        browserConsoleCount += 1;
        secretViolation ||= message.text().includes(rawCode);
      });
      page.on("pageerror", (error) => {
        browserPageErrorCount += 1;
        secretViolation ||= error.message.includes(rawCode);
      });
      page.on("request", (request) => {
        const url = requestUrl(request);
        const serializedHeaders = JSON.stringify(request.headers());
        const body = request.postData();
        secretViolation ||= request.url().includes(rawCode) || serializedHeaders.includes(rawCode);
        headerInspections.push(request.allHeaders().then((headers) => {
          secretViolation ||= JSON.stringify(headers).includes(rawCode);
        }).catch(() => {
          requestViolation = true;
        }));
        const accountMutation = url !== null && [
          "/api/account/prepare", "/api/account/execute", "/api/account/recover",
        ].includes(url.pathname);
        if (accountMutation) {
          try {
            const record = mutationRecord(request, origin, rawCode);
            mutations.push(record);
            if (body?.includes(rawCode) && !record.containsCode) secretViolation = true;
          } catch {
            requestViolation = true;
            if (body?.includes(rawCode)) secretViolation = true;
          }
          return;
        }
        if (body?.includes(rawCode)) secretViolation = true;
        if (url !== null && !["GET", "HEAD"].includes(request.method()) && url.origin !== origin.origin) {
          requestViolation = true;
        }
      });
      page.on("response", (response) => {
        const request = response.request();
        const url = requestUrl(request);
        const kind = accountPath(request, "dashboard") ? "dashboard" :
          accountPath(request, "execute") ? "execute" :
          accountPath(request, "recover") ? "recover" : null;
        if (kind === null) return;
        const expectedMethod = kind === "dashboard" ? "GET" : "POST";
        if (
          url === null || url.origin !== origin.origin || request.method() !== expectedMethod ||
          response.status() < 200 || response.status() >= 300 || response.fromServiceWorker()
        ) {
          responseViolation = true;
          return;
        }
        if (kind === "dashboard") redemptionDashboardReadCount += 1;
        else if (kind === "execute") redemptionExecuteRequestCount += 1;
        else redemptionRecoveryRequestCount += 1;
      });
    },
    async finalize() {
      await Promise.all(headerInspections);
      const labels = mutations.map((record) => record.label);
      const expectedLabels = [
        "preview.prepare", "preview.execute", "confirm.prepare", "confirm.execute", "confirm.recover",
      ];
      const [previewPrepare, previewExecute, confirmPrepare, confirmExecute, confirmationRecovery] = mutations;
      const authorityEnforced = !requestViolation && !responseViolation &&
        labels.length === expectedLabels.length &&
        labels.every((label, index) => label === expectedLabels[index]) &&
        previewPrepare?.flowRef === previewExecute?.flowRef &&
        confirmPrepare?.flowRef === confirmExecute?.flowRef &&
        confirmExecute?.previewFlowRef === previewExecute?.flowRef &&
        confirmationRecovery?.flowRef === confirmExecute?.flowRef &&
        mutations.filter((record) => record.containsCode).length === 1;
      return Object.freeze({
        browserMutationAuthorityEnforced: authorityEnforced,
        redemptionSameFlowReplay: authorityEnforced &&
          confirmationRecovery.flowRef === confirmExecute.flowRef,
        redemptionSecretRequestsConfined: !secretViolation &&
          navigationUrls.every((url) => !url.includes(rawCode)),
        redemptionDashboardReadCount,
        redemptionExecuteRequestCount,
        redemptionRecoveryRequestCount,
        browserConsoleCount,
        browserPageErrorCount,
      });
    },
  });
}

async function browserSurfacesLeakFree(page, context, rawCode) {
  const surfaces = await page.evaluate(async (secret) => {
    const storedValues = (storage) => Array.from(
      { length: storage.length },
      (_value, index) => storage.key(index),
    ).flatMap((key) => key === null ? [] : [key, storage.getItem(key) ?? ""]);
    const databaseNames = typeof indexedDB.databases === "function"
      ? (await indexedDB.databases()).flatMap((database) => database.name === undefined ? [] : [database.name])
      : ["indexed-db-enumeration-unavailable"];
    const cacheNames = "caches" in window ? await caches.keys() : ["cache-storage-unavailable"];
    const registrations = "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : [{ scope: "service-worker-enumeration-unavailable" }];
    const inputValues = Array.from(document.querySelectorAll("input"), (element) => element.value);
    const values = [
      window.location.href,
      document.documentElement.textContent ?? "",
      document.documentElement.outerHTML,
      ...inputValues,
      ...storedValues(window.localStorage),
      ...storedValues(window.sessionStorage),
      ...databaseNames,
      ...cacheNames,
      ...registrations.map((registration) => registration.scope),
    ];
    return Object.freeze({
      secretAbsent: values.every((value) => !value.includes(secret)),
      redemptionInputCleared: Array.from(
        document.querySelectorAll('input[name="code"]'),
        (element) => element.value,
      ).every((value) => value === ""),
      indexedDbEmpty: databaseNames.length === 0,
      cacheStorageEmpty: cacheNames.length === 0,
      serviceWorkersEmpty: registrations.length === 0,
    });
  }, rawCode);
  const cookies = await context.cookies();
  const cookiesClear = cookies.every((cookie) => [
    cookie.name, cookie.value, cookie.domain, cookie.path,
  ].every((value) => !value.includes(rawCode)));
  return surfaces.secretAbsent && surfaces.redemptionInputCleared && surfaces.indexedDbEmpty &&
    surfaces.cacheStorageEmpty && surfaces.serviceWorkersEmpty && cookiesClear;
}

async function fileContainsSecret(path, secret, budget) {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("WEB_FIXTURE_BROWSER_PROFILE_INVALID");
  budget.files += 1;
  budget.bytes += size;
  if (budget.files > MAXIMUM_PROFILE_FILES || budget.bytes > MAXIMUM_PROFILE_BYTES) {
    throw new Error("WEB_FIXTURE_BROWSER_PROFILE_INVALID");
  }
  const secretBytes = Buffer.from(secret, "utf8");
  const buffer = Buffer.allocUnsafe(PROFILE_SCAN_CHUNK_BYTES);
  let tail = Buffer.alloc(0);
  const handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
  try {
    let position = 0;
    while (position < size) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const combined = Buffer.concat([tail, buffer.subarray(0, bytesRead)]);
      if (combined.indexOf(secretBytes) !== -1) return true;
      tail = combined.subarray(Math.max(0, combined.length - (secretBytes.length - 1)));
    }
    return false;
  } finally {
    await handle.close();
  }
}

async function profileContainsSecret(root, secret) {
  const budget = { files: 0, bytes: 0 };
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop();
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const path = join(directory, entry.name);
      if (path.includes(secret)) return true;
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile() && await fileContainsSecret(path, secret, budget)) return true;
    }
  }
  return false;
}

function confirmationRequest(request, rawCode) {
  const { value } = requestJson(request);
  if (
    !accountPath(request, "execute") || value.operation !== "redemption.confirm" ||
    !exactObject(value, ["operation", "flowRef", "previewFlowRef", "legalAccepted"]) ||
    value.legalAccepted !== true || typeof value.flowRef !== "string" || !SAFE_TEXT.test(value.flowRef) ||
    typeof value.previewFlowRef !== "string" || !SAFE_TEXT.test(value.previewFlowRef) ||
    request.postData().includes(rawCode)
  ) throw new Error("WEB_FIXTURE_BROWSER_CONFIRMATION_REQUEST_INVALID");
  return Object.freeze({ flowRef: value.flowRef, previewFlowRef: value.previewFlowRef });
}

function recoveryRequest(request, rawCode) {
  const { value } = requestJson(request);
  if (
    !accountPath(request, "recover") || !exactObject(value, ["operation", "flowRef"]) ||
    value.operation !== "redemption.confirm" || typeof value.flowRef !== "string" ||
    !SAFE_TEXT.test(value.flowRef) || request.postData().includes(rawCode)
  ) throw new Error("WEB_FIXTURE_BROWSER_RECOVERY_REQUEST_INVALID");
  return Object.freeze({ flowRef: value.flowRef });
}

function requestHasOperation(request, suffix, operation) {
  if (!accountPath(request, suffix) || request.method() !== "POST") return false;
  try {
    return requestJson(request).value.operation === operation;
  } catch {
    return false;
  }
}

async function createConfirmationResponseFault(context, page, origin) {
  const session = await context.newCDPSession(page);
  let applied = false;
  let settled = false;
  let completionFinished = false;
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolvePromise, rejectPromise) => {
    resolveCompletion = resolvePromise;
    rejectCompletion = rejectPromise;
  });
  session.on("Fetch.requestPaused", (event) => {
    void (async () => {
      const url = new URL(event.request.url);
      if (
        settled || url.origin !== origin.origin || url.pathname !== "/api/account/execute" ||
        event.request.method !== "POST" || !Number.isSafeInteger(event.responseStatusCode) ||
        event.responseStatusCode < 200 || event.responseStatusCode >= 300
      ) {
        await session.send("Fetch.continueResponse", { requestId: event.requestId });
        return;
      }
      settled = true;
      applied = true;
      await session.send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: event.responseStatusCode,
        responseHeaders: [
          { name: "content-type", value: "application/json" },
          { name: "cache-control", value: "no-store" },
        ],
        body: Buffer.from("{", "utf8").toString("base64"),
      });
      completionFinished = true;
      resolveCompletion();
    })().catch(async (error) => {
      if (!completionFinished) {
        completionFinished = true;
        settled = true;
        try {
          await session.send("Fetch.continueResponse", { requestId: event.requestId });
        } catch {
          // The context cleanup below remains authoritative if the paused request already ended.
        }
        rejectCompletion(error);
      }
    });
  });
  await session.send("Fetch.enable", {
    patterns: [{ urlPattern: "*://*/api/account/execute", requestStage: "Response" }],
  });
  return Object.freeze({
    completion,
    applied: () => applied,
    async close() {
      await session.send("Fetch.disable");
      await session.detach();
    },
  });
}

async function createBrowserCacheFence(context, page) {
  const session = await context.newCDPSession(page);
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await session.send("Network.clearBrowserCache");
    } finally {
      try {
        await session.send("Network.disable");
      } finally {
        await session.detach();
      }
    }
  }
  try {
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    await session.send("Network.clearBrowserCache");
  } catch (error) {
    try {
      await close();
    } catch {
      // The setup failure stays authoritative after every cleanup action was attempted.
    }
    throw error;
  }
  return Object.freeze({ close });
}

async function performRedemptionJourney(page, context, input, origin, authority, audit) {
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  audit.attach(page);

  const loginResponse = await page.goto(new URL("/account", origin).href, { waitUntil: "domcontentloaded" });
  const browserTlsAuthorityPinned = await navigationUsesPinnedTls(loginResponse, input, authority);
  await page.getByLabel("Email", { exact: true }).fill(input.auth.email);
  await page.getByLabel("Password", { exact: true }).fill(input.auth.password);
  await Promise.all([
    page.waitForURL((url) => url.origin === origin.origin && url.pathname === "/"),
    page.getByRole("button", { name: "Continue", exact: true }).click(),
  ]);
  await page.goto(new URL("/account", origin).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Account", exact: true, level: 1 }).waitFor();
  const availableBefore = await availableCreditTotal(page);

  const redemption = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Redeem a code", exact: true, level: 2 }),
  });
  await redemption.waitFor({ state: "visible" });
  await redemption.getByLabel("Code", { exact: true }).fill(input.rawCode);
  await Promise.all([
    page.waitForRequest((request) => requestHasOperation(request, "execute", "redemption.preview")),
    redemption.getByRole("button", { name: "Preview", exact: true }).click(),
  ]);
  const previewHeading = redemption.getByRole("heading", { level: 3 });
  await previewHeading.waitFor({ state: "visible" });
  const productLabel = (await previewHeading.textContent())?.trim() ?? "";
  if (!SAFE_TEXT.test(productLabel) || productLabel.includes(input.rawCode)) {
    throw new Error("WEB_FIXTURE_BROWSER_PREVIEW_INVALID");
  }
  const previewInputCleared = await redemption.locator('input[name="code"]').evaluateAll(
    (elements) => elements.every((element) => element.value === ""),
  );
  if (!previewInputCleared) throw new Error("WEB_FIXTURE_BROWSER_CODE_RETENTION_INVALID");
  const legalAcceptance = redemption.getByRole("checkbox");
  if (await legalAcceptance.count() === 1) await legalAcceptance.check();

  const confirmationFault = await createConfirmationResponseFault(context, page, origin);
  const [originalRequest] = await Promise.all([
    page.waitForRequest((request) => requestHasOperation(request, "execute", "redemption.confirm")),
    redemption.getByRole("button", { name: "Confirm redemption", exact: true }).click(),
    confirmationFault.completion,
  ]).finally(() => confirmationFault.close());
  const confirmation = confirmationRequest(originalRequest, input.rawCode);
  const continuation = redemption.getByRole("button", { name: "Continue confirmation result", exact: true });
  await continuation.waitFor({ state: "visible" });
  const [continuedRequest] = await Promise.all([
    page.waitForRequest((request) => requestHasOperation(request, "recover", "redemption.confirm")),
    continuation.click(),
  ]);
  const recovery = recoveryRequest(continuedRequest, input.rawCode);
  await page.getByText("Code redeemed. Your account has been refreshed.", { exact: true })
    .waitFor({ state: "visible" });
  const availableAfter = await availableCreditTotal(page);
  const products = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Products & entitlements", exact: true, level: 2 }),
  });
  await products.getByText(productLabel, { exact: true }).waitFor({ state: "visible" });
  const browserSurfacesClear = await browserSurfacesLeakFree(page, context, input.rawCode);
  const auditEvidence = await audit.finalize();
  const redemptionRecoveryContinuedViaUi = confirmationFault.applied() &&
    confirmation.flowRef === recovery.flowRef;
  const evidence = Object.freeze({
    accountRedemptionPage: true,
    redemptionPreviewed: true,
    redemptionConfirmed: true,
    redemptionBalanceIncreased: availableAfter > availableBefore,
    redemptionProductVisible: true,
    redemptionSameFlowReplay: auditEvidence.redemptionSameFlowReplay &&
      confirmation.flowRef === recovery.flowRef,
    redemptionRecoveryContinuedViaUi,
    redemptionSecretLeakFree: auditEvidence.redemptionSecretRequestsConfined && browserSurfacesClear,
    browserMutationAuthorityEnforced: auditEvidence.browserMutationAuthorityEnforced,
    browserTlsAuthorityPinned,
    redemptionDashboardReadCount: auditEvidence.redemptionDashboardReadCount,
    redemptionExecuteRequestCount: auditEvidence.redemptionExecuteRequestCount,
    redemptionRecoveryRequestCount: auditEvidence.redemptionRecoveryRequestCount,
    browserConsoleCount: auditEvidence.browserConsoleCount,
    browserPageErrorCount: auditEvidence.browserPageErrorCount,
  });
  if (
    Object.entries(evidence).some(([name, value]) => name.endsWith("Count") ? value !== (
      name === "redemptionDashboardReadCount" ? 3 :
      name === "redemptionExecuteRequestCount" ? 2 :
      name === "redemptionRecoveryRequestCount" ? 1 : 0
    ) : value !== true)
  ) throw new Error("WEB_FIXTURE_BROWSER_REDEMPTION_EVIDENCE_INVALID");
  return evidence;
}

export async function redeemAccountInChromium(input, dependencies = {}) {
  const origin = browserInput(input);
  const browserType = dependencies.browserType ?? chromium;
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const cleanupTimeoutMs = dependencies.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1 || totalTimeoutMs > TOTAL_TIMEOUT_MS ||
    !Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > CLEANUP_TIMEOUT_MS
  ) throw new Error("WEB_FIXTURE_BROWSER_REDEMPTION_INPUT_INVALID");
  let context;
  let profileDirectory;
  let evidence;
  let failure;
  let profileSecretLeakFree = false;
  let acceptLaunchedContext = true;
  try {
    profileDirectory = await mkdtemp(join(tmpdir(), "kokoro-web-redemption-profile-"));
    await chmod(profileDirectory, 0o700);
    await withTimeout((async () => {
      const authority = await certificateAuthority(input);
      const launchedContext = await browserType.launchPersistentContext(profileDirectory, {
        headless: true,
        timeout: totalTimeoutMs,
        args: [
          `--host-resolver-rules=MAP ${input.candidateHost} 127.0.0.1`,
          `--ignore-certificate-errors-spki-list=${authority.pin}`,
          "--no-proxy-server",
        ],
        serviceWorkers: "block",
      });
      if (!acceptLaunchedContext) {
        try {
          await withTimeout(
            launchedContext.close(),
            cleanupTimeoutMs,
            "WEB_FIXTURE_BROWSER_CLEANUP_TIMEOUT",
          );
        } finally {
          await rm(profileDirectory, { recursive: true, force: true, maxRetries: 2 });
        }
        return;
      }
      context = launchedContext;
      const pages = context.pages();
      const page = pages.length === 0 ? await context.newPage() : pages[0];
      const audit = createBrowserAudit(origin, input.rawCode);
      const cacheFence = await createBrowserCacheFence(context, page);
      try {
        evidence = await performRedemptionJourney(page, context, input, origin, authority, audit);
      } finally {
        await cacheFence.close();
      }
    })(), totalTimeoutMs, "WEB_FIXTURE_BROWSER_REDEMPTION_TIMEOUT");
  } catch (error) {
    acceptLaunchedContext = false;
    failure = error;
  }
  acceptLaunchedContext = false;

  const cleanupStartedAt = Date.now();
  const cleanupSlice = () => Math.max(1, Math.min(
    Math.floor(cleanupTimeoutMs / 3),
    cleanupTimeoutMs - (Date.now() - cleanupStartedAt),
  ));
  let contextClosed = context === undefined;
  if (context !== undefined) {
    try {
      await withTimeout(context.close(), cleanupSlice(), "WEB_FIXTURE_BROWSER_CLEANUP_TIMEOUT");
      contextClosed = true;
    } catch (error) {
      failure ??= error;
    }
  }
  if (profileDirectory !== undefined && contextClosed) {
    try {
      profileSecretLeakFree = !await withTimeout(
        profileContainsSecret(profileDirectory, input.rawCode),
        cleanupSlice(),
        "WEB_FIXTURE_BROWSER_PROFILE_SCAN_TIMEOUT",
      );
      if (!profileSecretLeakFree) failure ??= new Error("WEB_FIXTURE_BROWSER_PROFILE_SECRET_RETAINED");
    } catch (error) {
      failure ??= error;
    }
  }
  if (profileDirectory !== undefined) {
    try {
      await withTimeout(
        rm(profileDirectory, { recursive: true, force: true, maxRetries: 2 }),
        Math.max(1, cleanupTimeoutMs - (Date.now() - cleanupStartedAt)),
        "WEB_FIXTURE_BROWSER_CLEANUP_TIMEOUT",
      );
      if (await lstat(profileDirectory).catch(() => null) !== null) {
        throw new Error("WEB_FIXTURE_BROWSER_PROFILE_RETAINED");
      }
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined || evidence === undefined || !profileSecretLeakFree) {
    throw new Error("WEB_FIXTURE_BROWSER_REDEMPTION_FAILED");
  }
  return Object.freeze({ ...evidence, browserProfileRemoved: true });
}
