import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

// 运营后台恒在鉴权门后、数据驱动，不做静态预渲染（也规避 Next16 turbopack 预渲染期
// 模块初始化顺序问题）。全路由动态渲染。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kokoro 管理后台",
  description: "Kokoro 平台管理后台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <AntdRegistry>
          <AppShell>{children}</AppShell>
        </AntdRegistry>
      </body>
    </html>
  );
}
