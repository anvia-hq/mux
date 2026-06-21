import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/ui/components/sidebar";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  BookOpen01Icon,
  BoxesIcon,
  DashboardSquare01Icon,
  Key01Icon,
  Plug01Icon,
  Scroll01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { meQueryOptions, useLogoutMutation } from "../../auth/hooks/use-auth";

type NavItem = {
  to: string;
  label: string;
  icon: IconSvgElement;
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { to: "/", label: "Overview", icon: DashboardSquare01Icon },
  { to: "/api-keys", label: "API keys", icon: Key01Icon, adminOnly: true },
  { to: "/logs", label: "Logs", icon: Scroll01Icon },
  { to: "/models", label: "Models", icon: BoxesIcon },
  { to: "/docs", label: "Docs", icon: BookOpen01Icon },
  { to: "/providers", label: "Providers", icon: Plug01Icon, adminOnly: true },
  { to: "/settings", label: "Settings", icon: Settings01Icon },
];

export function AppShell() {
  const userQuery = useQuery(meQueryOptions);
  const logout = useLogoutMutation();
  const location = useLocation();
  const user = userQuery.data;

  if (!user) {
    return null;
  }

  const visibleItems = navItems.filter((item) => !item.adminOnly || user.role === "ADMIN");

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link
            to="/"
            aria-label="Mux Gateway"
            className="flex h-10 items-center px-2 text-sm font-semibold tracking-normal group-data-[collapsible=icon]:justify-center"
          >
            <span className="truncate group-data-[collapsible=icon]:hidden">Mux Gateway</span>
            <span aria-hidden="true" className="hidden group-data-[collapsible=icon]:block">
              M
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleItems.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={location.pathname === item.to}>
                      <Link to={item.to}>
                        <HugeiconsIcon icon={item.icon} className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user.name ?? user.email}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
            <Badge variant="secondary">{user.role}</Badge>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h1 className="text-sm font-medium text-muted-foreground">
              {visibleItems.find((i) => i.to === location.pathname)?.label ?? "Mux Gateway"}
            </h1>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {logout.isPending ? "Signing out..." : "Sign out"}
          </Button>
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
