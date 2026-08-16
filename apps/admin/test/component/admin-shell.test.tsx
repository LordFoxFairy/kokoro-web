import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminShell } from "../../components/shell/admin-shell";
import { adminNavigation } from "../../components/shell/navigation";
import { LocaleProvider } from "../../i18n/context";

describe("compact IAM control-plane shell", () => {
  it("WEB-COMP-SHELL-001 renders only the registered Overview route and safe administrator identity", () => {
    render(
      <LocaleProvider>
        <AdminShell
          administrator={{
            id: "bce7762a-f7c7-4d22-8031-4336803038eb",
            email: "admin@example.com",
            name: "Admin",
          }}
          pathname="/"
          signOutAction={async () => {}}
        >
          <h1>Overview content</h1>
        </AdminShell>
      </LocaleProvider>,
    );

    expect(adminNavigation).toHaveLength(1);
    expect(adminNavigation[0]).toMatchObject({ href: "/", labelKey: "nav.overview" });
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /概览/u })).toHaveAttribute("href", "/");
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overview content" })).toBeInTheDocument();
  });
});
