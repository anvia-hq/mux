import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/modules/auth/hooks/use-session";
import { PlaygroundPanel } from "@/modules/playground/components/playground-panel";

function PlaygroundPage() {
  const { user } = useSession();

  if (user?.role !== "admin") {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        Admin access is required to run tools directly in the playground.
      </div>
    );
  }

  return <PlaygroundPanel />;
}

export const Route = createFileRoute("/playground")({ component: PlaygroundPage });
