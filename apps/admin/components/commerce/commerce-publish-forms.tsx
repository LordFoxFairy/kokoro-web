"use client";

import { App, Button, Space } from "antd";
import {
  ModalForm,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
} from "@ant-design/pro-components";

import { apiPost } from "@/lib/api";
import {
  publicationResultSchema,
  publishCreditProgramInputSchema,
  publishEntitlementTemplateInputSchema,
  publishOfferInputSchema,
  publishRedemptionProgramInputSchema,
} from "@/lib/commerce-contract";

interface FormProps {
  readonly siteId: string;
  readonly enabled: boolean;
}

export function PublishCreditProgramForm({ siteId, enabled }: FormProps): React.ReactElement {
  const { message } = App.useApp();
  return (
    <OperationButtons operation="commerce.credit-program.publish" siteId={siteId}
      returnPath="/commerce/credit-programs" enabled={enabled}>
      <ModalForm<Record<string, unknown>>
        title="发布 Credit Program 不可变 revision"
        trigger={<Button type="primary" disabled={!enabled || !siteId}>发布 revision</Button>}
        width={760}
        modalProps={{ destroyOnHidden: true }}
        onFinish={async (values) => submitPublication(message, "/api/control/commerce/credit-programs", () =>
          publishCreditProgramInputSchema.parse({
            siteId,
            creditProgramRevisionRef: text(values.creditProgramRevisionRef),
            programRef: text(values.programRef),
            revision: text(values.revision),
            bucketClass: text(values.bucketClass),
            unit: text(values.unit),
            amount: text(values.amount),
            burnPriority: integer(values.burnPriority),
            scopePolicy: {
              policyVersion: 1,
              surfaceRefs: lines(values.surfaceRefs),
              capabilityKeys: lines(values.capabilityKeys),
              agentRefs: lines(values.agentRefs),
              allowUnattributedAgent: Boolean(values.allowUnattributedAgent),
            },
            liabilityMerchantAccountRef: text(values.liabilityMerchantAccountRef),
            ...optionalText("calendarZone", values.calendarZone),
            ...optionalText("windowAnchor", values.windowAnchor),
            ...optionalText("expiresAfterSeconds", values.expiresAfterSeconds),
          }))}
      >
        <ProFormText name="creditProgramRevisionRef" label="Revision ref" rules={[{ required: true }]} />
        <ProFormText name="programRef" label="Program ref" rules={[{ required: true }]} />
        <ProFormText name="revision" label="Revision" initialValue="1" rules={[{ required: true }]} />
        <ProFormSelect name="bucketClass" label="Bucket" initialValue="permanent" rules={[{ required: true }]}
          options={[{ value: "daily", label: "Daily" }, { value: "period", label: "Period" },
            { value: "permanent", label: "Permanent" }]} />
        <ProFormText name="unit" label="Unit" initialValue="credit" rules={[{ required: true }]} />
        <ProFormText name="amount" label="Amount（正整数字符串）" rules={[{ required: true }]} />
        <ProFormDigit name="burnPriority" label="Burn priority" initialValue={0} rules={[{ required: true }]} />
        <ProFormTextArea name="surfaceRefs" label="Surface refs（每行一个）" rules={[{ required: true }]} />
        <ProFormTextArea name="capabilityKeys" label="Capability keys（每行一个）" rules={[{ required: true }]} />
        <ProFormTextArea name="agentRefs" label="Agent refs（可选，每行一个）" />
        <ProFormSwitch name="allowUnattributedAgent" label="允许未归属 Agent" initialValue />
        <ProFormText name="liabilityMerchantAccountRef" label="Liability merchant account ref"
          rules={[{ required: true }]} />
        <ProFormText name="calendarZone" label="Calendar zone（Daily/Period）" />
        <ProFormText name="windowAnchor" label="Window anchor（Daily/Period）" />
        <ProFormText name="expiresAfterSeconds" label="Expires after seconds（Period 可选）" />
      </ModalForm>
    </OperationButtons>
  );
}

export function PublishEntitlementTemplateForm({ siteId, enabled }: FormProps): React.ReactElement {
  const { message } = App.useApp();
  return (
    <OperationButtons operation="commerce.entitlement-template.publish" siteId={siteId}
      returnPath="/commerce/entitlement-templates" enabled={enabled}>
      <ModalForm<Record<string, unknown>>
        title="发布 Entitlement Template 不可变 revision"
        trigger={<Button type="primary" disabled={!enabled || !siteId}>发布 revision</Button>}
        modalProps={{ destroyOnHidden: true }}
        onFinish={async (values) => submitPublication(message,
          "/api/control/commerce/entitlement-templates", () => publishEntitlementTemplateInputSchema.parse({
            siteId,
            entitlementTemplateRevisionRef: text(values.entitlementTemplateRevisionRef),
            templateRef: text(values.templateRef),
            revision: text(values.revision),
            capabilityKey: text(values.capabilityKey),
            safeLabel: text(values.safeLabel),
            ...optionalText("expiresAfterSeconds", values.expiresAfterSeconds),
          }))}
      >
        <ProFormText name="entitlementTemplateRevisionRef" label="Revision ref" rules={[{ required: true }]} />
        <ProFormText name="templateRef" label="Template ref" rules={[{ required: true }]} />
        <ProFormText name="revision" label="Revision" initialValue="1" rules={[{ required: true }]} />
        <ProFormText name="capabilityKey" label="Capability key" rules={[{ required: true }]} />
        <ProFormText name="safeLabel" label="Safe label" rules={[{ required: true }]} />
        <ProFormText name="expiresAfterSeconds" label="Expires after seconds（可选）" />
      </ModalForm>
    </OperationButtons>
  );
}

export function PublishOfferForm({ siteId, enabled }: FormProps): React.ReactElement {
  const { message } = App.useApp();
  return (
    <OperationButtons operation="commerce.offer.publish" siteId={siteId}
      returnPath="/commerce/offers" enabled={enabled}>
      <ModalForm<Record<string, unknown>>
        title="发布 Offer 不可变 revision"
        trigger={<Button type="primary" disabled={!enabled || !siteId}>发布 Offer</Button>}
        width={820}
        modalProps={{ destroyOnHidden: true }}
        onFinish={async (values) => submitPublication(message, "/api/control/commerce/offers", () =>
          publishOfferInputSchema.parse({
            siteId,
            productRef: text(values.productRef),
            productKind: text(values.productKind),
            productVersionRef: text(values.productVersionRef),
            productRevision: text(values.productRevision),
            safeLabel: text(values.safeLabel),
            ...optionalJson("planVersion", values.planVersion),
            fulfillmentProgramRevisionRef: text(values.fulfillmentProgramRevisionRef),
            fulfillmentProgramRef: text(values.fulfillmentProgramRef),
            fulfillmentProgramRevision: text(values.fulfillmentProgramRevision),
            outputs: json(values.outputs),
            legalTermRefs: lines(values.legalTermRefs),
          }))}
      >
        <ProFormText name="productRef" label="Product ref" rules={[{ required: true }]} />
        <ProFormSelect name="productKind" label="Product kind" rules={[{ required: true }]}
          options={["free", "credit_pack", "subscription", "bundle"].map((value) => ({ value, label: value }))} />
        <ProFormText name="productVersionRef" label="Product version ref" rules={[{ required: true }]} />
        <ProFormText name="productRevision" label="Product revision" initialValue="1" rules={[{ required: true }]} />
        <ProFormText name="safeLabel" label="Safe label" rules={[{ required: true }]} />
        <ProFormTextArea name="planVersion" label="Plan version JSON（可选）" fieldProps={{ rows: 5 }} />
        <ProFormText name="fulfillmentProgramRevisionRef" label="Fulfillment program revision ref"
          rules={[{ required: true }]} />
        <ProFormText name="fulfillmentProgramRef" label="Fulfillment program ref" rules={[{ required: true }]} />
        <ProFormText name="fulfillmentProgramRevision" label="Fulfillment program revision" initialValue="1"
          rules={[{ required: true }]} />
        <ProFormTextArea name="outputs" label="Ordered fulfillment outputs JSON"
          tooltip='例如 [{"outputLineId":"line-1","ordinal":1,"cardinality":1,"outputKind":"credit_grant","targetRevisionRef":"program-v1"}]'
          fieldProps={{ rows: 7 }} rules={[{ required: true }]} />
        <ProFormTextArea name="legalTermRefs" label="Legal term refs（每行一个）" />
      </ModalForm>
    </OperationButtons>
  );
}

export function PublishRedemptionProgramForm({ siteId, enabled }: FormProps): React.ReactElement {
  const { message } = App.useApp();
  return (
    <OperationButtons operation="commerce.redemption-program.publish" siteId={siteId}
      returnPath="/commerce/redemption-programs" enabled={enabled}>
      <ModalForm<Record<string, unknown>>
        title="发布 Redemption Program 不可变 revision"
        trigger={<Button type="primary" disabled={!enabled || !siteId}>发布 revision</Button>}
        modalProps={{ destroyOnHidden: true }}
        onFinish={async (values) => submitPublication(message,
          "/api/control/commerce/redemption-programs", () => publishRedemptionProgramInputSchema.parse({
            siteId,
            redemptionProgramRevisionRef: text(values.redemptionProgramRevisionRef),
            programRef: text(values.programRef),
            revision: text(values.revision),
            productVersionRef: text(values.productVersionRef),
            fulfillmentProgramRevisionRef: text(values.fulfillmentProgramRevisionRef),
            maxRedemptionsPerAccount: integer(values.maxRedemptionsPerAccount),
          }))}
      >
        <ProFormText name="redemptionProgramRevisionRef" label="Revision ref" rules={[{ required: true }]} />
        <ProFormText name="programRef" label="Program ref" rules={[{ required: true }]} />
        <ProFormText name="revision" label="Revision" initialValue="1" rules={[{ required: true }]} />
        <ProFormText name="productVersionRef" label="Product version ref" rules={[{ required: true }]} />
        <ProFormText name="fulfillmentProgramRevisionRef" label="Fulfillment program revision ref"
          rules={[{ required: true }]} />
        <ProFormDigit name="maxRedemptionsPerAccount" label="每账户最大兑换次数" min={1} max={10_000}
          initialValue={1} rules={[{ required: true }]} />
      </ModalForm>
    </OperationButtons>
  );
}

function OperationButtons({ operation, siteId, returnPath, enabled, children }: Readonly<{
  operation: string;
  siteId: string;
  returnPath: string;
  enabled: boolean;
  children: React.ReactNode;
}>): React.ReactElement {
  const stepUp = siteId ? `/api/control/auth/step-up?operation=${encodeURIComponent(operation)}` +
    `&resource=${encodeURIComponent(siteId)}&return=${encodeURIComponent(returnPath)}` : undefined;
  return <Space wrap>
    <Button href={stepUp} disabled={!enabled || !siteId}>提升认证</Button>
    {children}
  </Space>;
}

async function submitPublication(
  message: ReturnType<typeof App.useApp>["message"],
  path: string,
  buildInput: () => unknown,
): Promise<boolean> {
  try {
    const input = buildInput();
    await apiPost(path, input, publicationResultSchema);
    message.success("不可变 revision 已发布");
    return true;
  } catch {
    message.error("发布失败，请检查输入格式或操作认证");
    return false;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function integer(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}
function lines(value: unknown): string[] {
  return [...new Set(text(value).split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))];
}
function json(value: unknown): unknown {
  return JSON.parse(text(value)) as unknown;
}
function optionalText<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  const parsed = text(value);
  return parsed.length === 0 ? {} : { [key]: parsed } as Partial<Record<Key, string>>;
}
function optionalJson<Key extends string>(key: Key, value: unknown): Partial<Record<Key, unknown>> {
  const parsed = text(value);
  return parsed.length === 0 ? {} : { [key]: JSON.parse(parsed) as unknown } as Partial<Record<Key, unknown>>;
}
