"use client";

import { Button, Divider, Space } from "antd";
import {
  ModalForm, ProFormDateTimePicker, ProFormDependency, ProFormDigit, ProFormGroup, ProFormList, ProFormSelect,
  ProFormSwitch, ProFormText,
} from "@ant-design/pro-components";

export interface InventoryChoice {
  readonly inventoryDigest: string;
  readonly sourceReference: string;
  readonly active: boolean;
  readonly activePointerRevision: string | null;
}

export interface ModelChoice { readonly modelKey: string; readonly displayName: string }
export interface OptionChoice { readonly revisionRef: string; readonly label: string; readonly surface: string }
export interface PolicyChoice { readonly product: string; readonly revision: string; readonly current: boolean }

type Submit = (body: unknown, success: string) => Promise<boolean>;

const products = ["chat", "music", "image", "video"].map((value) => ({ value, label: value.toUpperCase() }));
const roles = [{ value: "main", label: "主模型" }, { value: "generation", label: "生成模型" }];
const adapterKinds = [{ value: "litellm", label: "LiteLLM" }, { value: "direct", label: "Direct" }];
const lifecycle = [{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }];

export function ImportInventoryAction(props: Readonly<{ submit: Submit }>) {
  return <Space wrap>
    <StepUp operation="model.inventory.import" resource="model-inventory" label="提升导入认证" />
    <ModalForm title="导入不可变模型目录" width={1180} trigger={<Button type="primary">导入目录</Button>}
      modalProps={{ destroyOnHidden: true }} initialValues={{ productRoutes: [], providerAvailability: [] }}
      onFinish={(values) => props.submit({ action: "import_inventory", sourceReference: values.sourceReference,
        providers: records(values.providers), models: records(values.models), bindings: records(values.bindings),
        productRoutes: records(values.productRoutes), providerAvailability: records(values.providerAvailability),
      }, "目录已导入") }>
      <ProFormText name="sourceReference" label="来源引用" width="lg" rules={[{ required: true }]} />
      <ObjectList name="providers" title="提供方" required initialValue={[{ adapterKind: "litellm", priority: 0 }]}>
        <ProFormText name="key" label="Provider key" rules={[{ required: true }]} />
        <ProFormText name="provider" label="实现" rules={[{ required: true }]} />
        <ProFormText name="accountKey" label="账号 key" rules={[{ required: true }]} />
        <ProFormText.Password name="secretRef" label="Secret ref" rules={[{ required: true }]} />
        <ProFormSelect name="adapterKind" label="适配器" options={adapterKinds} rules={[{ required: true }]} />
        <ProFormDigit name="priority" label="优先级" min={0} max={10_000} rules={[{ required: true }]} />
      </ObjectList>
      <ObjectList name="models" title="逻辑模型" required initialValue={[{ enabled: true }]}>
        <ProFormText name="key" label="Model key" rules={[{ required: true }]} />
        <ProFormText name="displayName" label="显示名称" rules={[{ required: true }]} />
        <TagSelect name="inputModalities" label="输入模态" required />
        <TagSelect name="outputModalities" label="输出模态" required />
        <TagSelect name="capabilities" label="能力" required />
        <ProFormDigit name="contextWindow" label="上下文窗口" min={1} max={4_294_967_295} />
        <ProFormSwitch name="enabled" label="启用" />
      </ObjectList>
      <ObjectList name="bindings" title="提供方绑定" required initialValue={[{ priority: 0, enabled: true }]}>
        <ProFormText name="key" label="Binding key" rules={[{ required: true }]} />
        <ProFormText name="modelKey" label="逻辑模型 key" tooltip="可引用本次导入中新定义的模型"
          rules={[{ required: true }]} />
        <ProFormText name="providerKey" label="Provider key" rules={[{ required: true }]} />
        <ProFormText name="upstreamModel" label="上游模型" rules={[{ required: true }]} />
        <ProFormText name="gatewayModelName" label="Gateway alias" rules={[{ required: true }]} />
        <ProFormDigit name="priority" label="优先级" min={0} max={10_000} rules={[{ required: true }]} />
        <ProFormSwitch name="enabled" label="启用" />
      </ObjectList>
      <ObjectList name="productRoutes" title="产品默认路由">
        <ProFormSelect name="product" label="产品" options={products} rules={[{ required: true }]} />
        <ProFormSelect name="role" label="角色" options={roles} rules={[{ required: true }]} />
        <ProFormText name="modelKey" label="逻辑模型 key" tooltip="可引用本次导入中新定义的模型"
          rules={[{ required: true }]} />
        <ProFormDigit name="position" label="位置" min={0} max={10_000} rules={[{ required: true }]} />
        <TagSelect name="requiredCapabilities" label="要求能力" required />
      </ObjectList>
      <ObjectList name="providerAvailability" title="提供方可用性快照">
        <ProFormText name="providerKey" label="Provider key" rules={[{ required: true }]} />
        <ProFormSelect name="status" label="运行状态" options={[{ value: "active", label: "Active" },
          { value: "disabled", label: "Disabled" }]} rules={[{ required: true }]} />
        <ProFormSelect name="health" label="健康状态" options={["unknown", "healthy", "degraded", "down"]
          .map((value) => ({ value, label: value }))} rules={[{ required: true }]} />
        <ProFormText name="epoch" label="Availability epoch" initialValue="0" rules={[{ required: true }]} />
        <ProFormText name="observationRef" label="观测引用" />
        <ProFormDateTimePicker name="observedAt" label="观测时间" />
      </ObjectList>
    </ModalForm>
  </Space>;
}

export function ActivateInventoryAction(props: Readonly<{ submit: Submit; inventories: readonly InventoryChoice[];
  selectedDigest: string }>) {
  const active = props.inventories.find((item) => item.active);
  return <Space wrap>
    <StepUp operation="model.inventory.activate" resource={props.selectedDigest || "model-inventory"} label="提升激活认证" />
    <ModalForm title="激活目录版本" width={560} trigger={<Button disabled={!props.selectedDigest}>激活所选版本</Button>}
      onFinish={(values) => props.submit({ action: "activate_inventory", targetDigest: values.targetDigest,
        expectedPointerRevision: String(values.expectedPointerRevision) }, "目录已激活") }>
      <ProFormSelect name="targetDigest" label="目标版本" initialValue={props.selectedDigest || undefined}
        options={props.inventories.map((item) => ({ value: item.inventoryDigest,
          label: `${item.sourceReference} · ${short(item.inventoryDigest)}` }))} rules={[{ required: true }]} />
      <ProFormText name="expectedPointerRevision" label="当前指针修订"
        initialValue={active?.activePointerRevision ?? "0"} tooltip="Compare-and-swap，避免覆盖其他管理员的新激活"
        rules={[{ required: true }]} />
    </ModalForm>
  </Space>;
}

export function MaterializeOptionsAction(props: Readonly<{ submit: Submit; inventories: readonly InventoryChoice[];
  selectedDigest: string; models: readonly ModelChoice[] }>) {
  const modelOptions = choices(props.models, "modelKey", "displayName");
  return <Space wrap>
    <StepUp operation="model.option.materialize" resource={props.selectedDigest || "model-inventory"}
      label="提升物化认证" />
    <ModalForm title="物化产品模型选项" width={1080} trigger={<Button type="primary"
      disabled={!props.selectedDigest}>物化选项</Button>} initialValues={{ options: [{ surface: "chat", lifecycle: "active",
        orchestration: { fallbackModelKeys: [] }, generation: { fallbackModelKeys: [] } }] }}
      onFinish={(values) => props.submit({ action: "materialize_options", inventoryDigest: values.inventoryDigest,
        options: records(values.options) }, "产品选项已物化") }>
      <ProFormSelect name="inventoryDigest" label="目录版本" initialValue={props.selectedDigest || undefined}
        options={props.inventories.map((item) => ({ value: item.inventoryDigest, label: item.sourceReference }))}
        rules={[{ required: true }]} />
      <ObjectList name="options" title="产品选项" required>
        <ProFormText name="optionKey" label="Option key" rules={[{ required: true }]} />
        <ProFormSelect name="surface" label="Surface" options={products} rules={[{ required: true }]} />
        <ProFormText name="label" label="显示名称" rules={[{ required: true }]} />
        <ProFormText name="description" label="描述" />
        <ProFormText name="tier" label="套餐层级" />
        <ProFormSelect name="lifecycle" label="生命周期" options={lifecycle} rules={[{ required: true }]} />
        <ChoiceSelect name={["orchestration", "primaryModelKey"]} label="编排主模型" options={modelOptions} />
        <ChoiceSelect name={["orchestration", "fallbackModelKeys"]} label="编排兜底模型" options={modelOptions}
          multiple required={false} />
        <ChoiceSelect name={["generation", "primaryModelKey"]} label="生成主模型" options={modelOptions} />
        <ChoiceSelect name={["generation", "fallbackModelKeys"]} label="生成兜底模型" options={modelOptions}
          multiple required={false} />
      </ObjectList>
    </ModalForm>
  </Space>;
}

export function ChangeSitePolicyAction(props: Readonly<{ submit: Submit; siteId: string;
  inventories: readonly InventoryChoice[]; models: readonly ModelChoice[]; policies: readonly PolicyChoice[] }>) {
  const modelOptions = choices(props.models, "modelKey", "displayName");
  return <Space wrap>
    <StepUp operation="model.site-policy.change" resource={props.siteId || "site-required"} label="提升策略认证" />
    <ModalForm title={`修订站点模型策略 · ${props.siteId}`} width={980}
      trigger={<Button type="primary" disabled={!props.siteId}>修订站点策略</Button>}
      initialValues={{ enabled: true, catalogMode: "follow_active", assignmentMode: "inherit", assignments: [] }}
      onFinish={(values) => props.submit({ action: "change_site_policy", siteId: props.siteId,
        product: values.product, enabled: Boolean(values.enabled), catalogMode: values.catalogMode,
        ...(values.catalogMode === "pinned" ? { catalogDigest: values.catalogDigest } : {}),
        assignmentMode: values.assignmentMode, expectedRevision: String(values.expectedRevision),
        assignments: records(values.assignments) }, "站点策略已修订") }>
      <ProFormSelect name="product" label="产品" options={products} rules={[{ required: true }]} />
      <ProFormSwitch name="enabled" label="启用" />
      <ProFormSelect name="catalogMode" label="目录模式" options={[{ value: "follow_active", label: "跟随全局 Active" },
        { value: "pinned", label: "固定目录版本" }]} rules={[{ required: true }]} />
      <ProFormDependency name={["catalogMode"]}>{({ catalogMode }) => catalogMode === "pinned"
        ? <ProFormSelect name="catalogDigest" label="固定目录版本" options={props.inventories.map((item) => ({
          value: item.inventoryDigest, label: `${item.sourceReference} · ${short(item.inventoryDigest)}` }))}
          rules={[{ required: true }]} /> : null}</ProFormDependency>
      <ProFormSelect name="assignmentMode" label="分配模式" options={[{ value: "inherit", label: "继承目录路由" },
        { value: "replace", label: "替换路由" }]} rules={[{ required: true }]} />
      <ProFormDependency name={["product"]}>{({ product }) => <ProFormText name="expectedRevision"
        label="预期当前修订" initialValue={currentRevision(props.policies, String(product ?? ""))}
        tooltip="当前表格修订的 compare-and-swap 值" rules={[{ required: true }]} />}</ProFormDependency>
      <ObjectList name="assignments" title="替换分配">
        <ProFormSelect name="role" label="角色" options={roles} rules={[{ required: true }]} />
        <ChoiceSelect name="modelKey" label="逻辑模型" options={modelOptions} />
        <ProFormDigit name="position" label="位置" min={0} max={10_000} rules={[{ required: true }]} />
        <TagSelect name="requiredCapabilities" label="要求能力" required />
        <ProFormSwitch name="enabled" label="启用" initialValue />
      </ObjectList>
    </ModalForm>
  </Space>;
}

export function PublishSiteCatalogAction(props: Readonly<{ submit: Submit; siteId: string;
  inventories: readonly InventoryChoice[]; selectedDigest: string; options: readonly OptionChoice[] }>) {
  const optionChoices = choices(props.options, "revisionRef", "label");
  return <Space wrap>
    <StepUp operation="model.site-release-catalog.publish" resource={props.siteId || "site-required"}
      label="提升发布认证" />
    <ModalForm title={`发布站点模型目录 · ${props.siteId}`} width={980}
      trigger={<Button disabled={!props.siteId || !props.selectedDigest}>发布模型目录</Button>}
      initialValues={{ surfaces: [{ surface: "chat", allowedOptionRevisionRefs: [] }] }}
      onFinish={(values) => props.submit({ action: "publish_site_release_catalog", siteId: props.siteId,
        siteReleaseRef: values.siteReleaseRef, inventoryDigest: values.inventoryDigest,
        surfaces: records(values.surfaces) }, "站点模型目录已发布") }>
      <ProFormText name="siteReleaseRef" label="Site release ref" rules={[{ required: true }]} />
      <ProFormSelect name="inventoryDigest" label="目录版本" initialValue={props.selectedDigest || undefined}
        options={props.inventories.map((item) => ({ value: item.inventoryDigest, label: item.sourceReference }))}
        rules={[{ required: true }]} />
      <ObjectList name="surfaces" title="Surface 发布清单" required>
        <ProFormSelect name="surface" label="Surface" options={products} rules={[{ required: true }]} />
        <ChoiceSelect name="allowedOptionRevisionRefs" label="允许的模型选项" options={optionChoices} multiple />
        <ChoiceSelect name="defaultModelOptionRevisionRef" label="默认模型选项" options={optionChoices} />
      </ObjectList>
    </ModalForm>
  </Space>;
}

function ObjectList(props: Readonly<{ name: string; title: string; required?: boolean;
  initialValue?: readonly Record<string, unknown>[]; children: React.ReactNode }>) {
  return <><Divider titlePlacement="start" plain>{props.title}</Divider><ProFormList name={props.name}
    initialValue={props.initialValue ? [...props.initialValue] : undefined}
    creatorButtonProps={{ creatorButtonText: `添加${props.title}` }}
    rules={props.required ? [{ validator: async (_rule, value) => {
      if (!Array.isArray(value) || value.length < 1) throw new Error(`至少添加一项${props.title}`);
    } }] : undefined}
    copyIconProps={false}><ProFormGroup>{props.children}</ProFormGroup></ProFormList></>;
}

function ChoiceSelect(props: Readonly<{ name: string | readonly string[]; label: string;
  options: readonly { value: string; label: string }[]; multiple?: boolean; required?: boolean }>) {
  return <ProFormSelect name={props.name} label={props.label} options={[...props.options]}
    fieldProps={{ mode: props.multiple ? "multiple" : undefined, maxTagCount: "responsive" }}
    rules={props.required === false ? undefined : [{ required: true }]} />;
}

function TagSelect(props: Readonly<{ name: string; label: string; required?: boolean }>) {
  return <ProFormSelect name={props.name} label={props.label} fieldProps={{ mode: "tags", tokenSeparators: [","] }}
    rules={props.required ? [{ required: true }] : undefined} />;
}

function StepUp(props: Readonly<{ operation: string; resource: string; label: string }>) {
  return <Button href={`/api/control/auth/step-up?operation=${encodeURIComponent(props.operation)}`
    + `&resource=${encodeURIComponent(props.resource)}&return=${encodeURIComponent("/models")}`}>{props.label}</Button>;
}

function records(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
}
function choices<Row extends object>(items: readonly Row[], value: keyof Row, label: keyof Row) {
  return items.map((item) => ({ value: String(item[value]), label: `${String(item[label])} · ${String(item[value])}` }));
}
function currentRevision(policies: readonly PolicyChoice[], product: string) {
  return policies.find((item) => item.current && item.product === product)?.revision ?? "0";
}
function short(value: string) { return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
