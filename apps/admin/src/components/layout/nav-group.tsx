"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

import type { NavGroup as NavGroupProps } from "./types";

export function NavGroup({ title, items }: NavGroupProps) {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          if (!("url" in item)) return null;
          const active = pathname === item.url || (item.url !== "/" && pathname.startsWith(`${item.url}/`));
          const Icon = item.icon;
          return <SidebarMenuItem key={item.url}>
            <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
              <Link href={item.url}>{Icon ? <Icon /> : null}<span>{item.title}</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>;
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
