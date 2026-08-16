import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { AdminProviders } from "@/components/providers/admin-providers";

import "./globals.css";

const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

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
    <html
      lang="zh-CN"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AntdRegistry>
          <AdminProviders>{children}</AdminProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}
