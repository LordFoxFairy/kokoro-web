"use client";

// React 绑定：LocaleProvider（协商初值 + 持久化切换）+ useT/useLocale。
// 引擎（协商/解析/插值）来自共享窄包 @kokoro/i18n；此处只做 React/存储副作用。

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createI18n, type TranslateFn } from "@kokoro/i18n";
import { DEFAULT_LOCALE, LOCALES, LOCALE_STORAGE_KEY, zh, type Locale, type MessageKey } from "./messages";
import { en } from "./en";

const i18n = createI18n<Locale, MessageKey>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  source: zh,
  overrides: { en },
});

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: TranslateFn<MessageKey>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function subscribeToLocaleStorage(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function browserLocale(): Locale {
  return i18n.negotiate(window.localStorage.getItem(LOCALE_STORAGE_KEY), navigator.languages);
}

export function LocaleProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [override, setOverride] = useState<Locale | null>(null);
  const negotiated = useSyncExternalStore(subscribeToLocaleStorage, browserLocale, () => DEFAULT_LOCALE);
  const locale = override ?? negotiated;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setOverride(next);
    if (typeof window !== "undefined") window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: (key, vars) => i18n.translate(locale, key, vars) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === null) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

export function useT(): TranslateFn<MessageKey> {
  return useLocale().t;
}
