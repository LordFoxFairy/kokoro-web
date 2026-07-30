import { describe, expect, it } from "vitest";

type Item = Readonly<{ id: string }>;

async function subject() {
  const loaded = await import("./cursor-window").catch(() => null);
  expect(loaded).not.toBeNull();
  return loaded;
}

const limits = { identity: (item: Item) => item.id, maxItems: 4, maxPages: 3 } as const;
const watermark = "2026-07-30T00:00:00.000Z";
const page = (items: readonly Item[], nextPageToken: string | null, membershipWatermark = watermark,
  observedAt = "2026-07-30T00:00:01.000Z") => ({ items, nextPageToken, membershipWatermark, observedAt });

describe("bounded load-more cursor window", () => {
  it("appends complete pages and preserves every prior row", async () => {
    const cursor = await subject(); if (cursor === null) return;
    let state = cursor.resetCursorWindow<Item>();
    state = cursor.appendCursorPage(state, page([{ id: "one" }], "p2"), limits);
    state = cursor.appendCursorPage(state, page([{ id: "two" }], null), limits);
    expect(state.rows).toEqual([{ id: "one" }, { id: "two" }]);
    expect(state.pageCount).toBe(2);
    expect(state.nextPageToken).toBeNull();
  });

  it("rejects repeated cursors and duplicate rows atomically, then disables load-more", async () => {
    const cursor = await subject(); if (cursor === null) return;
    const first = cursor.appendCursorPage(cursor.resetCursorWindow<Item>(),
      page([{ id: "one" }], "p2"), limits);
    expect(() => cursor.appendCursorPage(first,
      page([{ id: "two" }], "p2"), limits)).toThrow("admin_cursor_window_loop");
    expect(() => cursor.appendCursorPage(first,
      page([{ id: "one" }, { id: "two" }], null), limits))
      .toThrow("admin_cursor_window_duplicate_item");
    expect(first.rows).toEqual([{ id: "one" }]);
    expect(cursor.clearNextPageToken(first)).toMatchObject({ rows: [{ id: "one" }], nextPageToken: null });
  });

  it("rejects cumulative page and item limits without appending any part of the page", async () => {
    const cursor = await subject(); if (cursor === null) return;
    const first = cursor.appendCursorPage(cursor.resetCursorWindow<Item>(),
      page([{ id: "one" }], "p2"), limits);
    expect(() => cursor.appendCursorPage(first,
      page([{ id: "two" }, { id: "three" }, { id: "four" }, { id: "five" }], null), limits))
      .toThrow("admin_cursor_window_item_limit");
    expect(() => cursor.appendCursorPage(first, page([{ id: "two" }], "p3"),
      { ...limits, maxPages: 1 })).toThrow("admin_cursor_window_page_limit");
    expect(first.rows).toEqual([{ id: "one" }]);
  });

  it("reload creates a clean identity, cursor, row, and cumulative-limit state", async () => {
    const cursor = await subject(); if (cursor === null) return;
    const loaded = cursor.appendCursorPage(cursor.resetCursorWindow<Item>(),
      page([{ id: "one" }], "p2"), limits);
    expect(loaded.rows).toHaveLength(1);
    const reset = cursor.resetCursorWindow<Item>();
    expect(reset).toMatchObject({ rows: [], nextPageToken: null, pageCount: 0 });
    expect(reset.seenCursors.size).toBe(0);
    expect(reset.seenIdentities.size).toBe(0);
  });

  it("locks the first membership watermark and rejects drift atomically", async () => {
    const cursor = await subject(); if (cursor === null) return;
    const first = cursor.appendCursorPage(cursor.resetCursorWindow<Item>(), page([{ id: "one" }], "p2"), limits);
    expect(first.membershipWatermark).toBe(watermark);
    expect(() => cursor.appendCursorPage(first,
      page([{ id: "two" }], null, "2026-07-30T00:00:02.000Z", "2026-07-30T00:00:03.000Z"), limits))
      .toThrow("admin_cursor_window_watermark_drift");
    expect(first).toMatchObject({ rows: [{ id: "one" }], nextPageToken: "p2" });
  });

  it("rejects any page observed before its membership watermark", async () => {
    const cursor = await subject(); if (cursor === null) return;
    expect(() => cursor.appendCursorPage(cursor.resetCursorWindow<Item>(),
      page([{ id: "one" }], null, watermark, "2026-07-29T23:59:59.999Z"), limits))
      .toThrow("admin_cursor_window_observation_before_watermark");
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
