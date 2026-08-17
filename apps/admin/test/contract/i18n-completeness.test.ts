import { describe, expect, it } from "vitest";

import { en } from "../../i18n/en";
import { zh } from "../../i18n/messages";

describe("Kokoro Admin platform dictionaries", () => {
  it("WEB-CONTRACT-I18N-001 has exact complete non-empty Chinese and English key sets", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim().length, `zh:${key}`).toBeGreaterThan(0);
      expect(en[key as keyof typeof en].trim().length, `en:${key}`).toBeGreaterThan(0);
    }
  });
});
