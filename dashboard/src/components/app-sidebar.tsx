"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TrendingUp, LayoutDashboard, Database, Filter, Boxes, Settings, LogOut, Users, ShoppingCart, PieChart } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const dashboardItems = [
  { title: "Tổng quan", href: "/dashboard", icon: PieChart },
];

const catcherItems = [
  { title: "Kho Domain", href: "/inventory", icon: Boxes },
  { title: "Domain Picker", href: "/domain-picker", icon: Filter },
  { title: "Backlink DB", href: "/aged-domain", icon: Database },
  { title: "Trend Domain", href: "/trend-domain/pipeline", icon: TrendingUp },
];

const osServiceItems = [
  { title: "Danh sách đối tác", href: "/os-service/partners", icon: Users },
  { title: "Danh sách đơn hàng", href: "/os-service/orders", icon: ShoppingCart },
];

const otherItems = [
  { title: "Cài đặt", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <Sidebar>
      {/* Header */}
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LayoutDashboard className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold tracking-tight">PG889</span>
        </div>
      </SidebarHeader>

      {/* Content */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dashboardItems.map((item) => (
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
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Domain Catcher</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {catcherItems.map((item) => (
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
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>OS Service</SidebarGroupLabel>
          <SidebarGroupContent>
            {osServiceItems.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground italic">
                Sắp ra mắt...
              </p>
            ) : (
              <SidebarMenu>
                {osServiceItems.map((item) => (
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
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer: Settings + Logout */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          {otherItems.map((item) => (
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
        <button
          onClick={handleLogout}
          className="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          <span>Đăng xuất</span>
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
