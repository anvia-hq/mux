import { Badge } from "@repo/ui/components/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { isForbiddenError, useUsersQuery, type DashboardUser } from "./hooks";

export function UsersPage() {
  const query = useUsersQuery();

  if (isForbiddenError(query.error)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin only</CardTitle>
          <CardDescription>User management is restricted to administrators.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const users = query.data?.users ?? [];

  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Review registered dashboard accounts and access roles.
        </p>
      </div>

      <section className="grid min-w-0 gap-3">
        <h2 className="text-sm font-medium">{formatUserCount(users.length)}</h2>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <Card className="gap-0 overflow-hidden p-0">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user: DashboardUser) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name ?? "Not set"}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                        {formatRole(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.updatedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </div>
  );
}

function formatUserCount(count: number) {
  return `${count} ${count === 1 ? "user" : "users"}`;
}

function formatRole(role: DashboardUser["role"]) {
  return role === "ADMIN" ? "Admin" : "User";
}
