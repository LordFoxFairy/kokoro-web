"use client";

import { Shield } from "lucide-react";

import { useLayout } from "@/context/layout-provider";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from "@/components/ui/sidebar";

import { NavGroup } from "./nav-group";
import { NavUser } from "./nav-user";
import { navigationForCapabilities } from "./sidebar-data";

export function AppSidebar({ capabilities = new Set<string>() }: { capabilities?: ReadonlySet<string> }) {
  const { collapsible } = useLayout();
  return <Sidebar collapsible={collapsible}>
    <SidebarHeader>
      <div className="flex h-10 items-center gap-2 px-2 text-sm font-semibold"><Shield className="size-4" /><span>Kokoro</span></div>
    </SidebarHeader>
    <SidebarContent>{navigationForCapabilities(capabilities).map((group) => <NavGroup key={group.title} {...group} />)}</SidebarContent>
    <SidebarFooter><NavUser /></SidebarFooter>
    <SidebarRail />
  </Sidebar>;
}
