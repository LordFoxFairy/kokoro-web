"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Tag } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";

import { useAdmin } from "@/components/shell/app-shell";
import { apiGet } from "@/lib/api";

const audit = z.object({ auditRef: z.string(), actionCode: z.string(), occurredAt: z.string() });
type Audit = z.infer<typeof audit>;
const response = z.object({ items: z.array(audit), nextPageToken: z.string().min(1).max(256).nullable() });

export default function AuditPage(): React.ReactElement {
  const { message } = App.useApp();
  const { siteId } = useAdmin();
  const [rows, setRows] = useState<Audit[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadedSiteId, setLoadedSiteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestGeneration = useRef(0);
  const loadPage = useCallback((pageToken: string | null, replace: boolean) => {
    const generation = ++requestGeneration.current;
    const requestedSiteId = siteId;
    const query = new URLSearchParams();
    if (requestedSiteId) query.set("siteId", requestedSiteId);
    if (pageToken) query.set("pageToken", pageToken);
    const encoded = query.toString();
    return apiGet(encoded ? `/api/control/audit?${encoded}` : "/api/control/audit", response)
      .then((result) => {
        if (generation !== requestGeneration.current) return;
        setRows((previous) => replace ? result.items : [...previous, ...result.items]);
        setNextPageToken(result.nextPageToken);
        setLoadedSiteId(requestedSiteId);
      })
      .catch((error: unknown) => {
        if (generation === requestGeneration.current) {
          message.error(error instanceof Error ? error.message : "加载失败");
        }
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoading(false);
      });
  }, [message, siteId]);
  const startLoad = useCallback((pageToken: string | null, replace: boolean) => {
    setLoading(true);
    void loadPage(pageToken, replace);
  }, [loadPage]);

  useEffect(() => {
    void loadPage(null, true);
    return () => { requestGeneration.current += 1; };
  }, [loadPage]);

  const visibleRows = loadedSiteId === siteId ? rows : [];
  const visibleNextPageToken = loadedSiteId === siteId ? nextPageToken : null;
  const visibleLoading = loading || loadedSiteId !== siteId;

  const columns: ProColumns<Audit>[] = [
    { title: "Audit ref", dataIndex: "auditRef", copyable: true, ellipsis: true },
    { title: "动作", dataIndex: "actionCode", render: (_, row) => <Tag>{row.actionCode}</Tag> },
    { title: "发生时间", dataIndex: "occurredAt", valueType: "dateTime", width: 190 },
  ];
  return <PageContainer header={{ title: "审计" }}
    content={siteId ? `当前只查询已授权站点 ${siteId} 的 append-only 审计记录。` : "当前按全局操作员授权查询审计记录。"}>
    <ProTable<Audit> rowKey="auditRef" columns={columns} search={false} pagination={false}
      dataSource={visibleRows} loading={visibleLoading} options={{ reload: () => { startLoad(null, true); }, density: true }}
      toolBarRender={() => visibleNextPageToken ? [<Button key="load-more" loading={visibleLoading}
        onClick={() => { startLoad(visibleNextPageToken, false); }}>加载更多</Button>] : []} />
  </PageContainer>;
}
