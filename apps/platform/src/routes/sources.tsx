import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/modules/auth/hooks/use-session";
import { SourcesPanel } from "@/modules/sources/components/sources-panel";

function SourcesPage() {
  const { user } = useSession();

  return <SourcesPanel isAdmin={user?.role === "admin"} />;
}

export const Route = createFileRoute("/sources")({ component: SourcesPage });
