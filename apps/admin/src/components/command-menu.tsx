"use client";

import * as React from "react";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";

import { useSearch } from "@/context/search-provider";
import { useTheme } from "@/context/theme-provider";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { sidebarData } from "@/components/layout/sidebar-data";

export function CommandMenu() {
  const router = useRouter();
  const { open, setOpen } = useSearch();
  const { setTheme } = useTheme();
  const run = React.useCallback((action: () => void) => { setOpen(false); action(); }, [setOpen]);
  return <CommandDialog open={open} onOpenChange={setOpen}>
    <CommandInput placeholder="Search management" />
    <CommandList>
      <CommandEmpty>No matching destination.</CommandEmpty>
      {sidebarData.navGroups.map((group) => <CommandGroup key={group.title} heading={group.title}>{group.items.filter((item) => "url" in item).map((item) => "url" in item ? <CommandItem key={item.url} onSelect={() => run(() => router.push(item.url))}><ArrowRight />{item.title}</CommandItem> : null)}</CommandGroup>)}
      <CommandSeparator />
      <CommandGroup heading="Theme"><CommandItem onSelect={() => run(() => setTheme("light"))}><Sun />Light</CommandItem><CommandItem onSelect={() => run(() => setTheme("dark"))}><Moon />Dark</CommandItem></CommandGroup>
    </CommandList>
  </CommandDialog>;
}
