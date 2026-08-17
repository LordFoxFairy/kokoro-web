import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoginForm, VerificationState } from "../../components/auth/login-form";
import { LocaleProvider } from "../../i18n/context";

function translated(children: React.ReactNode): React.ReactElement {
  return <LocaleProvider>{children}</LocaleProvider>;
}

describe("public Admin authentication UI", () => {
  it("WEB-COMP-LOGIN-001 renders explicit password and email sign-in methods", async () => {
    render(translated(<LoginForm passwordAction={async () => {}} emailAction={async () => {}} />));

    expect(screen.getByRole("heading", { name: "登录管理后台" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "登录" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("radio", { name: /邮箱登录/u })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /邮箱登录/u }));
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送登录链接" })).toHaveAttribute("type", "submit");
    expect(screen.getByText(/有效期内仅可使用一次/u)).toBeInTheDocument();
  });

  it("WEB-COMP-LOGIN-001 hides email sign-in when the capability is disabled", () => {
    render(translated(
      <LoginForm
        passwordAction={async () => {}}
        emailAction={async () => {}}
        emailEnabled={false}
      />,
    ));

    expect(screen.queryByRole("radiogroup", { name: "登录方式" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
  });

  it("WEB-COMP-LOGIN-001 renders one uniform callback verification state for every public error", () => {
    const { rerender } = render(translated(<VerificationState error={null} />));
    const expected = screen.getByRole("status").textContent;

    for (const error of ["AccessDenied", "Verification", "Configuration", "unknown"]) {
      rerender(translated(<VerificationState error={error} />));
      expect(screen.getByRole("status").textContent).toBe(expected);
    }
    expect(expected).not.toContain("AccessDenied");
    expect(expected).not.toContain("Configuration");
  });
});
