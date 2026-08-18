"use client";

import { Check, Moon, Sun } from "lucide-react";

import { useTheme } from "@/context/theme-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Change theme"><Sun className="size-4 dark:hidden" /><Moon className="hidden size-4 dark:block" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {(["light", "dark", "system"] as const).map((option) => <DropdownMenuItem key={option} onSelect={() => setTheme(option)}>{option[0].toUpperCase() + option.slice(1)}{theme === option ? <Check className="ml-auto" /> : null}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
