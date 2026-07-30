"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Tag } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";

import { useAdmin } from "@/components/shell/app-shell";
import { apiGet } from "@/lib/api";
import { appendCursorPage, clearNextPageToken, CursorWindowError, LatestRequest, resetCursorWindow,
  type CursorWindow } from "@/lib/cursor-window";

const audit = z.object({ auditRef: z.string(), actionCode: z.string(), occurredAt: z.string() });
type Audit = z.infer<typeof audit>;
const response = z.object({ items: z.array(audit), nextPageToken: z.string().min(1).max(256).nullable() });
const loadMoreLimits = { identity: (item: Audit) => item.auditRef, maxItems: 1000, maxPages: 20 } as const;

export default function AuditPage(): React.ReactElement {
  const { message } = App.useApp();
  const { siteId } = useAdmin();
  const [window, setWindow] = useState<CursorWindow<Audit>>(() => resetCursorWindow());
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [loadedSiteId, setLoadedSiteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const windowRef = useRef(window);
  const requests = useRef(new LatestRequest());
  const commitWindow = useCallback((next: CursorWindow<Audit>) => {
    windowRef.current = next;
    setWindow(next);
  }, []);
  const loadPage = useCallback((pageToken: string | null, replace: boolean) => {
    const generation = requests.current.begin();
    const requestedSiteId = siteId;
    const query = new URLSearchParams();
    if (requestedSiteId) query.set("siteId", requestedSiteId);
    if (pageToken) query.set("pageToken", pageToken);
    const encoded = query.toString();
    return apiGet(encoded ? `/api/control/audit?${encoded}` : "/api/control/audit", response)
      .then((result) => {
        if (!requests.current.isCurrent(generation)) return;
        const base = replace ? resetCursorWindow<Audit>() : windowRef.current;
        commitWindow(appendCursorPage(base, result, loadMoreLimits));
        setPaginationError(null);
        setLoadedSiteId(requestedSiteId);
      })
      .catch((error: unknown) => {
        if (!requests.current.isCurrent(generation)) return;
        const errorMessage = error instanceof Error ? error.message : "加载失败";
        if (replace) commitWindow(resetCursorWindow());
        else if (error instanceof CursorWindowError) commitWindow(clearNextPageToken(windowRef.current));
        if (replace) setLoadedSiteId(requestedSiteId);
        setPaginationError(errorMessage);
        message.error(errorMessage);
      })
      .finally(() => {
        if (requests.current.isCurrent(generation)) setLoading(false);
      });
  }, [commitWindow, message, siteId]);
  const startLoad = useCallback((pageToken: string | null, replace: boolean) => {
    if (replace) {
      commitWindow(resetCursorWindow());
      setLoadedSiteId(siteId);
    }
    setPaginationError(null);
    setLoading(true);
    void loadPage(pageToken, replace);
  }, [commitWindow, loadPage, siteId]);

  useEffect(() => {
    const requestGate = requests.current;
    void loadPage(null, true);
    return () => { requestGate.invalidate(); };
  }, [loadPage]);

  const visibleRows = loadedSiteId === siteId ? window.rows : [];
  const visibleNextPageToken = loadedSiteId === siteId ? window.nextPageToken : null;
  const visibleLoading = loading || loadedSiteId !== siteId;

  const columns: ProColumns<Audit>[] = [
    { title: "Audit ref", dataIndex: "auditRef", copyable: true, ellipsis: true },
    { title: "动作", dataIndex: "actionCode", render: (_, row) => <Tag>{row.actionCode}</Tag> },
    { title: "发生时间", dataIndex: "occurredAt", valueType: "dateTime", width: 190 },
  ];
  return <PageContainer header={{ title: "审计" }}
    content={siteId ? `当前只查询已授权站点 ${siteId} 的 append-only 审计记录。` : "当前按全局操作员授权查询审计记录。"}>
    {paginationError && <Alert type="error" showIcon message="审计列表未完整加载" description={paginationError} />}
    <ProTable<Audit> rowKey="auditRef" columns={columns} search={false} pagination={false}
      dataSource={[...visibleRows]} loading={visibleLoading} options={{ reload: () => { startLoad(null, true); }, density: true }}
      toolBarRender={() => visibleNextPageToken ? [<Button key="load-more" loading={visibleLoading}
        onClick={() => { startLoad(visibleNextPageToken, false); }}>加载更多</Button>] : []} />
  </PageContainer>;
}
