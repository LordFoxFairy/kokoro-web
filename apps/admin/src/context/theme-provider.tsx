"use client";

import * as React from "react";

export type Theme = "light" | "dark" | "system";

type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void };

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function resolveTheme(theme: Theme) {
  return theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
}

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const savedTheme = window.localStorage.getItem("theme");
  return savedTheme === "dark" || savedTheme === "light" || savedTheme === "system" ? savedTheme : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setStoredTheme] = React.useState<Theme>(initialTheme);

  React.useEffect(() => {
    const apply = () => document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = React.useCallback((nextTheme: Theme) => {
    window.localStorage.setItem("theme", nextTheme);
    setStoredTheme(nextTheme);
  }, []);

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
