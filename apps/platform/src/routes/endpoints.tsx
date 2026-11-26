import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/modules/auth/hooks/use-session";
import { EndpointsPanel } from "@/modules/endpoints/components/endpoints-panel";

function EndpointsPage() {
  const { user } = useSession();

  return <EndpointsPanel isAdmin={user?.role === "admin"} />;
}

export const Route = createFileRoute("/endpoints")({ component: EndpointsPage });
