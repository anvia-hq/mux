import { Button } from "@mux/ui/button";
import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { AuthScreen } from "@/modules/auth/components/auth-screen";
import { useSession } from "@/modules/auth/hooks/use-session";
import { AppShell } from "@/modules/shell/components/app-shell";

function RootLayout() {
  const { user, isLoading, error, refetch, signOut } = useSession();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-xs text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-sm font-medium text-destructive">
          Unable to connect to Mux API: {error instanceof Error ? error.message : "Unknown error"}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <AppShell
      user={user}
      isSigningOut={signOut.isPending}
      onSignOut={() => {
        void signOut.mutateAsync().catch(() => {});
      }}
    >
      <Outlet />
    </AppShell>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});
