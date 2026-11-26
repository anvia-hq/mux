import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/modules/auth/hooks/use-session";
import { ToolsPanel } from "@/modules/tools/components/tools-panel";

function ToolsPage() {
  const { user } = useSession();

  return <ToolsPanel isAdmin={user?.role === "admin"} />;
}

export const Route = createFileRoute("/tools")({ component: ToolsPage });
