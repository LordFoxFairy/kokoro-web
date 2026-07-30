"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Card, Descriptions, Drawer, Empty, Form, Input, Select, Space,
  Statistic, Tabs, Tag, Typography } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import type { z } from "zod";

import styles from "./credit-console.module.css";
import { useAdmin } from "@/components/shell/app-shell";
import { apiGet } from "@/lib/api";
import {
  creditAccountListSchema,
  creditAccountSchema,
  creditGrantListSchema,
  creditHoldAllocationListSchema,
  creditHoldListSchema,
  creditJournalEntryListSchema,
  creditJournalTransactionListSchema,
  formatCreditDecimal,
  pairedSourceFilter,
  ratedUsageListSchema,
  ratedUsageSourceAllocationListSchema,
  siteCreditSummarySchema,
  type CreditAccount,
  type CreditGrant,
  type CreditHold,
  type CreditHoldAllocation,
  type CreditJournalEntry,
  type CreditJournalTransaction,
  type CreditSourceType,
  type RatedUsage,
  type RatedUsageSourceAllocation,
  type SiteCreditSummary,
} from "@/lib/credit-contract";
import { creditQuery, grantToHolds, holdToUsage, sourceAllocationToGrant,
  type CreditFilters, type CreditNavigation, type CreditView } from "@/lib/credit-navigation";
import { appendCursorPage, clearNextPageToken, CursorWindowError, LatestRequest, resetCursorWindow,
  type CursorWindow } from "@/lib/cursor-window";

const ENDPOINTS = {
  summary: "/api/control/credit/summary",
  accounts: "/api/control/credit/accounts",
  grants: "/api/control/credit/grants",
  holds: "/api/control/credit/holds",
  holdAllocations: "/api/control/credit/hold-allocations",
  journalTransactions: "/api/control/credit/journal-transactions",
  journalEntries: "/api/control/credit/journal-entries",
  ratedUsage: "/api/control/credit/rated-usage",
  ratedUsageSources: "/api/control/credit/rated-usage-source-allocations",
} as const;
const WINDOW_LIMITS = { maxItems: 1000, maxPages: 20 } as const;

type HoldAllocationDrawer = Readonly<{ kind: "grant" | "hold"; ref: string }>;
type UsageSourceDrawer = Readonly<{ kind: "usage" | "settlement"; ref: string }>;

const accountIdentity = (row: CreditAccount) => row.creditAccountRef;
const grantIdentity = (row: CreditGrant) => row.creditGrantId;
const holdIdentity = (row: CreditHold) => row.creditHoldRef;
const journalTransactionIdentity = (row: CreditJournalTransaction) => row.journalTransactionRef;
const ratedUsageIdentity = (row: RatedUsage) => row.ratedUsageRef;
const holdAllocationIdentity = (row: CreditHoldAllocation) =>
  `${row.creditHoldRef}:${row.allocationOrdinal}`;
const journalEntryIdentity = (row: CreditJournalEntry) =>
  `${row.journalTransactionRef}:${row.entryOrdinal}`;
const ratedUsageSourceIdentity = (row: RatedUsageSourceAllocation) =>
  `${row.ratedUsageRef}:${row.allocationOrdinal}`;

export function CreditConsole(): React.ReactElement {
  const { siteId } = useAdmin();
  return <CreditConsoleSite key={siteId} siteId={siteId} />;
}

function CreditConsoleSite({ siteId }: Readonly<{ siteId: string }>): React.ReactElement {
  const [view, setView] = useState<CreditView>("accounts");
  const [filters, setFilters] = useState<CreditFilters>({});
  const [holdAllocations, setHoldAllocations] = useState<HoldAllocationDrawer | null>(null);
  const [journalEntries, setJournalEntries] = useState<string | null>(null);
  const [usageSources, setUsageSources] = useState<UsageSourceDrawer | null>(null);
  const [accountDetail, setAccountDetail] = useState<string | null>(null);
  const summary = useCreditSummary(siteId);

  const navigate = useCallback((next: CreditNavigation) => {
    setView(next.view); setFilters(next.filters);
  }, []);
  const changeView = useCallback((key: string) => {
    setView(key as CreditView); setFilters({});
  }, []);

  return <PageContainer header={{ title: "积分事实追踪" }}
    content="只读查看 Site 的账户、Grant、Hold、复式流水与 RatedUsage；所有结果来自 typed AdminCredit 控制面。">
    <div className={styles.console}>
      {!siteId ? <Empty className={styles.emptySite} description="请先在顶部选择 Site" /> : <>
        <SummaryStrip state={summary} />
        <Tabs activeKey={view} onChange={changeView} items={[
          { key: "accounts", label: "账户" }, { key: "grants", label: "Grant" },
          { key: "holds", label: "Hold" }, { key: "journal", label: "流水" },
          { key: "usage", label: "Rated Usage" },
        ]} />
        <FilterBar view={view} value={filters} onApply={setFilters} onClear={() => setFilters({})} />
        {view === "accounts" && <AccountsPanel siteId={siteId} filters={filters}
          onDetail={setAccountDetail} onNavigate={navigate} />}
        {view === "grants" && <GrantsPanel siteId={siteId} filters={filters} onNavigate={navigate}
          onAllocations={(ref) => setHoldAllocations({ kind: "grant", ref })}
          onEntries={setJournalEntries} />}
        {view === "holds" && <HoldsPanel siteId={siteId} filters={filters} onNavigate={navigate}
          onAllocations={(ref) => setHoldAllocations({ kind: "hold", ref })} />}
        {view === "journal" && <JournalPanel siteId={siteId} filters={filters} onEntries={setJournalEntries} />}
        {view === "usage" && <UsagePanel siteId={siteId} filters={filters} onNavigate={navigate}
          onSources={(ref) => setUsageSources({ kind: "usage", ref })} />}
      </>}
      <AccountDrawer key={`${siteId}:${accountDetail ?? "closed"}`} siteId={siteId}
        accountRef={accountDetail} onClose={() => setAccountDetail(null)} />
      <HoldAllocationTraceDrawer siteId={siteId} trace={holdAllocations}
        onClose={() => setHoldAllocations(null)} onNavigate={(next) => { setHoldAllocations(null); navigate(next); }} />
      <JournalEntryDrawer siteId={siteId} transactionRef={journalEntries} onClose={() => setJournalEntries(null)} />
      <UsageSourceTraceDrawer siteId={siteId} trace={usageSources} onClose={() => setUsageSources(null)}
        onNavigate={(next) => { setUsageSources(null); navigate(next); }} />
    </div>
  </PageContainer>;
}

function SummaryStrip({ state }: Readonly<{ state: ReturnType<typeof useCreditSummary> }>): React.ReactElement {
  if (state.error) return <Alert type="error" showIcon message="积分汇总加载失败" description={state.error} />;
  const value = state.value;
  const facts = [
    ["账户", value?.creditAccountCount], ["活跃账户", value?.activeCreditAccountCount],
    ["Open Hold", value?.openHoldCount], ["需对账 Hold", value?.reconciliationRequiredHoldCount],
  ] as const;
  return <>
    <div className={`${styles.summaryGrid} animate-rise`}>
      {facts.map(([label, amount]) => <Card key={label} className={styles.summaryCard} loading={state.loading} size="small">
        <Statistic title={label} value={amount ? formatCreditDecimal(amount) : "—"} />
      </Card>)}
      <Card className={styles.summaryCard} loading={state.loading} size="small">
        <div className={styles.balanceLabel}>可用余额</div>
        {(value?.balances ?? []).length === 0 ? "—" : value!.balances.map((balance) =>
          <div key={balance.unit} className={styles.amount}>{formatCreditDecimal(balance.availableAmount)}
            <small>{balance.unit}</small></div>)}
      </Card>
    </div>
    {value && <div className={styles.watermark}>数据库观测于 {displayTime(value.asOf)}；这是权威事实观测，不是跨请求事务快照。</div>}
  </>;
}

function FilterBar({ view, value, onApply, onClear }: Readonly<{ view: CreditView; value: CreditFilters;
  onApply: (value: CreditFilters) => void; onClear: () => void }>): React.ReactElement {
  const { message } = App.useApp(); const [form] = Form.useForm();
  useEffect(() => { form.resetFields(); form.setFieldsValue(value); }, [form, value]);
  const sourceCapable = view !== "accounts";
  return <Card className={styles.filters} size="small">
    <Form form={form} className={styles.filterForm} layout="inline" onFinish={(raw) => {
      const sourceType = String(raw.sourceType ?? "") as CreditSourceType | "";
      try {
        const source = pairedSourceFilter(sourceType, String(raw.sourceRef ?? ""));
        const next = Object.fromEntries(Object.entries(raw).flatMap(([key, item]) => {
          const text = String(item ?? "").trim(); return text.length === 0 || key === "sourceType" || key === "sourceRef"
            ? [] : [[key, text]];
        }));
        onApply({ ...next, ...source });
      } catch { message.error("来源类型与来源引用必须同时填写"); }
    }}>
      {view === "accounts" ? <Form.Item name="billingAccountRef" label="Billing account"><Input allowClear /></Form.Item> :
        <Form.Item name="creditAccountRef" label="Credit account"><Input allowClear /></Form.Item>}
      {["grants", "holds", "journal", "usage"].includes(view) &&
        <Form.Item name="creditGrantId" label="Grant ID"><Input allowClear /></Form.Item>}
      {["journal", "usage"].includes(view) &&
        <Form.Item name="creditHoldRef" label="Hold ID"><Input allowClear /></Form.Item>}
      {view === "usage" && <Form.Item name="attemptRef" label="Attempt"><Input allowClear /></Form.Item>}
      {sourceCapable && <>
        <Form.Item name="sourceType" label="来源类型"><Select allowClear style={{ width: 150 }} options={[
          { value: "redemption", label: "Redemption" }, { value: "payment", label: "Payment" },
          { value: "admin_grant", label: "Admin grant" }, { value: "program_window", label: "Program window" },
        ]} /></Form.Item>
        <Form.Item name="sourceRef" label="来源引用"><Input allowClear /></Form.Item>
      </>}
      <Form.Item><Space><Button type="primary" htmlType="submit">应用筛选</Button>
        <Button onClick={() => { form.resetFields(); onClear(); }}>清除</Button></Space></Form.Item>
    </Form>
  </Card>;
}

function AccountsPanel({ siteId, filters, onDetail, onNavigate }: Readonly<{ siteId: string; filters: CreditFilters;
  onDetail: (ref: string) => void; onNavigate: (next: CreditNavigation) => void }>) {
  const columns: ProColumns<CreditAccount>[] = [
    { title: "Credit account", render: (_, row) => <RefText value={row.creditAccountRef} /> },
    { title: "Billing account", dataIndex: "billingAccountRef", ellipsis: true },
    { title: "状态", render: (_, row) => <StateTag value={row.state} /> },
    { title: "可用", align: "right", render: (_, row) => <Amount value={row.balance.availableAmount} unit={row.unit} /> },
    { title: "预留", align: "right", render: (_, row) => <Amount value={row.balance.reservedAmount} unit={row.unit} /> },
    { title: "已消费", align: "right", render: (_, row) => <Amount value={row.balance.consumedAmount} unit={row.unit} /> },
    { title: "Grant", dataIndex: "grantCount", align: "right" },
    { title: "Open Hold", dataIndex: "openHoldCount", align: "right" },
    { title: "更新时间", render: (_, row) => displayTime(row.updatedAt), width: 180 },
    { title: "追踪", valueType: "option", fixed: "right", render: (_, row) => [
      <Button key="detail" type="link" onClick={() => onDetail(row.creditAccountRef)}>详情</Button>,
      <Button key="grant" type="link" onClick={() => onNavigate({ view: "grants",
        filters: { creditAccountRef: row.creditAccountRef } })}>Grant</Button>,
      <Button key="hold" type="link" onClick={() => onNavigate({ view: "holds",
        filters: { creditAccountRef: row.creditAccountRef } })}>Hold</Button>,
    ] },
  ];
  return <CreditTable siteId={siteId} endpoint={ENDPOINTS.accounts} schema={creditAccountListSchema}
    identity={accountIdentity} columns={columns} filters={filters} />;
}

function GrantsPanel({ siteId, filters, onNavigate, onAllocations, onEntries }: Readonly<{ siteId: string;
  filters: CreditFilters; onNavigate: (next: CreditNavigation) => void; onAllocations: (ref: string) => void;
  onEntries: (ref: string) => void }>) {
  const columns: ProColumns<CreditGrant>[] = [
    { title: "Grant", render: (_, row) => <RefText value={row.creditGrantId} /> },
    { title: "来源", render: (_, row) => <Space direction="vertical" size={0}><StateTag value={row.sourceType} />
      <Typography.Text type="secondary" ellipsis>{row.sourceRef}</Typography.Text></Space> },
    { title: "桶", render: (_, row) => <Tag>{row.bucketClass}</Tag> },
    { title: "原始额度", align: "right", render: (_, row) => <Amount value={row.originalAmount} unit={row.unit} /> },
    { title: "Hold / 执行", render: (_, row) => `${row.relatedHoldCount} / ${row.relatedExecutionCount}` },
    { title: "生效", render: (_, row) => displayTime(row.effectiveAt), width: 180 },
    { title: "到期", render: (_, row) => row.expiresAt ? displayTime(row.expiresAt) : "永久", width: 180 },
    { title: "追踪", valueType: "option", fixed: "right", render: (_, row) => [
      <Button key="holds" type="link" onClick={() => onNavigate(grantToHolds(row.creditGrantId))}>关联 Hold</Button>,
      <Button key="alloc" type="link" onClick={() => onAllocations(row.creditGrantId)}>分摊</Button>,
      <Button key="journal" type="link" onClick={() => onEntries(row.issuanceJournalTransactionRef)}>入账分录</Button>,
    ] },
  ];
  return <CreditTable siteId={siteId} endpoint={ENDPOINTS.grants} schema={creditGrantListSchema}
    identity={grantIdentity} columns={columns} filters={filters} />;
}

function HoldsPanel({ siteId, filters, onNavigate, onAllocations }: Readonly<{ siteId: string;
  filters: CreditFilters; onNavigate: (next: CreditNavigation) => void; onAllocations: (ref: string) => void }>) {
  const columns: ProColumns<CreditHold>[] = [
    { title: "Hold", render: (_, row) => <RefText value={row.creditHoldRef} /> },
    { title: "执行", render: (_, row) => <RefText value={row.executionRootRef} /> },
    { title: "状态", render: (_, row) => <StateTag value={row.state} /> },
    { title: "请求", align: "right", render: (_, row) => <Amount value={row.requestedAmount} unit={row.unit} /> },
    { title: "捕获", align: "right", render: (_, row) => <Amount value={row.capturedAmount} unit={row.unit} /> },
    { title: "释放", align: "right", render: (_, row) => <Amount value={row.releasedAmount} unit={row.unit} /> },
    { title: "Grant / Source", render: (_, row) => `${row.grantCount} / ${row.sourceCount}` },
    { title: "更新时间", render: (_, row) => displayTime(row.updatedAt), width: 180 },
    { title: "追踪", valueType: "option", fixed: "right", render: (_, row) => [
      <Button key="alloc" type="link" onClick={() => onAllocations(row.creditHoldRef)}>Grant 分摊</Button>,
      <Button key="usage" type="link" onClick={() => onNavigate(holdToUsage(row.creditHoldRef))}>Rated Usage</Button>,
      <Button key="journal" type="link" onClick={() => onNavigate({ view: "journal",
        filters: { creditHoldRef: row.creditHoldRef } })}>流水</Button>,
    ] },
  ];
  return <CreditTable siteId={siteId} endpoint={ENDPOINTS.holds} schema={creditHoldListSchema}
    identity={holdIdentity} columns={columns} filters={filters} />;
}

function JournalPanel({ siteId, filters, onEntries }: Readonly<{ siteId: string; filters: CreditFilters;
  onEntries: (ref: string) => void }>) {
  const columns: ProColumns<CreditJournalTransaction>[] = [
    { title: "Transaction", render: (_, row) => <RefText value={row.journalTransactionRef} /> },
    { title: "业务操作", dataIndex: "businessOperationKey", ellipsis: true },
    { title: "类型", render: (_, row) => <StateTag value={row.operationKind} /> },
    { title: "分录数", dataIndex: "entryCount", align: "right" },
    { title: "发生时间", render: (_, row) => displayTime(row.occurredAt), width: 180 },
    { title: "追踪", valueType: "option", render: (_, row) =>
      <Button type="link" onClick={() => onEntries(row.journalTransactionRef)}>查看复式分录</Button> },
  ];
  return <CreditTable siteId={siteId} endpoint={ENDPOINTS.journalTransactions}
    schema={creditJournalTransactionListSchema} identity={journalTransactionIdentity}
    columns={columns} filters={filters} />;
}

function UsagePanel({ siteId, filters, onNavigate, onSources }: Readonly<{ siteId: string; filters: CreditFilters;
  onNavigate: (next: CreditNavigation) => void; onSources: (ref: string) => void }>) {
  const columns: ProColumns<RatedUsage>[] = [
    { title: "Rated Usage", render: (_, row) => <RefText value={row.ratedUsageRef} /> },
    { title: "Settlement", render: (_, row) => <RefText value={row.settlementRef} /> },
    { title: "Attempt", dataIndex: "attemptRef", ellipsis: true },
    { title: "客户金额", align: "right", render: (_, row) => <Amount value={row.customerAmount} unit={row.unit} /> },
    { title: "平台敞口", align: "right", render: (_, row) => <Amount value={row.platformExposureAmount} unit={row.unit} /> },
    { title: "Source", dataIndex: "sourceCount", align: "right" },
    { title: "创建时间", render: (_, row) => displayTime(row.createdAt), width: 180 },
    { title: "追踪", valueType: "option", fixed: "right", render: (_, row) => [
      <Button key="sources" type="link" onClick={() => onSources(row.ratedUsageRef)}>来源 Grant</Button>,
      <Button key="journal" type="link" onClick={() => onNavigate({ view: "journal",
        filters: { creditHoldRef: row.creditHoldRef } })}>结算流水</Button>,
    ] },
  ];
  return <CreditTable siteId={siteId} endpoint={ENDPOINTS.ratedUsage} schema={ratedUsageListSchema}
    identity={ratedUsageIdentity} columns={columns} filters={filters} />;
}

interface CreditPage<Item> { readonly items: readonly Item[]; readonly nextPageToken: string | null;
  readonly membershipWatermark: string; readonly observedAt: string }
function CreditTable<Item extends object>({ siteId, endpoint, schema, identity, columns, filters,
  enabled = true }: Readonly<{ siteId: string; endpoint: string; schema: z.ZodType<CreditPage<Item>>;
    identity: (item: Item) => string; columns: ProColumns<Item>[]; filters: CreditFilters; enabled?: boolean }>) {
  const state = useCreditPage(enabled, siteId, endpoint, schema, identity, filters);
  return <>
    {state.error && <Alert type="error" showIcon message="列表未完整加载" description={state.error} />}
    <ProTable<Item> rowKey={identity} columns={columns} dataSource={[...state.window.rows]} search={false}
      pagination={false} loading={state.loading} scroll={{ x: "max-content" }}
      options={{ density: true, reload: state.reload }}
      toolBarRender={() => [<div key="observation" className={styles.observation}>
        <Tag color="green">成员水位 {state.membershipWatermark ? displayTime(state.membershipWatermark) : "—"}</Tag>
        <Tag>本页观测 {state.observedAt ? displayTime(state.observedAt) : "—"}</Tag>
        {state.window.nextPageToken && <Button loading={state.loading} onClick={state.loadMore}>加载更多</Button>}
      </div>]} />
  </>;
}

function useCreditPage<Item>(enabled: boolean, siteId: string, endpoint: string, schema: z.ZodType<CreditPage<Item>>,
  identity: (item: Item) => string, filters: CreditFilters) {
  const [window, setWindow] = useState<CursorWindow<Item>>(() => resetCursorWindow());
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const [membershipWatermark, setMembershipWatermark] = useState<string | null>(null);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const windowRef = useRef(window); const requests = useRef(new LatestRequest());
  const commit = useCallback((next: CursorWindow<Item>) => { windowRef.current = next; setWindow(next); }, []);
  const load = useCallback((pageToken: string | null, replace: boolean) => {
    if (!enabled || !siteId) return Promise.resolve();
    const generation = requests.current.begin();
    if (replace) {
      commit(resetCursorWindow());
      setMembershipWatermark(null);
      setObservedAt(null);
    }
    setError(null); setLoading(true);
    return apiGet(`${endpoint}?${creditQuery(siteId, filters, pageToken ?? undefined)}`, schema)
      .then((page) => {
        if (!requests.current.isCurrent(generation)) return;
        const base = replace ? resetCursorWindow<Item>() : windowRef.current;
        commit(appendCursorPage(base, page, { identity, ...WINDOW_LIMITS }));
        setMembershipWatermark(page.membershipWatermark); setObservedAt(page.observedAt); setError(null);
      }).catch((reason: unknown) => {
        if (!requests.current.isCurrent(generation)) return;
        if (reason instanceof CursorWindowError) commit(clearNextPageToken(windowRef.current));
        setError(reason instanceof Error ? reason.message : "admin_credit.unavailable");
      }).finally(() => { if (requests.current.isCurrent(generation)) setLoading(false); });
  }, [commit, enabled, endpoint, filters, identity, schema, siteId]);
  const reload = useCallback(() => { commit(resetCursorWindow()); void load(null, true); }, [commit, load]);
  const loadMore = useCallback(() => { if (windowRef.current.nextPageToken) {
    void load(windowRef.current.nextPageToken, false);
  } }, [load]);
  useEffect(() => {
    const gate = requests.current;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (enabled && siteId) void load(null, true); else commit(resetCursorWindow());
    });
    return () => { cancelled = true; gate.invalidate(); };
  }, [commit, enabled, load, siteId]);
  return { window, loading, error, membershipWatermark, observedAt, reload, loadMore };
}

function AccountDrawer({ siteId, accountRef, onClose }: Readonly<{ siteId: string; accountRef: string | null;
  onClose: () => void }>) {
  const [value, setValue] = useState<CreditAccount | null>(null); const [error, setError] = useState<string | null>(null);
  const requests = useRef(new LatestRequest());
  useEffect(() => {
    const gate = requests.current;
    if (!accountRef || !siteId) return () => gate.invalidate();
    const generation = gate.begin();
    void apiGet(`${ENDPOINTS.accounts}/${encodeURIComponent(accountRef)}?${creditQuery(siteId)}`, creditAccountSchema)
      .then((loaded) => { if (gate.isCurrent(generation)) setValue(loaded); })
      .catch((reason: unknown) => { if (gate.isCurrent(generation)) setError(reason instanceof Error ? reason.message : "加载失败"); });
    return () => gate.invalidate();
  }, [accountRef, siteId]);
  return <Drawer title="Credit account 详情" width={560} open={accountRef !== null} onClose={onClose} destroyOnHidden>
    {error ? <Alert type="error" message={error} /> : value ? <Descriptions column={1} bordered size="small" items={[
      { key: "account", label: "Credit account", children: <RefText value={value.creditAccountRef} /> },
      { key: "billing", label: "Billing account", children: value.billingAccountRef },
      { key: "state", label: "状态", children: <StateTag value={value.state} /> },
      { key: "available", label: "可用", children: <Amount value={value.balance.availableAmount} unit={value.unit} /> },
      { key: "reserved", label: "预留", children: <Amount value={value.balance.reservedAmount} unit={value.unit} /> },
      { key: "consumed", label: "已消费", children: <Amount value={value.balance.consumedAmount} unit={value.unit} /> },
      { key: "asOf", label: "观测时刻", children: displayTime(value.asOf) },
    ]} /> : <Card loading />}
  </Drawer>;
}

function HoldAllocationTraceDrawer({ siteId, trace, onClose, onNavigate }: Readonly<{ siteId: string;
  trace: HoldAllocationDrawer | null; onClose: () => void; onNavigate: (next: CreditNavigation) => void }>) {
  const filters = useMemo<CreditFilters>(() => trace
    ? { [trace.kind === "grant" ? "creditGrantId" : "creditHoldRef"]: trace.ref }
    : {}, [trace]);
  const columns: ProColumns<CreditHoldAllocation>[] = [
    { title: "Hold", render: (_, row) => <RefText value={row.creditHoldRef} /> },
    { title: "Grant", render: (_, row) => <Button type="link"
      onClick={() => onNavigate(sourceAllocationToGrant(row.creditGrantId))}>{row.creditGrantId}</Button> },
    { title: "金额", align: "right", render: (_, row) => <Amount value={row.allocatedAmount} unit={row.unit} /> },
    { title: "序号", dataIndex: "allocationOrdinal", align: "right" },
    { title: "创建时间", render: (_, row) => displayTime(row.createdAt) },
  ];
  return <Drawer title="Hold ↔ Grant 分摊" width={920} open={trace !== null} onClose={onClose} destroyOnHidden>
    <CreditTable enabled={trace !== null} siteId={siteId} endpoint={ENDPOINTS.holdAllocations}
      schema={creditHoldAllocationListSchema} identity={holdAllocationIdentity}
      columns={columns} filters={filters} />
  </Drawer>;
}

function JournalEntryDrawer({ siteId, transactionRef, onClose }: Readonly<{ siteId: string;
  transactionRef: string | null; onClose: () => void }>) {
  const filters = useMemo<CreditFilters>(() => transactionRef
    ? { journalTransactionRef: transactionRef }
    : {}, [transactionRef]);
  const columns: ProColumns<CreditJournalEntry>[] = [
    { title: "#", dataIndex: "entryOrdinal", align: "right" },
    { title: "借贷", render: (_, row) => <StateTag value={row.entrySide} /> },
    { title: "科目", dataIndex: "accountType" },
    { title: "金额", align: "right", render: (_, row) => <Amount value={row.amount} unit={row.unit} /> },
    { title: "Grant", render: (_, row) => <RefText value={row.creditGrantId} /> },
    { title: "Hold", render: (_, row) => row.creditHoldRef ? <RefText value={row.creditHoldRef} /> : "—" },
    { title: "来源", render: (_, row) => `${row.sourceType} · ${row.sourceRef}` },
  ];
  return <Drawer title="复式分录" width={1040} open={transactionRef !== null} onClose={onClose} destroyOnHidden>
    <CreditTable enabled={transactionRef !== null} siteId={siteId} endpoint={ENDPOINTS.journalEntries}
      schema={creditJournalEntryListSchema} identity={journalEntryIdentity}
      columns={columns} filters={filters} />
  </Drawer>;
}

function UsageSourceTraceDrawer({ siteId, trace, onClose, onNavigate }: Readonly<{ siteId: string;
  trace: UsageSourceDrawer | null; onClose: () => void; onNavigate: (next: CreditNavigation) => void }>) {
  const filters = useMemo<CreditFilters>(() => trace
    ? { [trace.kind === "usage" ? "ratedUsageRef" : "settlementRef"]: trace.ref }
    : {}, [trace]);
  const columns: ProColumns<RatedUsageSourceAllocation>[] = [
    { title: "Rated Usage", render: (_, row) => <RefText value={row.ratedUsageRef} /> },
    { title: "Settlement", render: (_, row) => <RefText value={row.settlementRef} /> },
    { title: "Grant", render: (_, row) => <Button type="link"
      onClick={() => onNavigate(sourceAllocationToGrant(row.creditGrantId))}>{row.creditGrantId}</Button> },
    { title: "方向", render: (_, row) => <StateTag value={row.direction} /> },
    { title: "金额", align: "right", render: (_, row) => <Amount value={row.amount} /> },
    { title: "序号", dataIndex: "allocationOrdinal", align: "right" },
  ];
  return <Drawer title="Rated Usage ↔ Grant 来源" width={980} open={trace !== null} onClose={onClose} destroyOnHidden>
    <CreditTable enabled={trace !== null} siteId={siteId} endpoint={ENDPOINTS.ratedUsageSources}
      schema={ratedUsageSourceAllocationListSchema} identity={ratedUsageSourceIdentity}
      columns={columns} filters={filters} />
  </Drawer>;
}

function useCreditSummary(siteId: string) {
  const [value, setValue] = useState<SiteCreditSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(siteId));
  const [error, setError] = useState<string | null>(null); const requests = useRef(new LatestRequest());
  useEffect(() => {
    const gate = requests.current;
    if (!siteId) return () => gate.invalidate();
    const generation = gate.begin();
    void apiGet(`${ENDPOINTS.summary}?${creditQuery(siteId)}`, siteCreditSummarySchema)
      .then((loaded) => { if (gate.isCurrent(generation)) { setValue(loaded); setError(null); } })
      .catch((reason: unknown) => { if (gate.isCurrent(generation)) {
        setError(reason instanceof Error ? reason.message : "admin_credit.unavailable");
      } }).finally(() => { if (gate.isCurrent(generation)) setLoading(false); });
    return () => gate.invalidate();
  }, [siteId]);
  return { value, loading, error };
}

function Amount({ value, unit }: Readonly<{ value: string; unit?: string }>) {
  return <span className={styles.amount}>{formatCreditDecimal(value)}
    {unit && <small>{unit}</small>}</span>;
}
function RefText({ value }: Readonly<{ value: string }>) {
  return <Typography.Text copyable={{ text: value }} ellipsis={{ tooltip: value }} style={{ maxWidth: 220 }}>
    {value}</Typography.Text>;
}
function StateTag({ value }: Readonly<{ value: string }>) {
  const color = /active|open|capture|credit|settled/u.test(value) ? "green" :
    /reconciliation|exposure|closing/u.test(value) ? "orange" : /expired|revoked|debit/u.test(value) ? "red" : "blue";
  return <Tag color={color}>{value}</Tag>;
}
function displayTime(value: string): string {
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
