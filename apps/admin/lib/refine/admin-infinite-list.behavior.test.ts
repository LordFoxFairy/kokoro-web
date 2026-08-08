/**
 * @vitest-environment happy-dom
 */

import {
  Refine,
  useInfiniteList,
  type GetListResponse,
} from "@refinedev/core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminDataProvider,
  adminInfiniteResult,
  adminNextPageParam,
  type AdminAudit,
} from "./admin-data-provider";

interface ProbeSnapshot {
  readonly data: Readonly<{
    pages: readonly GetListResponse<AdminAudit>[];
    pageParams: readonly unknown[];
  }> | undefined;
  readonly fetchNextPage: () => Promise<unknown>;
  readonly hasNextPage: boolean;
  readonly isSuccess: boolean;
}

interface AuditPagePayload {
  readonly items: readonly ReturnType<typeof audit>[];
  readonly nextPageToken: string | null;
}

const audit = (auditRef: string) => ({
  auditRef,
  actionCode: "site.publish",
  occurredAt: "2026-08-06T00:00:00.000Z",
});

function Probe({ siteId, onSnapshot }: Readonly<{
  siteId: string;
  onSnapshot: (snapshot: ProbeSnapshot) => void;
}>): null {
  const { query } = useInfiniteList<AdminAudit>({
    resource: "audit",
    pagination: { mode: "server", currentPage: 1, pageSize: 100 },
    filters: [{ field: "siteId", operator: "eq", value: siteId }],
    queryOptions: {
      getNextPageParam: adminNextPageParam,
      retry: false,
      staleTime: Infinity,
    },
  });
  onSnapshot({
    data: query.data,
    fetchNextPage: () => query.fetchNextPage(),
    hasNextPage: query.hasNextPage,
    isSuccess: query.isSuccess,
  });
  return null;
}

function queuedFetch(pagesByPath: Readonly<Record<string, readonly AuditPagePayload[]>>) {
  const queues = new Map(Object.entries(pagesByPath).map(([path, pages]) => [path, [...pages]]));
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const payload = queues.get(path)?.shift();
    if (payload === undefined) throw new Error(`unexpected Admin list request: ${path}`);
    return new Response(JSON.stringify({ data: payload }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function mountedProbe() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let snapshot: ProbeSnapshot | undefined;
  const onSnapshot = (next: ProbeSnapshot) => { snapshot = next; };

  return {
    current: () => {
      if (snapshot === undefined) throw new Error("probe has not rendered");
      return snapshot;
    },
    render: async (siteId: string) => {
      await act(async () => {
        root.render(createElement(Refine, {
          dataProvider: adminDataProvider,
          options: { disableTelemetry: true },
          resources: [{ name: "audit", list: "/audit" }],
        }, createElement(Probe, { siteId, onSnapshot })));
      });
    },
    unmount: async () => {
      await act(async () => { root.unmount(); });
    },
  };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (assertion()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  throw new Error("mounted Refine query did not reach the expected state");
}

function recordIds(snapshot: ProbeSnapshot): string[] {
  return adminInfiniteResult(snapshot.data).records.map((record) => String(record.id));
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("mounted Refine Admin infinite lists", () => {
  it("propagates opaque string cursors, stops at terminal pages, and isolates filter caches", async () => {
    const opaqueCursor = "opaque+a/2";
    const fetchMock = queuedFetch({
      "/api/control/audit?siteId=site-a": [
        { items: [audit("audit-a-1")], nextPageToken: opaqueCursor },
      ],
      [`/api/control/audit?siteId=site-a&pageToken=${encodeURIComponent(opaqueCursor)}`]: [
        { items: [audit("audit-a-2")], nextPageToken: null },
      ],
      "/api/control/audit?siteId=site-b": [
        { items: [audit("audit-b-1")], nextPageToken: null },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const probe = mountedProbe();

    try {
      await probe.render("site-a");
      await waitFor(() => recordIds(probe.current()).join() === "audit-a-1");
      expect(probe.current().hasNextPage).toBe(true);

      await act(async () => { await probe.current().fetchNextPage(); });
      await waitFor(() => recordIds(probe.current()).join() === "audit-a-1,audit-a-2");
      expect(probe.current().hasNextPage).toBe(false);
      expect(fetchMock).toHaveBeenNthCalledWith(2,
        `/api/control/audit?siteId=site-a&pageToken=${encodeURIComponent(opaqueCursor)}`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }));

      await act(async () => { await probe.current().fetchNextPage(); });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await probe.render("site-b");
      await waitFor(() => recordIds(probe.current()).join() === "audit-b-1");
      expect(fetchMock).toHaveBeenCalledTimes(3);

      await probe.render("site-a");
      await waitFor(() => recordIds(probe.current()).join() === "audit-a-1,audit-a-2");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      await probe.unmount();
    }
  });

  it("fails closed when a mounted query receives duplicate record IDs", async () => {
    const fetchMock = queuedFetch({
      "/api/control/audit?siteId=site-a": [
        { items: [audit("audit-duplicate")], nextPageToken: "cursor-a" },
      ],
      "/api/control/audit?siteId=site-a&pageToken=cursor-a": [
        { items: [audit("audit-duplicate")], nextPageToken: null },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const probe = mountedProbe();

    try {
      await probe.render("site-a");
      await waitFor(() => probe.current().hasNextPage);
      await act(async () => { await probe.current().fetchNextPage(); });
      await waitFor(() => (probe.current().data?.pages.length ?? 0) === 2);

      expect(probe.current().hasNextPage).toBe(false);
      expect(adminInfiniteResult(probe.current().data)).toEqual({
        records: [],
        error: expect.objectContaining({ statusCode: 502, message: "admin_resource_duplicate_item" }),
      });
      await act(async () => { await probe.current().fetchNextPage(); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await probe.unmount();
    }
  });

  it("fails closed when a mounted query receives an A-B-A cursor cycle", async () => {
    const fetchMock = queuedFetch({
      "/api/control/audit?siteId=site-a": [
        { items: [audit("audit-one")], nextPageToken: "cursor-a" },
      ],
      "/api/control/audit?siteId=site-a&pageToken=cursor-a": [
        { items: [audit("audit-two")], nextPageToken: "cursor-b" },
      ],
      "/api/control/audit?siteId=site-a&pageToken=cursor-b": [
        { items: [audit("audit-three")], nextPageToken: "cursor-a" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const probe = mountedProbe();

    try {
      await probe.render("site-a");
      await waitFor(() => probe.current().hasNextPage);
      await act(async () => { await probe.current().fetchNextPage(); });
      await waitFor(() => (probe.current().data?.pages.length ?? 0) === 2);
      await act(async () => { await probe.current().fetchNextPage(); });
      await waitFor(() => (probe.current().data?.pages.length ?? 0) === 3);

      expect(probe.current().hasNextPage).toBe(false);
      expect(adminInfiniteResult(probe.current().data)).toEqual({
        records: [],
        error: expect.objectContaining({ statusCode: 502, message: "admin_resource_cursor_loop" }),
      });
      await act(async () => { await probe.current().fetchNextPage(); });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      await probe.unmount();
    }
  });
});
