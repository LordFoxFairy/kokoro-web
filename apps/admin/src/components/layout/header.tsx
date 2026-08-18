"use client";

import { Search } from "lucide-react";

import { useSearch } from "@/context/search-provider";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeSwitch } from "@/components/theme-switch";

export function Header() {
  const { setOpen } = useSearch();
  return <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
    <SidebarTrigger />
    <div className="min-w-0 flex-1 text-sm font-medium">Management</div>
    <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}><Search /> <span>Search</span><kbd className="hidden text-xs text-muted-foreground sm:inline">Ctrl K</kbd></Button>
    <ThemeSwitch />
  </header>;
}
