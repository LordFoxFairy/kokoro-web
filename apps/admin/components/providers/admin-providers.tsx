"use client";

import { App, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";

import { LocaleProvider, useLocale } from "@/i18n/context";
import { antdTheme } from "@/lib/theme";

function AntProviders({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  const { locale } = useLocale();

  return (
    <ConfigProvider locale={locale === "zh" ? zhCN : enUS} theme={antdTheme}>
      <App>{children}</App>
    </ConfigProvider>
  );
}

export function AdminProviders({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <LocaleProvider>
      <AntProviders>{children}</AntProviders>
    </LocaleProvider>
  );
}
