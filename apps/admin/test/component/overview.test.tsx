import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OverviewContent } from "../../components/overview/overview-content";
import { LocaleProvider, useLocale } from "../../i18n/context";

function LanguageControl(): React.ReactElement {
  const { setLocale } = useLocale();
  return <button onClick={() => setLocale("en")}>English</button>;
}

describe("IAM overview presentation", () => {
  it("WEB-COMP-OVERVIEW-001 translates the sanitized readiness view without exposing credentials", () => {
    render(
      <LocaleProvider>
        <LanguageControl />
        <OverviewContent state={{
          status: "ready",
          administrator: {
            email: "admin@example.com",
            id: "bce7762a-f7c7-4d22-8031-4336803038eb",
          },
          actorExpiresAt: "2026-08-16T12:00:00.000Z",
        }} />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { name: "IAM 运行概览" })).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/token|credential|bearer/iu);

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { name: "IAM operational overview" })).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });
});
