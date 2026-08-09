import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(appRoot, path), "utf8");

describe("Refine AdminCommerce product surface", () => {
  it("registers exactly five typed Commerce resources with list and detail routes", () => {
    const shell = source("components/shell/app-shell.tsx");
    for (const [resource, path] of [
      ["credit-programs", "/commerce/credit-programs"],
      ["entitlement-templates", "/commerce/entitlement-templates"],
      ["offers", "/commerce/offers"],
      ["redemption-programs", "/commerce/redemption-programs"],
      ["code-batches", "/commerce/code-batches"],
    ]) {
      expect(shell).toContain(`name: "${resource}"`);
      expect(shell).toContain(`list: "${path}"`);
      expect(shell).toContain(`show: "${path}/:id"`);
    }
    expect(shell).not.toContain("/api/resource");
    expect(shell).not.toContain("/api/action");
  });

  it("binds every Commerce list/detail query to the selected Site and signed read permission", () => {
    const list = source("components/commerce/commerce-resource-list.tsx");
    const detail = source("components/commerce/commerce-resource-detail.tsx");
    for (const file of [list, detail]) {
      expect(file).toContain("siteId");
      expect(file).toContain("enabled:");
      expect(file).toContain("canRead");
    }
    expect(list).toContain('field: "siteId"');
    expect(detail).toContain("meta: { siteId }");
  });

  it("uses Pro Components for resource tables, details and explicit publish forms", () => {
    expect(source("components/commerce/commerce-resource-list.tsx")).toContain("ProTable");
    expect(source("components/commerce/commerce-resource-detail.tsx")).toContain("ProDescriptions");
    const forms = source("components/commerce/commerce-publish-forms.tsx");
    expect(forms).toContain("ModalForm");
    for (const route of ["credit-programs", "entitlement-templates", "offers", "redemption-programs"]) {
      expect(forms).toContain(`/api/control/commerce/${route}`);
    }
  });

  it("keeps first-delivery raw codes only in component-local state with a blocking, short-lived export dialog", () => {
    const consoleSource = source("components/commerce/code-batch-console.tsx");
    expect(consoleSource).toContain("useState<SensitiveCodeExport | null>");
    expect(consoleSource).toContain("maskClosable={false}");
    expect(consoleSource).toContain("keyboard={false}");
    expect(consoleSource).toContain("45_000");
    expect(consoleSource).toContain("setSensitiveExport(null)");
    expect(consoleSource).toContain("downloadSensitiveCodes");
    expect(consoleSource).toContain("abandon_and_reissue");
    expect(consoleSource).toContain("放弃原批次并使用新批次、新 command 重新签发");
    expect(consoleSource).toContain("暂停后不可恢复，只能撤销");
    for (const operation of ["commerce.code-batch.approve", "commerce.code-batch.activate",
      "commerce.code-batch.abandon", "commerce.code-batch.suspend", "commerce.code-batch.revoke"]) {
      expect(consoleSource).toContain(operation);
    }
    expect(consoleSource).toContain("提升状态操作认证");
    for (const forbidden of ["localStorage", "sessionStorage", "navigator.clipboard", "useMutation",
      "queryClient", "notification.", "URLSearchParams"] as const) {
      expect(consoleSource, forbidden).not.toContain(forbidden);
    }
  });

  it("creates one explicit Blob download, revokes its URL synchronously, and leaves clearing to the component", async () => {
    const blobUrl = "blob:sensitive";
    let captured: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => { captured = blob; return blobUrl; });
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const { downloadSensitiveCodes } = await import("./sensitive-code-export");

    downloadSensitiveCodes(["KC1-FIRST", "KC1-SECOND"], "batch-one", {
      createObjectURL, revokeObjectURL, click,
    });

    expect(click).toHaveBeenCalledWith(blobUrl, "kokoro-code-batch-batch-one.txt");
    expect(revokeObjectURL).toHaveBeenCalledWith(blobUrl);
    expect(await captured!.text()).toBe("KC1-FIRST\nKC1-SECOND\n");
  });
});
