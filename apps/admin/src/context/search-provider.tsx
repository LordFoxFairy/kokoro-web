"use client";

import * as React from "react";

import { CommandMenu } from "@/components/command-menu";

type SearchContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const SearchContext = React.createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return <SearchContext value={{ open, setOpen }}>{children}<CommandMenu /></SearchContext>;
}

export function useSearch() {
  const context = React.useContext(SearchContext);
  if (!context) throw new Error("useSearch must be used within SearchProvider");
  return context;
}
