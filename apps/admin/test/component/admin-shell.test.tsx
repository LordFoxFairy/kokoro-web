import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminShell } from "../../components/shell/admin-shell";
import { adminNavigation } from "../../components/shell/navigation";
import { LocaleProvider } from "../../i18n/context";
import { adminModuleRegistry } from "../../modules/registry";
import { iamModuleRegistry } from "../../modules/iam/registry";

describe("Kokoro Admin platform shell", () => {
  it("WEB-COMP-SHELL-001 renders only executable IAM routes and safe administrator identity", () => {
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

    expect(iamModuleRegistry.map((module) => module.id)).toEqual([
      "overview",
      "users",
      "sessions",
      "sites",
      "organizations",
      "access",
      "audit",
    ]);
    expect(adminNavigation).toHaveLength(7);
    expect(adminModuleRegistry.every((module) => module.executable)).toBe(true);
    expect(adminNavigation[0]).toMatchObject({ href: "/", labelKey: "nav.overview" });
    expect(adminNavigation.map((item) => [item.href, item.groupKey])).toEqual([
      ["/", null],
      ["/users", "nav.group.identity"],
      ["/sessions", "nav.group.identity"],
      ["/sites", "nav.group.tenant"],
      ["/organizations", "nav.group.organization"],
      ["/access", "nav.group.access"],
      ["/audit", "nav.group.access"],
    ]);
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(document.querySelector(".admin-shell > .ant-layout")).toHaveStyle({
      "--admin-header-height": "56px",
      "--admin-menu-icon-size": "18px",
      "--admin-command-icon-size": "16px",
      "--admin-content-max-width": "1600px",
    });
    expect(screen.getByText("Kokoro · 管理后台")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /系统概览/u })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /用户/u })).toHaveAttribute("href", "/users");
    expect(screen.getByRole("link", { name: /会话/u })).toHaveAttribute("href", "/sessions");
    expect(screen.getByRole("link", { name: /Site/u })).toHaveAttribute("href", "/sites");
    expect(screen.getByRole("link", { name: /组织/u })).toHaveAttribute("href", "/organizations");
    expect(screen.getByRole("link", { name: /访问控制/u })).toHaveAttribute("href", "/access");
    expect(screen.getByRole("link", { name: /安全审计/u })).toHaveAttribute("href", "/audit");
    expect(screen.getByText("身份管理")).toBeInTheDocument();
    expect(screen.getByText("租户管理")).toBeInTheDocument();
    expect(screen.getByText("组织管理")).toBeInTheDocument();
    expect(screen.getByText("权限与安全")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "语言" }).closest(".ant-select")).toHaveClass("admin-language");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overview content" })).toBeInTheDocument();
  });
});
