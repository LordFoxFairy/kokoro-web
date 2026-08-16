import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageState, type PageStateKind } from "../../components/feedback/page-state";
import { LocaleProvider } from "../../i18n/context";

describe("shared IAM page states", () => {
  it("WEB-COMP-STATE-001 renders every non-happy state as a stable announced region", () => {
    const states: PageStateKind[] = [
      "loading",
      "empty",
      "filtered-empty",
      "forbidden",
      "unavailable",
      "malformed",
    ];
    const { rerender } = render(
      <LocaleProvider><PageState kind={states[0]} /></LocaleProvider>,
    );

    for (const kind of states) {
      rerender(<LocaleProvider><PageState kind={kind} /></LocaleProvider>);
      expect(screen.getByRole("status")).toHaveAttribute("data-state", kind);
    }
  });
});
