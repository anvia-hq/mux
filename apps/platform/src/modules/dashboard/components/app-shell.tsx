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
import {
  KeyRoundIcon,
  LayoutDashboardIcon,
  LineChartIcon,
  ScrollTextIcon,
  SettingsIcon,
  SparklesIcon,
  BoxesIcon,
} from "lucide-react";
import { meQueryOptions, useLogoutMutation } from "../../auth/hooks/use-auth";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboardIcon },
  { to: "/api-keys", label: "API keys", icon: KeyRoundIcon, adminOnly: true },
  { to: "/logs", label: "Logs", icon: ScrollTextIcon },
  { to: "/models", label: "Models", icon: BoxesIcon },
  { to: "/prompts", label: "Prompts", icon: SparklesIcon, adminOnly: true },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
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
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <LineChartIcon className="size-4" />
            </div>
            <span className="truncate font-semibold">Mux Gateway</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleItems.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={location.pathname === item.to}>
                      <Link to={item.to}>
                        <item.icon className="size-4" />
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
