import { describe, expect, it } from "vitest";

type Item = Readonly<{ id: string }>;

async function subject() {
  const loaded = await import("./cursor-window").catch(() => null);
  expect(loaded).not.toBeNull();
  return loaded;
}

const limits = { identity: (item: Item) => item.id, maxItems: 4, maxPages: 3 } as const;

describe("bounded load-more cursor window", () => {
  it("appends complete pages and preserves every prior row", async () => {
    const cursor = await subject(); if (cursor === null) return;
    let state = cursor.resetCursorWindow<Item>();
    state = cursor.appendCursorPage(state, { items: [{ id: "one" }], nextPageToken: "p2" }, limits);
    state = cursor.appendCursorPage(state, { items: [{ id: "two" }], nextPageToken: null }, limits);
    expect(state.rows).toEqual([{ id: "one" }, { id: "two" }]);
    expect(state.pageCount).toBe(2);
    expect(state.nextPageToken).toBeNull();
  });

  it("rejects repeated cursors and duplicate rows atomically, then disables load-more", async () => {
    const cursor = await subject(); if (cursor === null) return;
    const first = cursor.appendCursorPage(cursor.resetCursorWindow<Item>(),
      { items: [{ id: "one" }], nextPageToken: "p2" }, limits);
    expect(() => cursor.appendCursorPage(first,
      { items: [{ id: "two" }], nextPageToken: "p2" }, limits)).toThrow("admin_cursor_window_loop");
    expect(() => cursor.appendCursorPage(first,
      { items: [{ id: "one" }, { id: "two" }], nextPageToken: null }, limits))
      .toThrow("admin_cursor_window_duplicate_item");
    expect(first.rows).toEqual([{ id: "one" }]);
    expect(cursor.clearNextPageToken(first)).toMatchObject({ rows: [{ id: "one" }], nextPageToken: null });
  });

  it("rejects cumulative page and item limits without appending any part of the page", async () => {
    const cursor = await subject(); if (cursor === null) return;
    const first = cursor.appendCursorPage(cursor.resetCursorWindow<Item>(),
      { items: [{ id: "one" }], nextPageToken: "p2" }, limits);
    expect(() => cursor.appendCursorPage(first,
      { items: [{ id: "two" }, { id: "three" }, { id: "four" }, { id: "five" }], nextPageToken: null }, limits))
      .toThrow("admin_cursor_window_item_limit");
    expect(() => cursor.appendCursorPage(first, { items: [{ id: "two" }], nextPageToken: "p3" },
      { ...limits, maxPages: 1 })).toThrow("admin_cursor_window_page_limit");
    expect(first.rows).toEqual([{ id: "one" }]);
  });

  it("reload creates a clean identity, cursor, row, and cumulative-limit state", async () => {
    const cursor = await subject(); if (cursor === null) return;
    const loaded = cursor.appendCursorPage(cursor.resetCursorWindow<Item>(),
      { items: [{ id: "one" }], nextPageToken: "p2" }, limits);
    expect(loaded.rows).toHaveLength(1);
    const reset = cursor.resetCursorWindow<Item>();
    expect(reset).toMatchObject({ rows: [], nextPageToken: null, pageCount: 0 });
    expect(reset.seenCursors.size).toBe(0);
    expect(reset.seenIdentities.size).toBe(0);
  });

  it("accepts only the newest asynchronous response generation", async () => {
    const cursor = await subject(); if (cursor === null) return;
    const requests = new cursor.LatestRequest();
    let resolveOld: ((value: string) => void) | undefined;
    const oldResponse = new Promise<string>((resolve) => { resolveOld = resolve; });
    const accepted: string[] = [];
    const apply = (response: Promise<string>) => {
      const generation = requests.begin();
      return response.then((value) => { if (requests.isCurrent(generation)) accepted.push(value); });
    };
    const old = apply(oldResponse);
    await apply(Promise.resolve("new"));
    resolveOld?.("old");
    await old;
    expect(accepted).toEqual(["new"]);
    requests.invalidate();
  });
});
