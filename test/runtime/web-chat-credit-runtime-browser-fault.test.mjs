import assert from "node:assert/strict";
import test from "node:test";

import * as browserFixture from "../fixtures/web-chat-credit-runtime-browser.mjs";

const ORIGIN = new URL("https://web-chat-credit.fixture.local:4343");

function createCdpHarness(options = {}) {
  const commands = [];
  let requestPaused;
  const session = {
    on(event, handler) {
      if (event === "Fetch.requestPaused") requestPaused = handler;
    },
    async send(command, parameters) {
      commands.push([command, parameters]);
      if (command === "Fetch.disable" && options.disableNeverSettles === true) {
        return new Promise(() => {});
      }
      if (options.rejectCommands?.includes(command) === true) {
        throw new Error(`private ${command} failure`);
      }
    },
    async detach() {
      commands.push(["detach", undefined]);
    },
  };
  return Object.freeze({
    commands,
    context: Object.freeze({ async newCDPSession() { return session; } }),
    emit(responseStatusCode) {
      assert.equal(typeof requestPaused, "function");
      requestPaused({
        requestId: `confirmation-${String(responseStatusCode)}`,
        request: {
          url: `${ORIGIN.origin}/api/account/execute`,
          method: "POST",
        },
        responseStatusCode,
      });
    },
  });
}

function within(promise, milliseconds = 100) {
  let timer;
  return Promise.race([
    promise.then(
      (value) => Object.freeze({ kind: "resolved", value }),
      (error) => Object.freeze({ kind: "rejected", error }),
    ),
    new Promise((resolvePromise) => {
      timer = setTimeout(() => resolvePromise(Object.freeze({ kind: "deadline" })), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

test("confirmation response fault is exposed by the runtime fixture for deterministic CDP regression tests", () => {
  assert.equal(typeof browserFixture.createConfirmationResponseFault, "function");
});

test("confirmation response fault accepts only an exact optional action timeout", async () => {
  for (const options of [
    null,
    [],
    { extra: true },
    { timeoutMs: null },
    { timeoutMs: undefined },
    { timeoutMs: 0 },
    { timeoutMs: 30_001 },
    Object.create({ timeoutMs: 25 }),
  ]) {
    const harness = createCdpHarness();
    const outcome = await within(browserFixture.createConfirmationResponseFault(
      harness.context,
      Object.freeze({}),
      ORIGIN,
      options,
    ));
    if (outcome.kind === "resolved") {
      harness.emit(200);
      await outcome.value.completion;
      await outcome.value.close();
    }
    assert.equal(outcome.kind, "rejected");
    assert.equal(outcome.error?.message, "WEB_FIXTURE_BROWSER_CONFIRMATION_FAULT_INPUT_INVALID");
  }
});

test("confirmation response fault continues a non-success response once and rejects with a fixed code", async () => {
  const harness = createCdpHarness();
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
  );

  harness.emit(503);

  const outcome = await within(fault.completion);
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.message, "WEB_FIXTURE_BROWSER_CONFIRMATION_RESPONSE_REJECTED");
  assert.equal(fault.applied(), false);
  await fault.close();
  assert.deepEqual(harness.commands.map(([command]) => command), [
    "Fetch.enable",
    "Fetch.continueResponse",
    "Fetch.disable",
    "detach",
  ]);
});

test("confirmation response fault preserves the successful response fault injection", async () => {
  const harness = createCdpHarness();
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
  );

  harness.emit(200);

  assert.equal((await within(fault.completion)).kind, "resolved");
  assert.equal(fault.applied(), true);
  await fault.close();
  assert.deepEqual(harness.commands.map(([command]) => command), [
    "Fetch.enable",
    "Fetch.fulfillRequest",
    "Fetch.disable",
    "detach",
  ]);
  assert.deepEqual(harness.commands[1]?.[1], {
    requestId: "confirmation-200",
    responseCode: 200,
    responseHeaders: [
      { name: "content-type", value: "application/json" },
      { name: "cache-control", value: "no-store" },
    ],
    body: "ew==",
  });
});

test("confirmation response fault bounds a missing response with its action deadline", async () => {
  const harness = createCdpHarness();
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
    { timeoutMs: 25 },
  );

  const outcome = await within(fault.completion);
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.message, "WEB_FIXTURE_BROWSER_CONFIRMATION_RESPONSE_TIMEOUT");
  assert.equal(fault.applied(), false);
  await fault.close();
});

test("confirmation response fault bounds CDP close and still attempts detach", async () => {
  const harness = createCdpHarness({ disableNeverSettles: true });
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
    { timeoutMs: 25 },
  );
  harness.emit(200);
  assert.equal((await within(fault.completion)).kind, "resolved");

  const outcome = await within(fault.close());
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.message, "WEB_FIXTURE_BROWSER_CONFIRMATION_CDP_CLOSE_TIMEOUT");
  assert.deepEqual(harness.commands.map(([command]) => command), [
    "Fetch.enable",
    "Fetch.fulfillRequest",
    "Fetch.disable",
    "detach",
  ]);
});

test("confirmation response fault settles with a fixed code when continuing a rejection fails", async () => {
  const harness = createCdpHarness({ rejectCommands: ["Fetch.continueResponse"] });
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
    { timeoutMs: 100 },
  );
  harness.emit(503);

  const outcome = await within(fault.completion);
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.message, "WEB_FIXTURE_BROWSER_CONFIRMATION_RESPONSE_FAULT_FAILED");
  assert.equal(fault.applied(), false);
  await fault.close();
  assert.deepEqual(harness.commands.map(([command]) => command), [
    "Fetch.enable",
    "Fetch.continueResponse",
    "Fetch.disable",
    "detach",
  ]);
});

test("confirmation response fault settles with a fixed code when fulfillment fails", async () => {
  const harness = createCdpHarness({ rejectCommands: ["Fetch.fulfillRequest"] });
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
    { timeoutMs: 100 },
  );
  harness.emit(200);

  const outcome = await within(fault.completion);
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.message, "WEB_FIXTURE_BROWSER_CONFIRMATION_RESPONSE_FAULT_FAILED");
  assert.equal(fault.applied(), false);
  await fault.close();
  assert.deepEqual(harness.commands.map(([command]) => command), [
    "Fetch.enable",
    "Fetch.fulfillRequest",
    "Fetch.continueResponse",
    "Fetch.disable",
    "detach",
  ]);
});

test("confirmation response fault converts CDP close rejection and still attempts detach", async () => {
  const harness = createCdpHarness({ rejectCommands: ["Fetch.disable"] });
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
    { timeoutMs: 100 },
  );
  harness.emit(200);
  assert.equal((await within(fault.completion)).kind, "resolved");

  const outcome = await within(fault.close());
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.message, "WEB_FIXTURE_BROWSER_CONFIRMATION_CDP_CLOSE_FAILED");
  assert.deepEqual(harness.commands.map(([command]) => command), [
    "Fetch.enable",
    "Fetch.fulfillRequest",
    "Fetch.disable",
    "detach",
  ]);
});

test("confirmation response settlement preserves its primary rejection over CDP cleanup failure", async () => {
  assert.equal(typeof browserFixture.settleConfirmationResponseFault, "function");
  const harness = createCdpHarness({ rejectCommands: ["Fetch.disable"] });
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
    { timeoutMs: 100 },
  );
  harness.emit(503);

  await assert.rejects(
    browserFixture.settleConfirmationResponseFault(
      Promise.resolve(Object.freeze({ kind: "confirmation-request" })),
      Promise.resolve(),
      fault,
    ),
    { message: "WEB_FIXTURE_BROWSER_CONFIRMATION_RESPONSE_REJECTED" },
  );
  assert.deepEqual(harness.commands.map(([command]) => command), [
    "Fetch.enable",
    "Fetch.continueResponse",
    "Fetch.disable",
    "detach",
  ]);
});

test("confirmation response settlement reports CDP cleanup failure after successful injection", async () => {
  assert.equal(typeof browserFixture.settleConfirmationResponseFault, "function");
  const harness = createCdpHarness({ rejectCommands: ["Fetch.disable"] });
  const fault = await browserFixture.createConfirmationResponseFault(
    harness.context,
    Object.freeze({}),
    ORIGIN,
    { timeoutMs: 100 },
  );
  harness.emit(200);

  await assert.rejects(
    browserFixture.settleConfirmationResponseFault(
      Promise.resolve(Object.freeze({ kind: "confirmation-request" })),
      Promise.resolve(),
      fault,
    ),
    { message: "WEB_FIXTURE_BROWSER_CONFIRMATION_CDP_CLOSE_FAILED" },
  );
});
