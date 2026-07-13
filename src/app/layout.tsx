import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Geist, Geist_Mono } from "next/font/google";
import "antd/dist/reset.css";
import "./globals.css";
import { LocaleProvider } from "@/i18n/context";
import { ThemeProvider } from "@/ui/theme/theme-context";

// 首帧防闪：水合前同步定 documentElement 的 .dark class（读 localStorage 偏好 + 系统色）。
// 与 ThemeProvider 同键（kokoro.theme），运行期切换由 Provider 接管。
const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("kokoro.theme")||"system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kokoro Web",
  description: "Protocol-first Kokoro frontend shell for AGUI and SSE replay.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AntdRegistry>
          <ThemeProvider>
            <LocaleProvider>{children}</LocaleProvider>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
