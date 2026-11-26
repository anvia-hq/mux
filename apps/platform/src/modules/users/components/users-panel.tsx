import { Badge } from "@mux/ui/badge";
import { Button } from "@mux/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mux/ui/card";
import { useState } from "react";
import { useUsers } from "../hooks/use-users";

export function UsersPanel() {
  const { users, isLoading, error: queryError, updateRole } = useUsers();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Workspace Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage admin and member access across this Mux instance.
        </p>
      </div>

      {queryError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          Failed to load users: {queryError instanceof Error ? queryError.message : "Unknown error"}
        </div>
      ) : null}

      {errorMsg ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-xs text-muted-foreground">Loading users...</p> : null}
          {!isLoading && !queryError ? (
            <div className="divide-y divide-border">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{user.name}</span>
                      <Badge variant={user.role === "admin" ? "default" : "muted"}>
                        {user.role}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={updateRole.isPending}
                    onClick={async () => {
                      setErrorMsg(null);

                      try {
                        await updateRole.mutateAsync({
                          id: user.id,
                          role: user.role === "admin" ? "member" : "admin",
                        });
                      } catch (error) {
                        setErrorMsg(
                          error instanceof Error ? error.message : "Failed to update role.",
                        );
                      }
                    }}
                  >
                    {user.role === "admin" ? "Demote to Member" : "Promote to Admin"}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
