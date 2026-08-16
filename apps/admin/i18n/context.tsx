"use client";

import { createI18n, type TranslateFn } from "@kokoro/i18n";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { en } from "./en";
import { DEFAULT_LOCALE, LOCALES, LOCALE_STORAGE_KEY, zh, type Locale, type MessageKey } from "./messages";

const i18n = createI18n<Locale, MessageKey>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  source: zh,
  overrides: { en },
});

type LocaleContextValue = Readonly<{
  locale: Locale;
  setLocale(next: Locale): void;
  t: TranslateFn<MessageKey>;
}>;

const LocaleContext = createContext<LocaleContextValue | null>(null);

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function browserLocale(): Locale {
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "en" || stored === "zh" ? stored : DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  const [override, setOverride] = useState<Locale | null>(null);
  const negotiated = useSyncExternalStore(subscribe, browserLocale, () => DEFAULT_LOCALE);
  const locale = override ?? negotiated;

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setOverride(next);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  }, []);
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: (key, vars) => i18n.translate(locale, key, vars) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}

export function useT(): TranslateFn<MessageKey> {
  return useLocale().t;
}
