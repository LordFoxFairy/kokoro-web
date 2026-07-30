import { describe, expect, it, vi } from "vitest";

type Page = Readonly<{ items: readonly Readonly<{ id: string }>[]; nextPageToken: string | null }>;

async function subject() {
  const loaded = await import("./cursor-pagination").catch(() => null);
  expect(loaded).not.toBeNull();
  return loaded;
}

describe("collectCursorPages", () => {
  it("collects every page without dropping the terminal page", async () => {
    const pagination = await subject(); if (pagination === null) return;
    const pages = new Map<string | undefined, Page>([
      [undefined, { items: [{ id: "one" }], nextPageToken: "p2" }],
      ["p2", { items: [{ id: "two" }], nextPageToken: "p3" }],
      ["p3", { items: [{ id: "three" }], nextPageToken: null }],
    ]);
    const loader = vi.fn(async (cursor: string | undefined) => pages.get(cursor)!);
    await expect(pagination.collectCursorPages(loader, { identity: (item: { id: string }) => item.id,
      maxItems: 10, maxPages: 5, timeoutMs: 1_000 })).resolves.toEqual([
      { id: "one" }, { id: "two" }, { id: "three" },
    ]);
    expect(loader.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "p2", "p3"]);
  });

  it("fails loudly on a repeated cursor", async () => {
    const pagination = await subject(); if (pagination === null) return;
    const loader = async (cursor: string | undefined): Promise<Page> => ({ items: [{ id: cursor ?? "one" }],
      nextPageToken: "repeat" });
    await expect(pagination.collectCursorPages(loader, { identity: (item: { id: string }) => item.id,
      maxItems: 10, maxPages: 5, timeoutMs: 1_000 })).rejects.toThrow("admin_cursor_pagination_loop");
  });

  it("fails loudly on a duplicate identity without returning a partial collection", async () => {
    const pagination = await subject(); if (pagination === null) return;
    const loader = async (cursor: string | undefined): Promise<Page> => cursor === undefined
      ? { items: [{ id: "one" }], nextPageToken: "p2" }
      : { items: [{ id: "one" }, { id: "two" }], nextPageToken: null };
    await expect(pagination.collectCursorPages(loader, { identity: (item: { id: string }) => item.id,
      maxItems: 10, maxPages: 5, timeoutMs: 1_000 })).rejects.toThrow("admin_cursor_pagination_duplicate_item");
  });

  it("fails loudly instead of truncating item or page limits", async () => {
    const pagination = await subject(); if (pagination === null) return;
    await expect(pagination.collectCursorPages(async () => ({ items: [{ id: "one" }, { id: "two" }],
      nextPageToken: null }), { identity: (item: { id: string }) => item.id,
      maxItems: 1, maxPages: 5, timeoutMs: 1_000 })).rejects.toThrow("admin_cursor_pagination_item_limit");
    await expect(pagination.collectCursorPages(async (cursor: string | undefined) => ({
      items: [], nextPageToken: cursor === undefined ? "p2" : "p3" }),
    { identity: (item: { id: string }) => item.id, maxItems: 10, maxPages: 2,
      timeoutMs: 1_000 })).rejects.toThrow("admin_cursor_pagination_page_limit");
  });

  it("aborts the in-flight loader at the total deadline", async () => {
    const pagination = await subject(); if (pagination === null) return;
    const loader = (_cursor: string | undefined, signal: AbortSignal): Promise<Page> => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    await expect(pagination.collectCursorPages(loader, { identity: (item: { id: string }) => item.id,
      maxItems: 10, maxPages: 2, timeoutMs: 10 })).rejects.toThrow("admin_cursor_pagination_timeout");
  });
});
