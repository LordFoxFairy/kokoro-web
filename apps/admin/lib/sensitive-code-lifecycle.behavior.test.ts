/**
 * @vitest-environment happy-dom
 */

import { act, cloneElement, createElement, isValidElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodeBatchConsole } from "@/components/commerce/code-batch-console";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  downloadSensitiveCodes: vi.fn(),
  refetch: vi.fn(async () => undefined),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
  admin: {
    siteId: "site-one",
    authorityFingerprint: "authority-epoch-1",
    me: {
      email: "operator:checker",
      roleKey: "active",
      permissions: ["commerce.code-batch.read", "commerce.code-batch.issue"],
      scopeSites: ["site-one"],
    },
  },
}));

vi.mock("@/lib/api", () => ({ apiPost: mocks.apiPost }));
vi.mock("@/lib/sensitive-code-export", () => ({
  downloadSensitiveCodes: mocks.downloadSensitiveCodes,
}));
vi.mock("@/components/shell/app-shell", () => ({
  useAdmin: () => mocks.admin,
}));
vi.mock("@refinedev/core", () => ({
  useInfiniteList: () => ({
    query: {
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      isPlaceholderData: false,
      hasNextPage: false,
      refetch: mocks.refetch,
      fetchNextPage: vi.fn(async () => undefined),
    },
  }),
}));
vi.mock("next/link", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    element("a", { href }, children) };
});
vi.mock("@ant-design/icons", async () => {
  const { createElement: element } = await import("react");
  const Icon = () => element("span");
  return { DownOutlined: Icon, DownloadOutlined: Icon, SafetyCertificateOutlined: Icon };
});
vi.mock("antd", async () => {
  const { createElement: element } = await import("react");
  return {
    Alert: ({ message, description }: { message?: React.ReactNode; description?: React.ReactNode }) =>
      element("div", { role: "alert" }, message, description),
    App: { useApp: () => ({ message: { success: mocks.messageSuccess, error: mocks.messageError } }) },
    Button: ({ children, disabled, href, onClick }: { children?: React.ReactNode; disabled?: boolean;
      href?: string; onClick?: () => void }) => href
      ? element("a", { href, "aria-disabled": disabled }, children)
      : element("button", { disabled, onClick }, children),
    Dropdown: ({ children }: { children?: React.ReactNode }) => element("div", null, children),
    Modal: ({ children, footer, open, title }: { children?: React.ReactNode; footer?: React.ReactNode;
      open?: boolean; title?: React.ReactNode }) => open
      ? element("div", { role: "dialog", "aria-label": String(title) }, title, children, footer)
      : null,
    Space: ({ children }: { children?: React.ReactNode }) => element("div", null, children),
    Tag: ({ children }: { children?: React.ReactNode }) => element("span", null, children),
  };
});
vi.mock("@ant-design/pro-components", async () => {
  const { createElement: element } = await import("react");
  const EmptyField = () => null;
  return {
    ModalForm: ({ onFinish, open, trigger }: {
      onFinish?: (values: Record<string, unknown>) => Promise<boolean>;
      open?: boolean;
      trigger?: React.ReactNode;
    }) => {
      if (trigger && isValidElement<{ onClick?: () => void }>(trigger)) {
        return cloneElement(trigger, { onClick: () => { void onFinish?.({
          batchRef: "33333333-3333-4333-8333-333333333333",
          redemptionProgramRevisionRef: "redemption-program:launch@1",
          count: 2,
        }); } });
      }
      return open ? element("div", { role: "dialog" }) : null;
    },
    PageContainer: ({ children, extra }: { children?: React.ReactNode; extra?: React.ReactNode }) =>
      element("section", null, extra, children),
    ProFormDigit: EmptyField,
    ProFormText: EmptyField,
    ProFormTextArea: EmptyField,
    ProTable: () => null,
  };
});

const issued = {
  batchRef: "33333333-3333-4333-8333-333333333333",
  codeCount: 2,
  redemptionProgramRevisionRef: "redemption-program:launch@1",
  createdByOperatorRef: "operator:checker",
  startsAt: null,
  endsAt: null,
  exportedAt: "2026-08-09T00:00:00.000Z",
  disposition: "committed",
  delivery: {
    kind: "secret_export",
    rawCodes: [
      "KC1-AAAAAAAA-AAAAAAAAAA-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-AAAAAAAA",
      "KC1-BBBBBBBB-BBBBBBBBBB-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB-BBBBBBBB",
    ],
  },
  receipt: {
    commandId: "55555555-5555-4555-8555-555555555555",
    operation: "commerce.code-batch.issue",
    state: "committed",
    recordedAt: "2026-08-09T00:00:00.000Z",
  },
};

function mountedConsole() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    render: async () => { await act(async () => { root.render(createElement(CodeBatchConsole)); }); },
    click: async (label: string) => {
      const button = [...container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.includes(label));
      if (!button) throw new Error(`missing button: ${label}`);
      await act(async () => {
        button.click();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    hasButton: (label: string) => [...container.querySelectorAll("button")]
      .some((candidate) => candidate.textContent?.includes(label)),
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

async function issue(view: ReturnType<typeof mountedConsole>): Promise<void> {
  await view.render();
  await view.click("签发批次");
  expect(view.hasButton("下载 Blob 并清空")).toBe(true);
}

function setAxes(siteId: string, authorityFingerprint: string): void {
  mocks.admin = { ...mocks.admin, siteId, authorityFingerprint };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
  mocks.apiPost.mockResolvedValue(issued);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  setAxes("site-one", "authority-epoch-1");
  document.body.replaceChildren();
});

describe("one-time code lifecycle", () => {
  it("retains the 45 second timer as a final local-state deadline", async () => {
    const view = mountedConsole();
    try {
      await issue(view);
      await act(async () => { vi.advanceTimersByTime(44_999); });
      expect(view.hasButton("下载 Blob 并清空")).toBe(true);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(view.hasButton("下载 Blob 并清空")).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it.each(["pagehide", "visibilitychange"])("clears raw codes immediately on %s", async (eventName) => {
    const view = mountedConsole();
    const visibility = eventName === "visibilitychange"
      ? vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
      : null;
    try {
      await issue(view);
      await act(async () => {
        (eventName === "visibilitychange" ? document : window).dispatchEvent(new Event(eventName));
      });
      expect(view.hasButton("下载 Blob 并清空")).toBe(false);
      expect(mocks.downloadSensitiveCodes).not.toHaveBeenCalled();
    } finally {
      visibility?.mockRestore();
      await view.unmount();
    }
  });

  it("rejects a frozen BFCache delivery after its absolute deadline on pageshow", async () => {
    const view = mountedConsole();
    try {
      await issue(view);
      vi.setSystemTime(new Date("2026-08-09T00:01:00.000Z"));
      await act(async () => { window.dispatchEvent(new Event("pageshow")); });
      expect(view.hasButton("下载 Blob 并清空")).toBe(false);
      expect(mocks.downloadSensitiveCodes).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it.each([
    { label: "Site", siteId: "site-two", authorityFingerprint: "authority-epoch-1" },
    { label: "authority", siteId: "site-one", authorityFingerprint: "authority-epoch-2" },
  ])("clears an issued export when its $label axis changes", async ({ siteId, authorityFingerprint }) => {
    const view = mountedConsole();
    try {
      await issue(view);
      setAxes(siteId, authorityFingerprint);
      await view.render();

      expect(view.hasButton("下载 Blob 并清空")).toBe(false);
      expect(mocks.downloadSensitiveCodes).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });
});
