import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
  Flowchart02Icon,
  Key01Icon,
  Logout01Icon,
  Plug01Icon,
  Scroll01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { meQueryOptions, useLogoutMutation } from "../../auth/hooks/use-auth";
import muxLogoUrl from "../../../assets/logo-mux.png";

type NavItem = {
  to: string;
  label: string;
  icon: IconSvgElement;
  adminOnly?: boolean;
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Dashboard",
    items: [
      { to: "/", label: "Overview", icon: DashboardSquare01Icon },
      { to: "/api-keys", label: "API keys", icon: Key01Icon, adminOnly: true },
      { to: "/logs", label: "Logs", icon: Scroll01Icon },
    ],
  },
  {
    label: "Connection",
    items: [
      { to: "/providers", label: "Providers", icon: Plug01Icon, adminOnly: true },
      { to: "/models", label: "Models", icon: BoxesIcon },
      { to: "/fallback-groups", label: "Fallbacks", icon: Flowchart02Icon, adminOnly: true },
    ],
  },
  {
    label: "Docs",
    items: [{ to: "/docs", label: "Documentation", icon: BookOpen01Icon }],
  },
  {
    items: [{ to: "/settings", label: "Account Settings", icon: Settings01Icon }],
  },
];

export function AppShell() {
  const userQuery = useQuery(meQueryOptions);
  const logout = useLogoutMutation();
  const location = useLocation();
  const user = userQuery.data;

  if (!user) {
    return null;
  }

  const isVisible = (item: NavItem) => !item.adminOnly || user.role === "ADMIN";
  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter(isVisible) }))
    .filter((group) => group.items.length > 0);
  const visibleItems = visibleGroups.flatMap((group) => group.items);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link
            to="/"
            aria-label="Mux Gateway"
            className="flex h-10 items-center gap-2 px-2 text-sm font-semibold tracking-normal group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <img
              src={muxLogoUrl}
              alt=""
              aria-hidden="true"
              className="size-6 shrink-0 rounded-[6px] object-cover"
            />
            <span className="truncate group-data-[collapsible=icon]:hidden">Mux Gateway</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {visibleGroups.map((group, index) => (
            <SidebarGroup
              key={group.label ?? "settings"}
              className={index === visibleGroups.length - 1 && !group.label ? "border-t pt-4" : ""}
            >
              {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
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
          ))}
        </SidebarContent>
        <SidebarFooter>
          <Card className="flex-row items-center gap-2 p-2">
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-medium">{user.name ?? user.email}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
            <Button
              aria-label={logout.isPending ? "Signing out" : "Sign out"}
              size="icon-sm"
              variant="outline"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <HugeiconsIcon icon={Logout01Icon} className="size-4" />
              <span className="sr-only">{logout.isPending ? "Signing out..." : "Sign out"}</span>
            </Button>
          </Card>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center justify-between border-b px-4 shadow-[0_2px_0_color-mix(in_oklab,var(--sidebar-border)_68%,black)]">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h1 className="text-sm font-medium text-muted-foreground">
              {visibleItems.find((i) => i.to === location.pathname)?.label ?? "Mux Gateway"}
            </h1>
          </div>
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
