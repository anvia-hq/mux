import { createFileRoute } from "@tanstack/react-router";
import { ApiKeysPanel } from "@/modules/api-keys/components/api-keys-panel";
import { useSession } from "@/modules/auth/hooks/use-session";

function ApiKeysPage() {
  const { user } = useSession();

  return <ApiKeysPanel isAdmin={user?.role === "admin"} />;
}

export const Route = createFileRoute("/api-keys")({ component: ApiKeysPage });
