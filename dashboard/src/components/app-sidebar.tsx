"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, Globe, LayoutDashboard } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const trendDomainItems = [
  {
    title: "Marketplace",
    href: "/trend-domain",
    icon: Globe,
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      {/* Header */}
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LayoutDashboard className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">DomainRadar</span>
            <span className="text-xs text-muted-foreground">Namecheap Tools</span>
          </div>
        </div>
      </SidebarHeader>

      {/* Content */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Trend Domain
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {trendDomainItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname === item.href}
                    className={cn(
                      "transition-colors",
                      pathname === item.href && "font-medium"
                    )}
                    render={<Link href={item.href} />}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-sidebar-border">
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Data from Namecheap · updates hourly
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
