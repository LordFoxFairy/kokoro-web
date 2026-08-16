import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoginForm, VerificationState } from "../../components/auth/login-form";
import { LocaleProvider } from "../../i18n/context";

function translated(children: React.ReactNode): React.ReactElement {
  return <LocaleProvider>{children}</LocaleProvider>;
}

describe("public Admin authentication UI", () => {
  it("WEB-COMP-LOGIN-001 renders a labelled email form with one primary command", () => {
    render(translated(<LoginForm action={async () => {}} />));

    expect(screen.getByRole("heading", { name: "运营后台登录" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "发送登录链接" })).toHaveAttribute("type", "submit");
    expect(screen.getAllByRole("button")).toHaveLength(1);
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
