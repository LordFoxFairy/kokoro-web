import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function NavUser() {
  return <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" aria-label="Identity unavailable" disabled>
        <Avatar className="size-8 rounded-md"><AvatarFallback className="rounded-md">?</AvatarFallback></Avatar>
        <span className="truncate text-sm">Identity unavailable</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>;
}
