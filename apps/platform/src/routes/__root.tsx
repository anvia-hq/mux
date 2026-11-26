import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { AuthScreen } from "@/modules/auth/components/auth-screen";
import { useSession } from "@/modules/auth/hooks/use-session";
import { AppShell } from "@/modules/shell/components/app-shell";

function RootLayout() {
  const { user, isLoading, signOut } = useSession();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-xs text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <AppShell user={user} isSigningOut={signOut.isPending} onSignOut={() => signOut.mutate()}>
      <Outlet />
    </AppShell>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});
