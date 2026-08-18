import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { NavigationProgress } from "@/components/navigation-progress";
import { SkipToMain } from "@/components/skip-to-main";
import { LayoutProvider } from "@/context/layout-provider";
import { SearchProvider } from "@/context/search-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return <SearchProvider><LayoutProvider><SidebarProvider>
    <SkipToMain /><NavigationProgress /><AppSidebar />
    <SidebarInset><Header />{children}</SidebarInset>
  </SidebarProvider></LayoutProvider></SearchProvider>;
}
