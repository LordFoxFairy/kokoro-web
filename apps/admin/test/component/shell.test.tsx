import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/users";
const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { AppSidebar } from "@/components/layout/app-sidebar";
import { navigationForCapabilities, sidebarData } from "@/components/layout/sidebar-data";
import { SidebarProvider } from "@/components/ui/sidebar";
import { LayoutProvider } from "@/context/layout-provider";

function Shell({ capabilities }: { capabilities?: ReadonlySet<string> }) {
  return <LayoutProvider><SidebarProvider><AppSidebar capabilities={capabilities} /></SidebarProvider></LayoutProvider>;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => cleanup());

describe("management shell", () => {
  it("projects only Kokoro routes from the supplied capability projection", () => {
    const projected = navigationForCapabilities(new Set(["users.read", "audit.read"]));
    const routes = projected.flatMap((group) => group.items.flatMap((item) => item.items ? item.items : [item]));

    expect(routes.map((item) => item.url)).toEqual(["/users", "/audit"]);
    expect(JSON.stringify(sidebarData)).not.toMatch(/tasks|chats|billing|upgrade|clerk|sign-in/i);
  });

  it("marks the current Kokoro route active", () => {
    pathname = "/users";
    render(<Shell capabilities={new Set(["users.read"])} />);

    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("data-active", "true");
  });

  it("persists desktop sidebar collapse state", () => {
    render(<Shell capabilities={new Set(["users.read"])} />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    expect(document.cookie).toContain("sidebar_state=false");
  });

  it("renders a labelled product identity placeholder without account actions", () => {
    render(<Shell capabilities={new Set()} />);

    expect(screen.getAllByText("Kokoro")).not.toHaveLength(0);
    expect(screen.getByText("Identity unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/sign out|billing|upgrade/i)).not.toBeInTheDocument();
  });
});
