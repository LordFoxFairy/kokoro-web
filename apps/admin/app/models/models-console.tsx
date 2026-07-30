"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiOutlined, BranchesOutlined, CloudServerOutlined, DeploymentUnitOutlined,
  RocketOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Col, Descriptions, Empty, Row, Select, Space, Statistic, Tabs, Tag,
  Typography } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/api";
import { collectCursorPages } from "@/lib/cursor-pagination";
import {
  INITIAL_MODEL_RECOVERY_STATE,
  createModelRecoveryStateAuthority,
  modelRecoveryStateFromStorageEvent,
  readAvailableModelRecoveryState,
  reconcileModelRecoveryUnderLock,
  runModelMutationUnderLock,
  type ModelRecoveryLockManager,
  type ModelRecoveryState,
} from "@/lib/model-recovery-coordinator";
import { useAdmin } from "@/components/shell/app-shell";
import { ActivateInventoryAction, ChangeSitePolicyAction, ImportInventoryAction, MaterializeOptionsAction,
  PublishSiteCatalogAction } from "./model-control-forms";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const page = <Row extends z.ZodTypeAny>(row: Row) => z.object({ items: z.array(row),
  nextPageToken: z.string().nullable(), asOf: z.string().datetime() });
const inventory = z.object({ inventoryDigest: digest, sourceReference: z.string(), counts: z.object({
  providers: z.number(), models: z.number(), bindings: z.number(), productRoutes: z.number() }),
importedAt: z.string().datetime(), active: z.boolean(), activePointerRevision: z.string().nullable() });
const inventoryDetail = inventory.extend({ asOf: z.string().datetime() });
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
const mutation = z.object({ receipt: z.object({ commandId: z.string(), state: z.literal("committed") }),
  sourceDigest: digest.optional() }).passthrough();
const preparedMutation = z.object({ recoveryRef: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/u) }).strict();
const recoveredMutation = z.object({ operation: z.enum(["import_inventory", "activate_inventory",
  "change_site_policy", "materialize_options", "publish_site_release_catalog"]),
receipt: z.object({ commandId: z.string(), state: z.literal("committed") }),
result: z.record(z.string(), z.unknown()) });

type Inventory = z.infer<typeof inventory>;
type Provider = z.infer<typeof provider>;
type Definition = z.infer<typeof definition>;
type Binding = z.infer<typeof binding>;
type Route = z.infer<typeof route>;
type Option = z.infer<typeof option>;
type Policy = z.infer<typeof policy>;
type Catalog = z.infer<typeof catalog>;

export function ModelsConsole(): React.ReactElement {
  const { message } = App.useApp(); const { siteId } = useAdmin();
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [detail, setDetail] = useState<z.infer<typeof inventoryDetail> | null>(null);
  const [models, setModels] = useState<Definition[]>([]); const [options, setOptions] = useState<Option[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]); const [policySiteId, setPolicySiteId] = useState("");
  const [selectedDigest, setSelectedDigest] = useState(""); const [generation, setGeneration] = useState(0);
  const [recoveryState, setRecoveryState] = useState<ModelRecoveryState>(INITIAL_MODEL_RECOVERY_STATE);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const mutationActive = useRef(false);
  const [recoveryAuthority] = useState(createModelRecoveryStateAuthority);
  const pendingRecoveryRef = recoveryState.kind === "pending" ? recoveryState.recoveryRef : null;
  const writesBlocked = recoveryState.kind !== "clear" || mutationBusy;
  useEffect(() => {
    let active = true;
    const synchronize = () => {
      const state = recoveryAuthority.observe(readAvailableModelRecoveryState(
        window.localStorage, browserModelRecoveryLocks(),
      ));
      if (active) setRecoveryState(state);
    };
    const onStorage = (event: StorageEvent) => {
      const state = modelRecoveryStateFromStorageEvent(
        event, window.localStorage, browserModelRecoveryLocks(), recoveryAuthority,
      );
      if (active && state !== null) setRecoveryState(state);
    };
    window.addEventListener("storage", onStorage);
    queueMicrotask(synchronize);
    return () => { active = false; window.removeEventListener("storage", onStorage); };
  }, [recoveryAuthority]);
  useEffect(() => { let active = true; collectCursorPages<Inventory>((token, signal) => apiGet(
    `/api/control/models?view=inventories${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
    page(inventory), { signal }), { identity: (item) => item.inventoryDigest, maxItems: 1000,
    maxPages: 20, timeoutMs: 5_000 }).then((items) => {
      if (!active) return;
      setInventories(items); setSelectedDigest((current) => current || items.find((item) => item.active)?.inventoryDigest
        || items[0]?.inventoryDigest || "");
    }).catch((error: unknown) => { if (active) message.error(errorMessage(error, "目录加载失败")); });
  return () => { active = false; }; }, [generation, message]);
  useEffect(() => { let current = true; if (!selectedDigest) return () => { current = false; };
  Promise.all([
    apiGet(`/api/control/models?view=inventory&inventoryDigest=${encodeURIComponent(selectedDigest)}`,
      inventoryDetail),
    collectCursorPages<Definition>((token, signal) => apiGet(`/api/control/models?view=definitions&inventoryDigest=${selectedDigest}`
      + (token ? `&pageToken=${encodeURIComponent(token)}` : ""), page(definition), { signal }),
    { identity: (item) => item.modelKey, maxItems: 2_048, maxPages: 24, timeoutMs: 8_000 }),
    collectCursorPages<Option>((token, signal) => apiGet(`/api/control/models?view=options&inventoryDigest=${selectedDigest}`
      + (token ? `&pageToken=${encodeURIComponent(token)}` : ""), page(option), { signal }),
    { identity: (item) => item.revisionRef, maxItems: 5_000, maxPages: 50, timeoutMs: 8_000 }),
  ]).then(([nextDetail, nextModels, nextOptions]) => { if (current) {
    setDetail(nextDetail); setModels(nextModels); setOptions(nextOptions);
  } }).catch((error: unknown) => { if (current) message.error(errorMessage(error, "版本上下文加载失败")); });
  return () => { current = false; }; }, [selectedDigest, generation, message]);
  useEffect(() => { let current = true; if (!siteId) return () => { current = false; };
  collectCursorPages<Policy>((token, signal) => apiGet(`/api/control/models?view=policies&siteId=${encodeURIComponent(siteId)}`
    + (token ? `&pageToken=${encodeURIComponent(token)}` : ""), page(policy), { signal }),
  { identity: (item) => `${item.product}:${item.revision}`, maxItems: 1_000, maxPages: 20, timeoutMs: 8_000 })
    .then((items) => { if (current) { setPolicies(items); setPolicySiteId(siteId); } })
    .catch((error: unknown) => { if (current) message.error(errorMessage(error, "站点策略上下文加载失败")); });
  return () => { current = false; }; }, [siteId, generation, message]);
  const active = inventories.find((item) => item.active) ?? null;
  const selected = inventories.find((item) => item.inventoryDigest === selectedDigest) ?? null;
  const currentDetail = detail?.inventoryDigest === selectedDigest ? detail : null;
  const currentModels = detail?.inventoryDigest === selectedDigest ? models : [];
  const currentOptions = detail?.inventoryDigest === selectedDigest ? options : [];
  const currentPolicies = policySiteId === siteId ? policies : [];
  const reload = () => setGeneration((value) => value + 1);
  const reconcile = async () => {
    if (pendingRecoveryRef === null || reconciling) return;
    setReconciling(true);
    try {
      const result = await reconcileModelRecoveryUnderLock({
        storage: window.localStorage,
        locks: browserModelRecoveryLocks(),
        recoveryRef: pendingRecoveryRef,
        reconcile: () => apiGet(
          `/api/control/models?view=receipt&recoveryRef=${encodeURIComponent(pendingRecoveryRef)}`,
          recoveredMutation,
        ),
        onState: setRecoveryState,
        authority: recoveryAuthority,
      });
      if (result.kind === "completed") {
        message.success("已确认上一条模型命令提交成功"); reload();
      } else {
        message.warning("恢复引用已被其他标签页更新，当前页面未执行清理");
      }
    } catch (error) { message.error(errorMessage(error, "对账尚未完成，请稍后重试")); }
    finally { setReconciling(false); }
  };
  const submit = async (body: unknown, success: string) => {
    if (writesBlocked || mutationActive.current) {
      message.warning("模型写入尚未解锁，请先完成恢复状态处理"); return false;
    }
    mutationActive.current = true; setMutationBusy(true);
    try {
      const result = await runModelMutationUnderLock({
        storage: window.localStorage,
        locks: browserModelRecoveryLocks(),
        prepare: () => apiPost("/api/control/models", { phase: "prepare", command: body }, preparedMutation),
        execute: (recoveryRef) => apiPost(
          "/api/control/models", { phase: "execute", recoveryRef, command: body }, mutation,
        ),
        onState: setRecoveryState,
        authority: recoveryAuthority,
      });
      if (result.kind !== "completed") {
        message.warning(result.state.kind === "pending"
          ? "已有模型命令结果待确认，完成对账前不会发起新写入"
          : "当前浏览器无法安全取得模型写入锁，写入保持关闭");
        return false;
      }
      message.success(success); reload(); return true;
    } catch (error) {
      const current = recoveryAuthority.observe(readAvailableModelRecoveryState(
        window.localStorage, browserModelRecoveryLocks(),
      ));
      setRecoveryState(current);
      if (current.kind === "pending") {
        message.warning("写入结果暂不明确，已保存恢复引用；完成对账前不会发起新写入");
      } else message.error(errorMessage(error, "操作失败"));
      return false;
    } finally {
      mutationActive.current = false; setMutationBusy(false);
    }
  };

  return <PageContainer header={{ title: "模型控制台", subTitle: "一个全局目录，按产品组合，并按站点发布" }}
    content="从目录版本到站点发布的完整控制链路。提供方密钥只显示配置状态，永不返回引用或明文。"
    extra={<ImportInventoryAction submit={submit} disabled={writesBlocked} />}>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="控制面与运行面分离"
      description="这里管理不可变目录、产品选项与站点发布；实际模型执行仍由 Model Gateway 承担。所有写操作要求对应的提升认证与预期修订。" />
    {pendingRecoveryRef === null ? null : <Alert type="warning" showIcon style={{ marginBottom: 16 }}
      message="上一条模型命令结果待确认"
      description={<Space direction="vertical"><Typography.Text>
        系统已阻止新的模型写入。请用同一恢复引用查询权威收据，避免重复执行。
      </Typography.Text><Typography.Text code copyable ellipsis style={{ maxWidth: 720 }}>
        {pendingRecoveryRef}
      </Typography.Text><Typography.Text type="secondary">
        若持续未找到收据，请复制恢复引用联系支持；只有权威 committed 收据可以解除写入锁定。
      </Typography.Text><Button type="primary" loading={reconciling} onClick={() => void reconcile()}>
        立即对账
      </Button></Space>} />}
    {recoveryState.kind === "initializing" ? <Alert type="info" showIcon style={{ marginBottom: 16 }}
      message="正在确认本地恢复状态" description="确认完成前，所有模型写入保持关闭。" /> : null}
    {recoveryState.kind === "corrupt" ? <Alert type="error" showIcon style={{ marginBottom: 16 }}
      message="本地恢复状态损坏，当前页面已锁定模型写入"
      description="原始恢复数据已原样保留且不会显示。本页面生命周期内，任何本地删除、清空或替换都不能解除；跨刷新安全解除需要未来由服务端签发并绑定损坏指纹的所有者处置凭证。" /> : null}
    {recoveryState.kind === "unavailable" ? <Alert type="error" showIcon style={{ marginBottom: 16 }}
      message="无法建立安全的模型写入所有权"
      description={recoveryUnavailableDescription(recoveryState.reason)} /> : null}
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={24} md={12} xl={6}><Card><Statistic title="当前目录修订" prefix={<DeploymentUnitOutlined />}
        value={active?.activePointerRevision ?? "未激活"} /></Card></Col>
      <Col xs={12} md={6} xl={4}><Card><Statistic title="模型" value={active?.counts.models ?? 0} /></Card></Col>
      <Col xs={12} md={6} xl={4}><Card><Statistic title="提供方" value={active?.counts.providers ?? 0} /></Card></Col>
      <Col xs={12} md={6} xl={4}><Card><Statistic title="绑定" value={active?.counts.bindings ?? 0} /></Card></Col>
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
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <InventoryDetailCard detail={currentDetail} />
          <Card size="small"><ActivateInventoryAction submit={submit} inventories={inventories}
            selectedDigest={selectedDigest} disabled={writesBlocked} /></Card>
          <CursorTable schema={inventory} view="inventories" rowKey="inventoryDigest" generation={generation}
            columns={inventoryColumns(setSelectedDigest)} />
        </Space> },
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
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Card size="small"><MaterializeOptionsAction submit={submit} inventories={inventories}
            selectedDigest={selectedDigest} models={currentModels} disabled={writesBlocked} /></Card>
          <CursorTable schema={option} view="options" inventoryDigest={selectedDigest || undefined}
            rowKey="revisionRef" generation={generation} columns={optionColumns} />
        </Space> },
      { key: "site", label: iconLabel(<RocketOutlined />, "站点发布"), children: siteId
        ? <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Card size="small"><Space wrap>
            <ChangeSitePolicyAction submit={submit} siteId={siteId} inventories={inventories}
              models={currentModels} policies={currentPolicies} disabled={writesBlocked} />
            <PublishSiteCatalogAction submit={submit} siteId={siteId} inventories={inventories}
              selectedDigest={selectedDigest} options={currentOptions} disabled={writesBlocked} />
          </Space></Card>
          <Section title={`策略修订 · ${siteId}`}><CursorTable schema={policy} view="policies" siteId={siteId}
            rowKey={(row) => `${row.product}:${row.revision}`} generation={generation} columns={policyColumns} /></Section>
          <Section title="发布目录"><CursorTable schema={catalog} view="catalogs" siteId={siteId}
            rowKey="modelOptionCatalogRef" generation={generation} columns={catalogColumns} /></Section>
        </Space> : <Empty description="请先在顶部选择站点" /> },
    ]} />
  </PageContainer>;
}

function InventoryDetailCard(props: Readonly<{ detail: z.infer<typeof inventoryDetail> | null }>) {
  if (props.detail === null) return <Card><Empty description="选择一个目录版本查看权威详情" /></Card>;
  const value = props.detail;
  return <Card title={<Space><Typography.Text strong>{value.sourceReference}</Typography.Text>
    {value.active ? <Tag color="success">Active</Tag> : <Tag>历史版本</Tag>}</Space>}>
    <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} items={[
      { key: "digest", label: "Inventory digest", children: <Typography.Text code copyable>{value.inventoryDigest}</Typography.Text> },
      { key: "revision", label: "Active 指针修订", children: value.activePointerRevision ?? "—" },
      { key: "imported", label: "导入时间", children: new Date(value.importedAt).toLocaleString() },
      { key: "providers", label: "提供方", children: value.counts.providers },
      { key: "models", label: "逻辑模型", children: value.counts.models },
      { key: "bindings", label: "绑定 / 路由", children: `${value.counts.bindings} / ${value.counts.productRoutes}` },
      { key: "asOf", label: "一致性水位", children: new Date(value.asOf).toLocaleString() },
    ]} />
  </Card>;
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
function browserModelRecoveryLocks(): ModelRecoveryLockManager | null {
  if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") return null;
  return { request: async <T,>(name: string, options: Readonly<{ mode: "exclusive" }>,
    callback: () => Promise<T>) => {
    const holder: { outcome?: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }> } = {};
    await navigator.locks.request(name, options, async () => {
      try { holder.outcome = { ok: true, value: await callback() }; }
      catch (error) { holder.outcome = { ok: false, error }; }
    });
    const outcome = holder.outcome;
    if (outcome === undefined) throw new Error("model_recovery_lock_callback_not_run");
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  } };
}
function recoveryUnavailableDescription(reason: "locks" | "storage" | "invalid_prepared_ref") {
  if (reason === "locks") return "当前浏览器不支持 Web Locks，无法保证跨标签页单写者；模型写入保持关闭。";
  if (reason === "storage") return "本地恢复存储不可用，无法安全记录命令所有权；模型写入保持关闭。";
  return "服务端返回了无效恢复引用。该异常不会写入或覆盖本地状态，模型写入保持关闭。";
}
function iconLabel(icon: React.ReactNode, text: string) { return <Space size={6}>{icon}{text}</Space>; }
function short(value: string) { return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function chips(values: unknown) { return Array.isArray(values) ? <Space wrap>{values.map((value) =>
  <Tag key={String(value)}>{String(value)}</Tag>)}</Space> : "—"; }
function stateTag(value: unknown) { const active = value === true || value === "active" || value === "healthy";
  return <Tag color={active ? "success" : value === "degraded" ? "warning" : "default"}>{String(value)}</Tag>; }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

const inventoryColumns = (select: (digest: string) => void): ProColumns<Inventory>[] => [
  { title: "状态", render: (_, row) => row.active ? <Tag color="success">Active</Tag> : <Tag>历史</Tag>, width: 90 },
  { title: "来源", dataIndex: "sourceReference" }, { title: "Digest", dataIndex: "inventoryDigest", copyable: true, ellipsis: true },
  { title: "模型 / 提供方 / 绑定 / 路由", render: (_, row) => `${row.counts.models} / ${row.counts.providers} / ${row.counts.bindings} / ${row.counts.productRoutes}` },
  { title: "指针修订", dataIndex: "activePointerRevision", width: 100 },
  { title: "导入时间", dataIndex: "importedAt", valueType: "dateTime", width: 180 },
  { title: "操作", valueType: "option", width: 80, render: (_, row) => <Button type="link"
    onClick={() => select(row.inventoryDigest)}>查看详情</Button> },
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
