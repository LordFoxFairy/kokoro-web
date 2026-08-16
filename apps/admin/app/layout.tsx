import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";

import { AdminProviders } from "@/components/providers/admin-providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "Kokoro 管理后台",
  description: "Kokoro IAM 运营控制台",
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
          <AdminProviders>{children}</AdminProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}
