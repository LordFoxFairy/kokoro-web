/**
 * @vitest-environment happy-dom
 */

import { act, cloneElement, createElement, isValidElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PublishCreditProgramForm,
  PublishEntitlementTemplateForm,
  PublishOfferForm,
} from "@/components/commerce/commerce-publish-forms";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
  formValues: {} as Record<string, unknown>,
  finishOutcome: vi.fn(),
  finishError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiPost: mocks.apiPost }));
vi.mock("antd", async () => {
  const { createElement: element } = await import("react");
  return {
    App: { useApp: () => ({ message: { success: mocks.messageSuccess, error: mocks.messageError } }) },
    Button: ({ children, disabled, href, onClick }: { children?: React.ReactNode; disabled?: boolean;
      href?: string; onClick?: () => void }) => href
      ? element("a", { href, "aria-disabled": disabled }, children)
      : element("button", { disabled, onClick }, children),
    Space: ({ children }: { children?: React.ReactNode }) => element("div", null, children),
  };
});
vi.mock("@ant-design/pro-components", async () => {
  const EmptyField = () => null;
  return {
    ModalForm: ({ onFinish, trigger }: {
      onFinish?: (values: Record<string, unknown>) => Promise<boolean>;
      trigger?: React.ReactNode;
    }) => {
      if (!trigger || !isValidElement<{ onClick?: () => void }>(trigger)) return null;
      return cloneElement(trigger, { onClick: () => {
        void onFinish?.(mocks.formValues).then(mocks.finishOutcome, mocks.finishError);
      } });
    },
    ProFormDigit: EmptyField,
    ProFormSelect: EmptyField,
    ProFormSwitch: EmptyField,
    ProFormText: EmptyField,
    ProFormTextArea: EmptyField,
  };
});

interface InvalidCase {
  readonly name: string;
  readonly component: ComponentType<{ siteId: string; enabled: boolean }>;
  readonly button: string;
  readonly values: Record<string, unknown>;
}

const invalidCases: readonly InvalidCase[] = [
  {
    name: "revision",
    component: PublishEntitlementTemplateForm,
    button: "发布 revision",
    values: {
      entitlementTemplateRevisionRef: "entitlement-template:pro@0",
      templateRef: "entitlement-template:pro",
      revision: "0",
      capabilityKey: "capability.pro",
      safeLabel: "Pro",
    },
  },
  {
    name: "amount",
    component: PublishCreditProgramForm,
    button: "发布 revision",
    values: {
      creditProgramRevisionRef: "credit-program:welcome@1",
      programRef: "credit-program:welcome",
      revision: "1",
      bucketClass: "permanent",
      unit: "credit",
      amount: "1.5",
      burnPriority: 0,
      surfaceRefs: "surface:web",
      capabilityKeys: "chat.send",
      agentRefs: "",
      allowUnattributedAgent: true,
      liabilityMerchantAccountRef: "merchant:liability",
    },
  },
  {
    name: "Plan JSON",
    component: PublishOfferForm,
    button: "发布 Offer",
    values: {
      productRef: "product:pro",
      productKind: "subscription",
      productVersionRef: "product:pro@1",
      productRevision: "1",
      safeLabel: "Pro",
      planVersion: "{",
      fulfillmentProgramRevisionRef: "fulfillment:pro@1",
      fulfillmentProgramRef: "fulfillment:pro",
      fulfillmentProgramRevision: "1",
      outputs: "[]",
      legalTermRefs: "",
    },
  },
  {
    name: "outputs JSON",
    component: PublishOfferForm,
    button: "发布 Offer",
    values: {
      productRef: "product:credits",
      productKind: "credit_pack",
      productVersionRef: "product:credits@1",
      productRevision: "1",
      safeLabel: "Credits",
      planVersion: "",
      fulfillmentProgramRevisionRef: "fulfillment:credits@1",
      fulfillmentProgramRef: "fulfillment:credits",
      fulfillmentProgramRevision: "1",
      outputs: "[",
      legalTermRefs: "",
    },
  },
];

function mountedForm(component: InvalidCase["component"]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    render: async () => { await act(async () => {
      root.render(createElement(component, { siteId: "site-one", enabled: true }));
    }); },
    click: async (label: string) => {
      const button = [...container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.includes(label));
      if (!button) throw new Error(`missing publication button: ${label}`);
      await act(async () => {
        button.click();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mocks.apiPost.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
  mocks.formValues = {};
  document.body.replaceChildren();
});

describe("Commerce publication local input failures", () => {
  it.each(invalidCases)("contains invalid $name without rejecting or sending a request", async (testCase) => {
    mocks.formValues = testCase.values;
    const view = mountedForm(testCase.component);
    try {
      await view.render();
      await view.click(testCase.button);

      expect(mocks.finishError).not.toHaveBeenCalled();
      expect(mocks.finishOutcome).toHaveBeenCalledWith(false);
      expect(mocks.apiPost).not.toHaveBeenCalled();
      expect(mocks.messageError).toHaveBeenCalledWith("发布失败，请检查输入格式或操作认证");
    } finally {
      await view.unmount();
    }
  });
});
