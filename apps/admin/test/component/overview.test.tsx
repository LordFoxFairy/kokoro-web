import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../../i18n/context";
import { IamOverview } from "../../modules/iam/overview/overview";

describe("Kokoro system overview", () => {
  it("WEB-COMP-OVERVIEW-001 renders readiness and the latest real events without fabricated totals", () => {
    render(
      <LocaleProvider>
        <IamOverview state={{
          status: "ready",
          administrator: { email: "admin@example.com", id: "bce7762a-f7c7-4d22-8031-4336803038eb" },
          recentEvents: [{
            id: "0dbc85ab-70fb-4362-8854-e4834be725ec",
            kind: "member.changed",
            requestId: "df486566-7614-461f-a72c-1b3d4ea9e985",
            commandId: "8deecb20-8d72-4b7e-a719-722a2e606728",
            createdAt: "2026-08-16T12:30:00.000Z",
          }],
        }} />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { name: "系统概览" })).toBeInTheDocument();
    expect(screen.getByText("可用")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("已安全登录")).toBeInTheDocument();
    expect(screen.queryByText("访问凭证到期时间")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近安全事件" })).toBeInTheDocument();
    expect(screen.getByText("member.changed")).toBeInTheDocument();
    expect(screen.queryByText(/总用户|总组织|total users|total organizations/u)).not.toBeInTheDocument();
  });

  it("WEB-COMP-STATE-001 renders unavailable and malformed states distinctly", () => {
    const { rerender } = render(
      <LocaleProvider><IamOverview state={{ status: "unavailable" }} /></LocaleProvider>,
    );
    expect(screen.getByText("服务暂不可用")).toBeInTheDocument();

    rerender(<LocaleProvider><IamOverview state={{ status: "malformed" }} /></LocaleProvider>);
    expect(screen.getByText("数据不可读取")).toBeInTheDocument();
  });
});
