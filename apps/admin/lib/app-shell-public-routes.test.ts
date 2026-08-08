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

import { AppShell } from "@/components/shell/app-shell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
  mocks.apiGet.mockReset();
});

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
