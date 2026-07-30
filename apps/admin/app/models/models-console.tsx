"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiOutlined, BranchesOutlined, CloudServerOutlined, DeploymentUnitOutlined,
  RocketOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Col, Empty, Row, Select, Space, Statistic, Tabs, Tag, Typography } from "antd";
import { ModalForm, PageContainer, ProFormSelect, ProFormSwitch, ProFormText,
  ProFormTextArea, ProTable, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/api";
import { collectCursorPages } from "@/lib/cursor-pagination";
import { useAdmin } from "@/components/shell/app-shell";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const page = <Row extends z.ZodTypeAny>(row: Row) => z.object({ items: z.array(row),
  nextPageToken: z.string().nullable(), asOf: z.string().datetime() });
const inventory = z.object({ inventoryDigest: digest, sourceReference: z.string(), counts: z.object({
  providers: z.number(), models: z.number(), bindings: z.number(), productRoutes: z.number() }).nullable(),
importedAt: z.string().datetime(), active: z.boolean(), activePointerRevision: z.string().nullable() });
const provider = z.object({ providerKey: z.string(), provider: z.string(), accountKey: z.string(),
  adapterKind: z.string(), priority: z.number(), secretReferencePresent: z.boolean(), status: z.string(),
  health: z.string(), availabilityEpoch: z.string(), observedAt: z.string().datetime().nullable() });
const definition = z.object({ modelKey: z.string(), displayName: z.string(), inputModalities: z.array(z.string()),
  outputModalities: z.array(z.string()), capabilities: z.array(z.string()), contextWindow: z.number().nullable(),
  enabled: z.boolean() });
const binding = z.object({ bindingKey: z.string(), modelKey: z.string(), providerKey: z.string(),
  upstreamModel: z.string(), gatewayModelName: z.string(), priority: z.number(), enabled: z.boolean() });
const route = z.object({ product: z.string(), role: z.string(), modelKey: z.string(), position: z.number(),
  requiredCapabilities: z.array(z.string()) });
const option = z.object({ revisionRef: z.string(), inventoryDigest: digest, optionKey: z.string(), surface: z.string(),
  label: z.string(), description: z.string().nullable(), tier: z.string().nullable(), lifecycle: z.string(),
  inputModalities: z.array(z.string()), outputModalities: z.array(z.string()),
  supportedEfforts: z.array(z.string()), badges: z.array(z.string()), createdAt: z.string().datetime() });
const policy = z.object({ siteId: z.string(), product: z.string(), revision: z.string(), policyDigest: digest,
  enabled: z.boolean(), catalogMode: z.string(), catalogDigest: digest.nullable(), assignmentMode: z.string(),
  assignmentCount: z.number(), current: z.boolean(), changedAt: z.string().datetime() });
const catalog = z.object({ siteId: z.string(), siteReleaseRef: z.string(), modelOptionCatalogRef: z.string(),
  catalogDigest: digest, inventoryDigest: digest, surfaceCount: z.number(), publishedAt: z.string().datetime() });
const mutation = z.object({ receipt: z.object({ commandId: z.string(), state: z.string() }) }).passthrough();

type Inventory = z.infer<typeof inventory>;
type Provider = z.infer<typeof provider>;
type Definition = z.infer<typeof definition>;
type Binding = z.infer<typeof binding>;
type Route = z.infer<typeof route>;
type Option = z.infer<typeof option>;
type Policy = z.infer<typeof policy>;
type Catalog = z.infer<typeof catalog>;

const productOptions = ["chat", "music", "image", "video"].map((value) => ({ value, label: value.toUpperCase() }));

export function ModelsConsole(): React.ReactElement {
  const { message } = App.useApp(); const { siteId } = useAdmin();
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [selectedDigest, setSelectedDigest] = useState(""); const [generation, setGeneration] = useState(0);
  useEffect(() => { let active = true; collectCursorPages<Inventory>((token, signal) => apiGet(
    `/api/control/models?view=inventories${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
    page(inventory), { signal }), { identity: (item) => item.inventoryDigest, maxItems: 1000,
    maxPages: 20, timeoutMs: 5_000 }).then((items) => {
      if (!active) return;
      setInventories(items); setSelectedDigest((current) => current || items.find((item) => item.active)?.inventoryDigest
        || items[0]?.inventoryDigest || "");
    }).catch((error: unknown) => { if (active) message.error(errorMessage(error, "目录加载失败")); });
  return () => { active = false; }; }, [generation, message]);
  const active = inventories.find((item) => item.active) ?? null;
  const selected = inventories.find((item) => item.inventoryDigest === selectedDigest) ?? null;
  const reload = () => setGeneration((value) => value + 1);

  return <PageContainer header={{ title: "模型控制台", subTitle: "一个全局目录，按产品组合，并按站点发布" }}
    content="从目录版本到站点发布的完整控制链路。提供方密钥只显示配置状态，永不返回引用或明文。"
    extra={<ModelActions siteId={siteId} inventories={inventories} selectedDigest={selectedDigest}
      onComplete={reload} />}>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="控制面与运行面分离"
      description="这里管理不可变目录、产品选项与站点发布；实际模型执行仍由 Model Gateway 承担。所有写操作要求对应的提升认证与预期修订。" />
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={24} md={12} xl={6}><Card><Statistic title="当前目录修订" prefix={<DeploymentUnitOutlined />}
        value={active?.activePointerRevision ?? "未激活"} /></Card></Col>
      <Col xs={12} md={6} xl={4}><Card><Statistic title="模型" value={active?.counts?.models ?? 0} /></Card></Col>
      <Col xs={12} md={6} xl={4}><Card><Statistic title="提供方" value={active?.counts?.providers ?? 0} /></Card></Col>
      <Col xs={12} md={6} xl={4}><Card><Statistic title="绑定" value={active?.counts?.bindings ?? 0} /></Card></Col>
      <Col xs={12} md={6} xl={6}><Card><Typography.Text type="secondary">Active digest</Typography.Text><br />
        <Typography.Text code copyable ellipsis style={{ maxWidth: "100%" }}>{active?.inventoryDigest ?? "—"}</Typography.Text></Card></Col>
    </Row>
    <Card styles={{ body: { paddingBottom: 0 } }}>
      <Space wrap style={{ marginBottom: 12 }}><Typography.Text strong>查看目录版本</Typography.Text>
        <Select value={selectedDigest || undefined} style={{ minWidth: 360 }}
          onChange={(value) => setSelectedDigest(String(value))} options={inventories.map((item) => ({
          value: item.inventoryDigest, label: `${item.active ? "● Active · " : ""}${item.sourceReference} · ${short(item.inventoryDigest)}` }))} />
        {selected?.active ? <Tag color="success">正在服务流量</Tag> : selected ? <Tag>历史版本</Tag> : null}</Space>
    </Card>
    <Tabs size="large" items={[
      { key: "inventory", label: iconLabel(<DeploymentUnitOutlined />, "版本"), children:
        <CursorTable schema={inventory} view="inventories" rowKey="inventoryDigest" generation={generation}
          columns={inventoryColumns} /> },
      { key: "providers", label: iconLabel(<CloudServerOutlined />, "提供方"), children: selectedDigest
        ? <CursorTable schema={provider} view="providers" inventoryDigest={selectedDigest} rowKey="providerKey"
          generation={generation} columns={providerColumns} /> : <Empty /> },
      { key: "catalog", label: iconLabel(<ApiOutlined />, "模型目录"), children: selectedDigest
        ? <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Section title="逻辑模型"><CursorTable schema={definition} view="definitions" inventoryDigest={selectedDigest}
            rowKey="modelKey" generation={generation} columns={definitionColumns} /></Section>
          <Section title="提供方绑定"><CursorTable schema={binding} view="bindings" inventoryDigest={selectedDigest}
            rowKey="bindingKey" generation={generation} columns={bindingColumns} /></Section>
          <Section title="产品默认路由"><CursorTable schema={route} view="routes" inventoryDigest={selectedDigest}
            rowKey={(row) => `${row.product}:${row.role}:${row.position}:${row.modelKey}`} generation={generation}
            columns={routeColumns} /></Section></Space> : <Empty /> },
      { key: "options", label: iconLabel(<BranchesOutlined />, "产品选项"), children:
        <CursorTable schema={option} view="options" inventoryDigest={selectedDigest || undefined}
          rowKey="revisionRef" generation={generation} columns={optionColumns} /> },
      { key: "site", label: iconLabel(<RocketOutlined />, "站点发布"), children: siteId
        ? <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Section title={`策略修订 · ${siteId}`}><CursorTable schema={policy} view="policies" siteId={siteId}
            rowKey={(row) => `${row.product}:${row.revision}`} generation={generation} columns={policyColumns} /></Section>
          <Section title="发布目录"><CursorTable schema={catalog} view="catalogs" siteId={siteId}
            rowKey="modelOptionCatalogRef" generation={generation} columns={catalogColumns} /></Section>
        </Space> : <Empty description="请先在顶部选择站点" /> },
    ]} />
  </PageContainer>;
}

function ModelActions(props: Readonly<{ siteId: string; inventories: readonly Inventory[];
  selectedDigest: string; onComplete: () => void }>): React.ReactElement {
  const { message } = App.useApp(); const active = props.inventories.find((item) => item.active);
  const submit = async (body: unknown, success: string) => { try { await apiPost("/api/control/models", body, mutation);
    message.success(success); props.onComplete(); return true; } catch (error) { message.error(errorMessage(error, "操作失败")); return false; } };
  return <Space wrap>
    <Button href={stepUp("model.inventory.import", "model-inventory", "/models")}>提升目录导入认证</Button>
    <ModalForm title="导入不可变模型目录" width={820} trigger={<Button type="primary">导入目录</Button>}
      modalProps={{ destroyOnHidden: true }} onFinish={(values) => submit({ action: "import_inventory",
        sourceReference: String(values.sourceReference), providers: json(values.providers), models: json(values.models),
        bindings: json(values.bindings), productRoutes: json(values.productRoutes),
        providerAvailability: json(values.providerAvailability || "[]") }, "目录已导入") }>
      <ProFormText name="sourceReference" label="来源引用" rules={[{ required: true }]} />
      <ProFormTextArea name="providers" label="提供方（JSON 数组）" fieldProps={{ rows: 5 }} rules={[{ required: true }]} />
      <ProFormTextArea name="models" label="逻辑模型（JSON 数组）" fieldProps={{ rows: 5 }} rules={[{ required: true }]} />
      <ProFormTextArea name="bindings" label="提供方绑定（JSON 数组）" fieldProps={{ rows: 5 }} rules={[{ required: true }]} />
      <ProFormTextArea name="productRoutes" label="产品路由（JSON 数组）" fieldProps={{ rows: 4 }} rules={[{ required: true }]} />
      <ProFormTextArea name="providerAvailability" label="可用性快照（JSON 数组）" initialValue="[]" fieldProps={{ rows: 3 }} />
    </ModalForm>
    <ModalForm title="激活目录版本" width={520} trigger={<Button>激活版本</Button>}
      onFinish={(values) => submit({ action: "activate_inventory", targetDigest: values.targetDigest,
        expectedPointerRevision: String(values.expectedPointerRevision) }, "目录已激活") }>
      <ProFormSelect name="targetDigest" label="目标版本" initialValue={props.selectedDigest || undefined}
        options={props.inventories.map((item) => ({ value: item.inventoryDigest, label: `${item.sourceReference} · ${short(item.inventoryDigest)}` }))}
        rules={[{ required: true }]} />
      <ProFormText name="expectedPointerRevision" label="当前指针修订" initialValue={active?.activePointerRevision ?? "0"}
        tooltip="Compare-and-swap 防止覆盖其他管理员的新激活" rules={[{ required: true }]} />
    </ModalForm>
    <Button href={stepUp("model.inventory.activate", props.selectedDigest || "model-inventory", "/models")}>提升激活认证</Button>
    <ModalForm title="物化产品模型选项" width={760} trigger={<Button>物化选项</Button>}
      onFinish={(values) => submit({ action: "materialize_options", inventoryDigest: values.inventoryDigest,
        options: json(values.options) }, "产品选项已物化") }>
      <ProFormSelect name="inventoryDigest" label="目录版本" initialValue={props.selectedDigest || undefined}
        options={props.inventories.map((item) => ({ value: item.inventoryDigest, label: item.sourceReference }))}
        rules={[{ required: true }]} />
      <ProFormTextArea name="options" label="选项定义（JSON 数组）" fieldProps={{ rows: 10 }} rules={[{ required: true }]} />
    </ModalForm>
    <Button href={stepUp("model.option.materialize", props.selectedDigest || "model-inventory", "/models")}>提升选项认证</Button>
    <SiteActions siteId={props.siteId} inventories={props.inventories} selectedDigest={props.selectedDigest}
      submit={submit} />
  </Space>;
}

function SiteActions(props: Readonly<{ siteId: string; inventories: readonly Inventory[]; selectedDigest: string;
  submit: (body: unknown, success: string) => Promise<boolean> }>): React.ReactElement {
  return <>
    <Button href={stepUp("model.site-policy.change", props.siteId || "site-required", "/models")}>提升站点策略认证</Button>
    <ModalForm title="修订站点模型策略" width={700} trigger={<Button disabled={!props.siteId}>站点策略</Button>}
      onFinish={(values) => props.submit({ action: "change_site_policy", siteId: props.siteId,
        product: values.product, enabled: Boolean(values.enabled), catalogMode: values.catalogMode,
        ...(values.catalogDigest ? { catalogDigest: values.catalogDigest } : {}), assignmentMode: values.assignmentMode,
        expectedRevision: String(values.expectedRevision), assignments: json(values.assignments || "[]") }, "站点策略已修订") }>
      <ProFormSelect name="product" label="产品" options={productOptions} rules={[{ required: true }]} />
      <ProFormSwitch name="enabled" label="启用" initialValue />
      <ProFormSelect name="catalogMode" label="目录模式" initialValue="follow_active" options={[
        { value: "follow_active", label: "跟随全局 Active" }, { value: "pinned", label: "固定目录版本" }]} />
      <ProFormText name="catalogDigest" label="固定 digest（Pinned 时必填）" />
      <ProFormSelect name="assignmentMode" label="分配模式" initialValue="inherit" options={[
        { value: "inherit", label: "继承目录路由" }, { value: "replace", label: "替换路由" }]} />
      <ProFormText name="expectedRevision" label="预期当前修订" initialValue="0" rules={[{ required: true }]} />
      <ProFormTextArea name="assignments" label="替换分配（JSON 数组）" initialValue="[]" fieldProps={{ rows: 6 }} />
    </ModalForm>
    <Button href={stepUp("model.site-release-catalog.publish", props.siteId || "site-required", "/models")}>提升发布认证</Button>
    <ModalForm title="发布站点模型目录" width={700} trigger={<Button disabled={!props.siteId}>发布目录</Button>}
      onFinish={(values) => props.submit({ action: "publish_site_release_catalog", siteId: props.siteId,
        siteReleaseRef: values.siteReleaseRef, inventoryDigest: values.inventoryDigest,
        surfaces: json(values.surfaces) }, "站点模型目录已发布") }>
      <ProFormText name="siteReleaseRef" label="Site release ref" rules={[{ required: true }]} />
      <ProFormSelect name="inventoryDigest" label="目录版本" initialValue={props.selectedDigest || undefined}
        options={props.inventories.map((item) => ({ value: item.inventoryDigest, label: item.sourceReference }))}
        rules={[{ required: true }]} />
      <ProFormTextArea name="surfaces" label="Surface 发布清单（JSON 数组）" fieldProps={{ rows: 8 }}
        rules={[{ required: true }]} />
    </ModalForm>
  </>;
}

function CursorTable<Row extends Record<string, unknown>>(props: Readonly<{ schema: z.ZodType<Row>;
  view: string; inventoryDigest?: string; siteId?: string; rowKey: string | ((row: Row) => string);
  generation: number; columns: ProColumns<Row>[] }>): React.ReactElement {
  const { message } = App.useApp(); const query = useMemo(() => new URLSearchParams({ view: props.view,
    ...(props.inventoryDigest ? { inventoryDigest: props.inventoryDigest } : {}),
    ...(props.siteId ? { siteId: props.siteId } : {}) }).toString(), [props.view, props.inventoryDigest, props.siteId]);
  return <ProTable<Row> rowKey={props.rowKey} columns={props.columns} search={false} pagination={false}
    options={{ reload: true, density: true }} params={{ query, generation: props.generation }}
    request={async () => { try { const items = await collectCursorPages((token, signal) => apiGet(
      `/api/control/models?${query}${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
      page(props.schema), { signal }), { identity: (item) => typeof props.rowKey === "function"
        ? props.rowKey(item) : String(item[props.rowKey]), maxItems: 5000, maxPages: 50, timeoutMs: 8_000 });
    return { data: items, success: true, total: items.length }; } catch (error) {
      message.error(errorMessage(error, "加载失败")); return { data: [], success: false, total: 0 }; } }} />;
}

function Section(props: Readonly<{ title: string; children: React.ReactNode }>): React.ReactElement {
  return <Card title={props.title} styles={{ body: { padding: 0 } }}>{props.children}</Card>;
}
function iconLabel(icon: React.ReactNode, text: string) { return <Space size={6}>{icon}{text}</Space>; }
function short(value: string) { return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function chips(values: unknown) { return Array.isArray(values) ? <Space wrap>{values.map((value) =>
  <Tag key={String(value)}>{String(value)}</Tag>)}</Space> : "—"; }
function stateTag(value: unknown) { const active = value === true || value === "active" || value === "healthy";
  return <Tag color={active ? "success" : value === "degraded" ? "warning" : "default"}>{String(value)}</Tag>; }
function json(value: unknown): unknown { if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { throw new Error("JSON 格式无效"); } }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function stepUp(operation: string, resource: string, back: string) { return `/api/control/auth/step-up?operation=${encodeURIComponent(operation)}`
  + `&resource=${encodeURIComponent(resource)}&return=${encodeURIComponent(back)}`; }

const inventoryColumns: ProColumns<Inventory>[] = [
  { title: "状态", render: (_, row) => row.active ? <Tag color="success">Active</Tag> : <Tag>历史</Tag>, width: 90 },
  { title: "来源", dataIndex: "sourceReference" }, { title: "Digest", dataIndex: "inventoryDigest", copyable: true, ellipsis: true },
  { title: "模型 / 提供方 / 绑定 / 路由", render: (_, row) => row.counts ? `${row.counts.models} / ${row.counts.providers} / ${row.counts.bindings} / ${row.counts.productRoutes}` : "—" },
  { title: "指针修订", dataIndex: "activePointerRevision", width: 100 },
  { title: "导入时间", dataIndex: "importedAt", valueType: "dateTime", width: 180 },
];
const providerColumns: ProColumns<Provider>[] = [
  { title: "Provider key", dataIndex: "providerKey", copyable: true }, { title: "实现", dataIndex: "provider" },
  { title: "账号", dataIndex: "accountKey" }, { title: "适配器", dataIndex: "adapterKind" },
  { title: "密钥配置", render: (_, row) => row.secretReferencePresent ? <Tag color="success">已配置</Tag> : <Tag color="error">缺失</Tag> },
  { title: "状态", render: (_, row) => stateTag(row.status) }, { title: "健康", render: (_, row) => stateTag(row.health) },
  { title: "Epoch", dataIndex: "availabilityEpoch" },
];
const definitionColumns: ProColumns<Definition>[] = [
  { title: "模型", dataIndex: "displayName" }, { title: "Model key", dataIndex: "modelKey", copyable: true },
  { title: "输入", render: (_, row) => chips(row.inputModalities) }, { title: "输出", render: (_, row) => chips(row.outputModalities) },
  { title: "能力", render: (_, row) => chips(row.capabilities) }, { title: "上下文", dataIndex: "contextWindow" },
  { title: "启用", render: (_, row) => stateTag(row.enabled) },
];
const bindingColumns: ProColumns<Binding>[] = [
  { title: "Binding key", dataIndex: "bindingKey", copyable: true }, { title: "模型", dataIndex: "modelKey" },
  { title: "提供方", dataIndex: "providerKey" }, { title: "上游模型", dataIndex: "upstreamModel" },
  { title: "Gateway alias", dataIndex: "gatewayModelName" }, { title: "优先级", dataIndex: "priority" },
  { title: "启用", render: (_, row) => stateTag(row.enabled) },
];
const routeColumns: ProColumns<Route>[] = [
  { title: "产品", dataIndex: "product" }, { title: "角色", dataIndex: "role" }, { title: "位置", dataIndex: "position" },
  { title: "模型", dataIndex: "modelKey", copyable: true }, { title: "要求能力", render: (_, row) => chips(row.requiredCapabilities) },
];
const optionColumns: ProColumns<Option>[] = [
  { title: "选项", dataIndex: "label" }, { title: "Option key", dataIndex: "optionKey" },
  { title: "Surface", dataIndex: "surface" }, { title: "Tier", dataIndex: "tier" },
  { title: "生命周期", render: (_, row) => stateTag(row.lifecycle) },
  { title: "Revision ref", dataIndex: "revisionRef", copyable: true, ellipsis: true },
  { title: "创建时间", dataIndex: "createdAt", valueType: "dateTime" },
];
const policyColumns: ProColumns<Policy>[] = [
  { title: "产品", dataIndex: "product" }, { title: "修订", dataIndex: "revision" },
  { title: "当前", render: (_, row) => row.current ? <Tag color="success">Current</Tag> : <Tag>历史</Tag> },
  { title: "启用", render: (_, row) => stateTag(row.enabled) }, { title: "目录模式", dataIndex: "catalogMode" },
  { title: "分配", render: (_, row) => `${row.assignmentMode} · ${row.assignmentCount}` },
  { title: "变更时间", dataIndex: "changedAt", valueType: "dateTime" },
];
const catalogColumns: ProColumns<Catalog>[] = [
  { title: "Site release", dataIndex: "siteReleaseRef", copyable: true },
  { title: "Model catalog ref", dataIndex: "modelOptionCatalogRef", copyable: true, ellipsis: true },
  { title: "Inventory", dataIndex: "inventoryDigest", copyable: true, ellipsis: true },
  { title: "Surface 数", dataIndex: "surfaceCount" }, { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime" },
];
