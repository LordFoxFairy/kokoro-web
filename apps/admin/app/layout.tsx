import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";

import { AdminProviders } from "@/components/providers/admin-providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "Kokoro 管理后台",
  description: "Kokoro 系统统一管理后台",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.ReactElement> {
  const developmentFixture = process.env.NODE_ENV === "production"
    ? null
    : await import("@/components/development-fixture/development-fixture-mount");
  const DevelopmentFixtureMount = developmentFixture?.DevelopmentFixtureMount;
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <AntdRegistry>
          <AdminProviders>
            {children}
            {DevelopmentFixtureMount === undefined ? null : <DevelopmentFixtureMount />}
          </AdminProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}
