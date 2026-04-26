"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, LayoutDashboard, Archive, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const navItems = [
  {
    title: "Trend Domain",
    href: "/trend-domain/pipeline",
    icon: TrendingUp,
  },
  {
    title: "Aged Domain",
    href: "/aged-domain",
    icon: Archive,
  },
  {
    title: "Cài đặt",
    href: "/settings",
    icon: Settings,
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
      <SidebarContent className="p-2">
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                isActive={pathname.startsWith(item.href)}
                className={cn(
                  "transition-colors",
                  pathname.startsWith(item.href) && "font-medium"
                )}
                render={<Link href={item.href} />}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
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
