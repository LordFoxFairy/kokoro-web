import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DevelopmentFixtureTool } from "../../components/development-fixture/development-fixture-tool";

describe("development administrator fixture tool", () => {
  it("WEB-COMP-DEVFIXTURE-001 opens a compact bootstrap form from one floating tool", () => {
    render(<DevelopmentFixtureTool action={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开发管理员工具" }));

    expect(screen.getByRole("dialog", { name: "开发管理员工具" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "创建管理员" })).toBeChecked();
    expect(screen.getByLabelText("管理员名称")).toBeRequired();
    expect(screen.getByLabelText("登录邮箱")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("登录密码")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeInTheDocument();
    expect(screen.queryByText(/SQL|数据库|哈希/iu)).not.toBeInTheDocument();
  });

  it("WEB-COMP-DEVFIXTURE-001 switches to password reset without asking for account identity fields", async () => {
    const action = vi.fn().mockResolvedValue({ status: "success", operation: "reset", email: "admin@example.test", outcome: "RESET" });
    render(<DevelopmentFixtureTool action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "开发管理员工具" }));
    fireEvent.click(screen.getByRole("radio", { name: "重置密码" }));

    expect(screen.queryByLabelText("管理员名称")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("登录邮箱"), { target: { value: "admin@example.test" } });
    fireEvent.change(screen.getByLabelText("登录密码"), { target: { value: "fixture-password-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]?.[0]).toMatchObject({
      operation: "reset",
      email: "admin@example.test",
      password: "fixture-password-2026",
    });
    expect(screen.getByText("密码已更新，可以使用新密码登录。")).toBeInTheDocument();
  });
});
