"use client";

import { SafetyCertificateOutlined, ToolOutlined } from "@ant-design/icons";
import { Alert, App, Button, Drawer, FloatButton, Input, Segmented, Space, Typography } from "antd";
import { useState } from "react";

import type { DevelopmentFixtureInput, DevelopmentFixtureResult } from "../../modules/development-fixture/schema";

export type DevelopmentFixtureAction = (input: DevelopmentFixtureInput) => Promise<DevelopmentFixtureResult>;

export function DevelopmentFixtureTool({ action }: Readonly<{ action: DevelopmentFixtureAction }>): React.ReactElement {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [operation, setOperation] = useState<"bootstrap" | "reset">("bootstrap");
  const [result, setResult] = useState<DevelopmentFixtureResult | null>(null);

  async function submit(formData: FormData): Promise<void> {
    setPending(true);
    setResult(null);
    const common = { requestId: crypto.randomUUID(), email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") };
    const input: DevelopmentFixtureInput = operation === "bootstrap"
      ? { ...common, operation, userId: crypto.randomUUID(), name: String(formData.get("name") ?? "") }
      : { ...common, operation };
    try {
      const next = await action(input);
      setResult(next);
      if (next.status === "success") void message.success(next.operation === "bootstrap" ? "管理员已准备完成" : "密码已更新");
    } finally {
      setPending(false);
    }
  }

  const successText = result?.status === "success"
    ? result.operation === "bootstrap"
      ? result.outcome === "CREATED" ? "管理员已创建，可以使用账户密码登录。" : "管理员已存在，账户保持不变。"
      : "密码已更新，可以使用新密码登录。"
    : null;

  return (
    <>
      <FloatButton aria-label="开发管理员工具" icon={<ToolOutlined />} onClick={() => setOpen(true)} style={{ insetInlineEnd: 24, insetBlockEnd: 24 }} tooltip="开发管理员工具" />
      <Drawer open={open} title="开发管理员工具" size={420} onClose={() => setOpen(false)}>
        <Space orientation="vertical" size={20} style={{ width: "100%" }}>
          <Alert icon={<SafetyCertificateOutlined />} title="仅用于本地开发与自动化测试" description="创建测试管理员，或为已有管理员更新登录密码。" showIcon type="info" />
          <Segmented
            block
            value={operation}
            onChange={(value) => { setOperation(value as "bootstrap" | "reset"); setResult(null); }}
            options={[{ label: "创建管理员", value: "bootstrap" }, { label: "重置密码", value: "reset" }]}
          />
          <form action={submit}>
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {operation === "bootstrap" ? <label><Typography.Text strong>管理员名称</Typography.Text><Input name="name" autoComplete="name" maxLength={160} required /></label> : null}
              <label><Typography.Text strong>登录邮箱</Typography.Text><Input name="email" autoComplete="email" maxLength={320} required type="email" /></label>
              <label><Typography.Text strong>登录密码</Typography.Text><Input.Password name="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
              {successText === null ? null : <Alert title={successText} showIcon type="success" />}
              {result?.status !== "error" ? null : <Alert title={result.kind === "invalid" ? "请检查输入内容。" : "操作暂时未完成，请稍后重试。"} showIcon type="error" />}
              <Button aria-label={operation === "bootstrap" ? "创建并启用" : "更新密码"} block htmlType="submit" icon={<SafetyCertificateOutlined />} loading={pending} type="primary">{operation === "bootstrap" ? "创建并启用" : "更新密码"}</Button>
            </Space>
          </form>
        </Space>
      </Drawer>
    </>
  );
}
