import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommandDialog } from "../../components/command/command-dialog";
import { LocaleProvider } from "../../i18n/context";

describe("IAM command confirmation", () => {
  it("WEB-COMP-A11Y-001 requires a reason and submits one explicit confirmed command", async () => {
    const reasons: string[] = [];
    render(
      <LocaleProvider>
        <CommandDialog
          open
          title="停用用户"
          entityLabel="admin@example.com"
          danger
          onCancel={() => {}}
          onConfirm={async (reason) => { reasons.push(reason); }}
        />
      </LocaleProvider>,
    );

    const confirm = screen.getByRole("button", { name: "确认" });
    fireEvent.click(confirm);
    expect(await screen.findByText("请输入操作原因")).toBeInTheDocument();
    expect(reasons).toEqual([]);

    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), {
      target: { value: "Security review" },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(reasons).toEqual(["Security review"]));
  });
});
