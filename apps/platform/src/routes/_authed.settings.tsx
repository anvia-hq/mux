import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import { meQueryOptions, useLogoutMutation } from "../modules/auth/hooks/use-auth";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const user = useQuery(meQueryOptions).data;
  const logout = useLogoutMutation();

  if (!user) return null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Your account and session.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Account</CardTitle>
          <CardDescription>Information tied to your login.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Row label="Email" value={user.email} />
          <Row label="Name" value={user.name ?? "—"} />
          <Row label="Role" value={<Badge>{user.role}</Badge>} />
          <Row label="Created" value={new Date(user.createdAt).toLocaleString()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Session</CardTitle>
          <CardDescription>Sign out from this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <button
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {logout.isPending ? "Signing out..." : "Sign out"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
