/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  pathname: "/login",
}));

vi.mock("@/lib/api", () => ({ apiGet: mocks.apiGet }));
vi.mock("@refinedev/core", async () => {
  const react = await import("react");
  return {
    Refine: ({ children }: { children: React.ReactNode }) => react.createElement("div", null, children),
  };
});
vi.mock("@refinedev/nextjs-router", () => ({ default: {} }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AppShell, useAdmin } from "@/components/shell/app-shell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
  mocks.apiGet.mockReset();
  mocks.pathname = "/login";
});

function SiteAuthorityProbe(): React.ReactElement {
  const context = useAdmin();
  const fingerprint = (context as typeof context & { authorityFingerprint?: string }).authorityFingerprint ?? "";
  return createElement("div", null,
    createElement("output", { "data-testid": "site-authority" },
      `selected=${context.siteId};sites=${context.sites.map((site) => site.id).join(",")};fingerprint=${fingerprint}`),
    createElement("button", { "data-testid": "reload-sites", onClick: context.reloadSites }, "reload"));
}

const operator = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  operatorRef: "operator:commerce",
  operatorGeneration: "7",
  state: "active",
  effectivePermissions: ["commerce.code-batch.read", "commerce.code-batch.issue"],
  effectiveSiteScopes: [{
    siteId: "site-one",
    environment: "production",
    region: "us-east-1",
    scopeEpoch: "3",
    expiresAt: "2027-01-01T00:00:00.000Z",
  }],
  operatorSecurityEpoch: "5",
  authorizationEpoch: "11",
  expiresAt: "2027-01-01T00:00:00.000Z",
  ...overrides,
});

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function deferred<Value>(): Readonly<{ promise: Promise<Value>; resolve: (value: Value) => void }> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => { resolve = next; });
  return { promise, resolve };
}

async function mountedProbe() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AppShell, null, createElement(SiteAuthorityProbe)));
  });
  await settle();
  return {
    text: () => container.querySelector('[data-testid="site-authority"]')?.textContent ?? "",
    reload: async () => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="reload-sites"]');
      if (!button) throw new Error("missing reload button");
      await act(async () => { button.click(); });
    },
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

describe("AppShell public routes", () => {
  it.each(["/login", "/auth/verify"])("does not load protected authority data on %s", async (pathname) => {
    mocks.pathname = pathname;
    mocks.apiGet.mockRejectedValue(new Error("unexpected protected request"));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(AppShell, null, createElement("span", null, "public")));
      await Promise.resolve();
    });

    expect(mocks.apiGet).not.toHaveBeenCalled();

    await act(async () => { root.unmount(); });
  });
});

describe("AppShell Site authority", () => {
  it("initializes a Commerce-only operator from effective Site scopes when ListSites is forbidden", async () => {
    mocks.pathname = "/commerce/code-batches";
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/control/operator") return operator();
      if (path === "/api/control/sites") throw new Error("HTTP 403");
      throw new Error(`unexpected path: ${path}`);
    });
    const probe = await mountedProbe();
    try {
      expect(probe.text()).toContain("selected=site-one");
      expect(probe.text()).toContain("sites=site-one");
    } finally {
      await probe.unmount();
    }
  });

  it("never adds a catalog Site that is outside effective Site scopes", async () => {
    mocks.pathname = "/commerce/code-batches";
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/control/operator") return operator();
      if (path === "/api/control/sites") return {
        items: [
          { siteRef: "site-one", status: "active", securityEpoch: "1" },
          { siteRef: "site-outside-scope", status: "active", securityEpoch: "1" },
        ],
        nextPageToken: null,
      };
      throw new Error(`unexpected path: ${path}`);
    });
    const probe = await mountedProbe();
    try {
      expect(probe.text()).toContain("sites=site-one");
      expect(probe.text()).not.toContain("site-outside-scope");
    } finally {
      await probe.unmount();
    }
  });

  it("derives a stable fingerprint from sorted authority fields and changes it on authorization epoch", async () => {
    mocks.pathname = "/commerce/code-batches";
    const siteScopes = [
      ...operator().effectiveSiteScopes,
      { siteId: "site-two", environment: "production", region: "us-west-2", scopeEpoch: "4",
        expiresAt: "2027-01-01T00:00:00.000Z" },
    ];
    const first = operator({ effectiveSiteScopes: siteScopes });
    const reordered = operator({
      effectivePermissions: ["commerce.code-batch.issue", "commerce.code-batch.read"],
      effectiveSiteScopes: [...siteScopes].reverse(),
    });
    const nextEpoch = operator({ effectiveSiteScopes: siteScopes, authorizationEpoch: "12" });
    const authorities = [first, reordered, nextEpoch];
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/control/operator") {
        const next = authorities.shift();
        if (!next) throw new Error("missing queued authority");
        return next;
      }
      if (path === "/api/control/sites") throw new Error("HTTP 403");
      throw new Error(`unexpected path: ${path}`);
    });
    const probe = await mountedProbe();
    try {
      const initialFingerprint = probe.text().split("fingerprint=")[1] ?? "";
      expect(initialFingerprint.length).toBeGreaterThan(0);

      await probe.reload();
      await settle();
      const reorderedFingerprint = probe.text().split("fingerprint=")[1] ?? "";
      expect(reorderedFingerprint).toBe(initialFingerprint);

      await probe.reload();
      await settle();
      const changedFingerprint = probe.text().split("fingerprint=")[1] ?? "";
      expect(changedFingerprint).not.toBe(initialFingerprint);
    } finally {
      await probe.unmount();
    }
  });

  it("ignores a late authority/catalog generation after a newer reload wins", async () => {
    mocks.pathname = "/commerce/code-batches";
    const firstAuthority = deferred<ReturnType<typeof operator>>();
    const secondAuthority = deferred<ReturnType<typeof operator>>();
    const queue = [firstAuthority.promise, secondAuthority.promise];
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/control/operator") {
        const next = queue.shift();
        if (!next) throw new Error("missing queued authority");
        return next;
      }
      if (path === "/api/control/sites") throw new Error("HTTP 403");
      throw new Error(`unexpected path: ${path}`);
    });
    const probe = await mountedProbe();
    try {
      await probe.reload();
      await settle();
      secondAuthority.resolve(operator({ effectiveSiteScopes: [{
        siteId: "site-new",
        environment: "production",
        region: "us-east-1",
        scopeEpoch: "8",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }] }));
      await settle();
      expect(probe.text()).toContain("selected=site-new");

      firstAuthority.resolve(operator());
      await settle();
      expect(probe.text()).toContain("selected=site-new");
      expect(probe.text()).not.toContain("site-one");
    } finally {
      await probe.unmount();
    }
  });
});
