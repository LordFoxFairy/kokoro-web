/**
 * @vitest-environment happy-dom
 */

import { Refine } from "@refinedev/core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommerceResourceList } from "@/components/commerce/commerce-resource-list";
import { adminDataProvider } from "@/lib/refine/admin-data-provider";

const mocks = vi.hoisted(() => ({
  admin: {
    siteId: "site-a",
    authorityFingerprint: "authority-epoch-1",
    can: (): boolean => true,
  },
  reload: undefined as (() => void) | undefined,
}));

vi.mock("@/components/shell/app-shell", () => ({ useAdmin: () => mocks.admin }));
vi.mock("next/link", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    element("a", { href }, children) };
});
vi.mock("@ant-design/icons", async () => {
  const { createElement: element } = await import("react");
  return { DownOutlined: () => element("span", null, "down") };
});
vi.mock("antd", async () => {
  const { createElement: element } = await import("react");
  return {
    Alert: ({ message, description }: { message?: React.ReactNode; description?: React.ReactNode }) =>
      element("div", { role: "alert" }, message, description),
    Button: ({ children, disabled, onClick }: { children?: React.ReactNode; disabled?: boolean;
      onClick?: () => void }) => element("button", { disabled, onClick }, children),
  };
});
vi.mock("@ant-design/pro-components", async () => {
  const { createElement: element } = await import("react");
  return {
    PageContainer: ({ children }: { children?: React.ReactNode }) => element("section", null, children),
    ProTable: ({ dataSource, options }: {
      dataSource?: readonly Readonly<{ id?: unknown }>[];
      options?: Readonly<{ reload?: () => void }>;
    }) => {
      mocks.reload = options?.reload;
      return element("div", { "data-testid": "commerce-rows" },
        ...(dataSource ?? []).map((row) => element("span", { key: String(row.id) }, String(row.id))));
    },
  };
});

const batch = (siteId: string, batchRef: string) => ({
  id: batchRef,
  siteId,
  batchRef,
  redemptionProgramRevisionRef: `redemption:${siteId}`,
  state: "draft",
  approvalState: "pending",
  inventoryCount: 1,
  createdByOperatorRef: "operator:maker",
  startsAt: null,
  endsAt: null,
  createdAt: "2026-08-09T00:00:00.000Z",
  activatedAt: null,
  exportReceipt: {
    batchRef,
    exportCommandId: "22222222-2222-4222-8222-222222222222",
    exportedToOperatorRef: "operator:maker",
    codeCount: 1,
    exportedAt: "2026-08-09T00:00:00.000Z",
  },
});

function okPage(siteId: string, batchRef: string): Response {
  return new Response(JSON.stringify({ data: {
    items: [batch(siteId, batchRef)],
    nextPageToken: null,
    observedAt: "2026-08-09T00:00:00.000Z",
  } }), { status: 200, headers: { "content-type": "application/json" } });
}

function forbidden(): Response {
  return new Response(JSON.stringify({ error: { code: "auth.forbidden", message: "forbidden" } }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

function deferredResponse(): Readonly<{ promise: Promise<Response>; resolve: (response: Response) => void }> {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => { resolve = next; });
  return { promise, resolve };
}

function setAuthority(siteId: string, fingerprint: string, canRead = true): void {
  mocks.admin = {
    siteId,
    authorityFingerprint: fingerprint,
    can: () => canRead,
  };
}

function mountedList() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async () => {
    await act(async () => {
      root.render(createElement(Refine, {
        dataProvider: adminDataProvider,
        resources: [{ name: "code-batches", list: "/commerce/code-batches" }],
        options: {
          disableTelemetry: true,
          disableRouteChangeHandler: true,
          reactQuery: { clientConfig: { defaultOptions: { queries: { retry: false } } } },
        },
      }, createElement(CommerceResourceList, {
        resource: "code-batches",
        title: "Code Batches",
        description: "batches",
        detailBase: "/commerce/code-batches",
        readPermission: "commerce.code-batch.read",
        columns: [],
      })));
    });
  };
  return {
    render,
    text: () => container.textContent ?? "",
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (assertion()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  throw new Error("Commerce query did not reach the expected state");
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.reload = undefined;
  setAuthority("site-a", "authority-epoch-1");
  document.body.replaceChildren();
});

describe("mounted Commerce query authority boundary", () => {
  it("hides cached records immediately when read permission is revoked or Site selection disappears", async () => {
    const fetchMock = vi.fn(async () => okPage("site-a", "11111111-1111-4111-8111-111111111111"));
    vi.stubGlobal("fetch", fetchMock);
    const view = mountedList();
    try {
      await view.render();
      await waitFor(() => view.text().includes("11111111-1111-4111-8111-111111111111"));

      setAuthority("site-a", "authority-epoch-1", false);
      await view.render();
      expect(view.text()).not.toContain("11111111-1111-4111-8111-111111111111");

      setAuthority("", "authority-epoch-1", true);
      await view.render();
      expect(view.text()).not.toContain("11111111-1111-4111-8111-111111111111");
    } finally {
      await view.unmount();
    }
  });

  it("does not render Site A placeholder records while Site B is unresolved", async () => {
    const pendingSiteB = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okPage("site-a", "11111111-1111-4111-8111-111111111111"))
      .mockImplementationOnce(() => pendingSiteB.promise);
    vi.stubGlobal("fetch", fetchMock);
    const view = mountedList();
    try {
      await view.render();
      await waitFor(() => view.text().includes("11111111-1111-4111-8111-111111111111"));

      setAuthority("site-b", "authority-epoch-1");
      await view.render();
      await waitFor(() => fetchMock.mock.calls.length === 2);
      expect(view.text()).not.toContain("11111111-1111-4111-8111-111111111111");

      pendingSiteB.resolve(okPage("site-b", "33333333-3333-4333-8333-333333333333"));
      await waitFor(() => view.text().includes("33333333-3333-4333-8333-333333333333"));
    } finally {
      await view.unmount();
    }
  });

  it("changes the query boundary on an authorization epoch fingerprint change", async () => {
    const pendingNewAuthority = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okPage("site-a", "11111111-1111-4111-8111-111111111111"))
      .mockImplementationOnce(() => pendingNewAuthority.promise);
    vi.stubGlobal("fetch", fetchMock);
    const view = mountedList();
    try {
      await view.render();
      await waitFor(() => view.text().includes("11111111-1111-4111-8111-111111111111"));

      setAuthority("site-a", "authority-epoch-2");
      await view.render();
      await waitFor(() => fetchMock.mock.calls.length === 2);
      expect(view.text()).not.toContain("11111111-1111-4111-8111-111111111111");

      pendingNewAuthority.resolve(okPage("site-a", "33333333-3333-4333-8333-333333333333"));
      await waitFor(() => view.text().includes("33333333-3333-4333-8333-333333333333"));
    } finally {
      await view.unmount();
    }
  });

  it("hides the last successful records after a refetch is denied with 403", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okPage("site-a", "11111111-1111-4111-8111-111111111111"))
      .mockResolvedValueOnce(forbidden());
    vi.stubGlobal("fetch", fetchMock);
    const view = mountedList();
    try {
      await view.render();
      await waitFor(() => view.text().includes("11111111-1111-4111-8111-111111111111"));
      expect(mocks.reload).toBeTypeOf("function");

      await act(async () => { mocks.reload?.(); });
      await waitFor(() => view.text().includes("资源加载失败"));
      expect(view.text()).not.toContain("11111111-1111-4111-8111-111111111111");
    } finally {
      await view.unmount();
    }
  });
});
