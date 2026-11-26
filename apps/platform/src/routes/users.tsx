import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/modules/auth/hooks/use-session";
import { UsersPanel } from "@/modules/users/components/users-panel";

function UsersPage() {
  const { user } = useSession();

  if (user?.role !== "admin") {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        Admin access is required to manage workspace users.
      </div>
    );
  }

  return <UsersPanel />;
}

export const Route = createFileRoute("/users")({ component: UsersPage });
