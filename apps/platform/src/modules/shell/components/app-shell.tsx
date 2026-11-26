import { Badge } from "@mux/ui/badge";
import { Button } from "@mux/ui/button";
import {
  IconActivity,
  IconApi,
  IconKey,
  IconLayoutDashboard,
  IconLogout,
  IconPlayerPlay,
  IconPlugConnected,
  IconTool,
  IconUsers,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SessionUser } from "@/modules/auth/types";

interface AppShellProps {
  user: SessionUser;
  onSignOut: () => void;
  isSigningOut: boolean;
  children: ReactNode;
}

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: IconLayoutDashboard, adminOnly: false },
  { to: "/sources", label: "Sources", icon: IconPlugConnected, adminOnly: false },
  { to: "/tools", label: "Tools & Cache", icon: IconTool, adminOnly: false },
  { to: "/endpoints", label: "Endpoints", icon: IconApi, adminOnly: false },
  { to: "/api-keys", label: "API Keys", icon: IconKey, adminOnly: false },
  { to: "/playground", label: "Playground", icon: IconPlayerPlay, adminOnly: true },
  { to: "/logs", label: "Execution Logs", icon: IconActivity, adminOnly: false },
  { to: "/users", label: "Users", icon: IconUsers, adminOnly: true },
] as const;

export function AppShell({ user, onSignOut, isSigningOut, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <IconPlugConnected size={16} stroke={1.75} />
          </div>
          <span className="font-mono text-sm font-semibold tracking-tight">mux</span>
          <Badge variant="default" className="ml-auto">
            v1
          </Badge>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            if (item.adminOnly && user.role !== "admin") {
              return null;
            }

            const Icon = item.icon;

            return (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
              >
                <Icon size={16} stroke={1.75} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">{user.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
            </div>
            <Badge variant={user.role === "admin" ? "default" : "muted"}>{user.role}</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            disabled={isSigningOut}
            onClick={onSignOut}
          >
            <IconLogout size={15} stroke={1.75} />
            <span>Sign out</span>
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-7">{children}</div>
      </main>
    </div>
  );
}
