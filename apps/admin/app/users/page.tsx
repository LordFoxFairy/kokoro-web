"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Descriptions, Empty, Input, Space, Tag } from "antd";
import { PageContainer, ProCard } from "@ant-design/pro-components";
import { SearchOutlined } from "@ant-design/icons";
import { z } from "zod";

import { useAdmin } from "@/components/shell/app-shell";
import { apiGet, queryString } from "@/lib/api";
import { LatestRequest } from "@/lib/cursor-window";

const userIdentitySchema = z.object({
  siteId: z.string().min(1).max(128),
  userRef: z.string().min(1).max(128),
  status: z.string().min(1).max(64),
  securityEpoch: z.string().regex(/^[0-9]{1,20}$/u),
}).strict();
type UserIdentity = z.infer<typeof userIdentitySchema>;

export default function UsersPage(): React.ReactElement {
  const { siteId } = useAdmin();
  return <SiteUserLookup key={siteId} siteId={siteId} />;
}

function SiteUserLookup({ siteId }: Readonly<{ siteId: string }>): React.ReactElement {
  const { message } = App.useApp();
  const [userRef, setUserRef] = useState("");
  const [result, setResult] = useState<UserIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requests = useRef(new LatestRequest());
  useEffect(() => {
    const gate = requests.current;
    return () => { gate.invalidate(); };
  }, []);

  async function lookup(): Promise<void> {
    const requestedUserRef = userRef.trim();
    if (!siteId) { message.error("请先在顶部选择 Site"); return; }
    if (!requestedUserRef) { message.error("请输入 User ref"); return; }
    const generation = requests.current.begin();
    setLoading(true); setResult(null); setError(null);
    try {
      const loaded = await apiGet(`/api/control/users/${encodeURIComponent(requestedUserRef)}?${
        queryString({ siteId })}`, userIdentitySchema);
      if (!requests.current.isCurrent(generation)) return;
      if (loaded.siteId !== siteId || loaded.userRef !== requestedUserRef) {
        throw new Error("admin_user.invalid_response");
      }
      setResult(loaded);
    } catch (reason) {
      if (requests.current.isCurrent(generation)) setError(reason instanceof Error ? reason.message : "admin_user.unavailable");
    } finally {
      if (requests.current.isCurrent(generation)) setLoading(false);
    }
  }

  return <PageContainer header={{ title: "用户身份" }}
    content="通过 typed AdminQueryService 在当前 Site 内精确查询一个用户；此页面不聚合积分或团队数据。">
    <ProCard style={{ marginBottom: 16 }}>
      <Space size="middle" wrap align="end">
        <Input style={{ width: 360, fontFamily: "var(--font-mono)" }} value={userRef}
          onChange={(event) => setUserRef(event.target.value)} onPressEnter={() => { void lookup(); }}
          placeholder="输入 User ref" allowClear />
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => { void lookup(); }}>
          查询
        </Button>
      </Space>
    </ProCard>
    {error && <Alert type="error" showIcon message="用户查询失败" description={error} style={{ marginBottom: 16 }} />}
    {!result ? <ProCard loading={loading}><Empty description="输入 User ref，查询当前 Site 内的身份" /></ProCard> :
      <ProCard title="身份事实" variant="outlined" headerBordered>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small" items={[
          { key: "site", label: "Site", children: result.siteId },
          { key: "user", label: "User ref", children: result.userRef },
          { key: "status", label: "状态", children: <Tag color={result.status === "active" ? "green" : "default"}>
            {result.status}</Tag> },
          { key: "epoch", label: "安全代次", children: result.securityEpoch },
        ]} />
      </ProCard>}
  </PageContainer>;
}
