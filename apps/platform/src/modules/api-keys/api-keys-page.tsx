import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import {
  isForbiddenError,
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevokeApiKeyMutation,
  type ApiKey,
} from "./hooks";

export function ApiKeysPage() {
  const query = useApiKeysQuery();
  const create = useCreateApiKeyMutation();
  const revoke = useRevokeApiKeyMutation();
  const [revealed, setRevealed] = useState<{ id: string; key: string } | null>(null);
  const [name, setName] = useState("");

  if (isForbiddenError(query.error)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin only</CardTitle>
          <CardDescription>API key management is restricted to administrators.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const keys = query.data?.keys ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Create keys for internal services to call the gateway. Each key is shown once.
          </p>
        </div>
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              setName("");
              create.reset();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <HugeiconsIcon icon={Key01Icon} className="size-4" />
              New API key
            </Button>
          </DialogTrigger>
          <DialogContent>
            {revealed ? (
              <>
                <DialogHeader>
                  <DialogTitle>Save this key</DialogTitle>
                  <DialogDescription>
                    This is the only time the full key will be shown. Copy it now.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border bg-muted/30 p-3">
                  <code className="block break-all text-xs">{revealed.key}</code>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(revealed.key)}
                  >
                    <HugeiconsIcon icon={Copy01Icon} className="size-4" /> Copy
                  </Button>
                  <Button onClick={() => setRevealed(null)}>Done</Button>
                </DialogFooter>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!name.trim()) return;
                  create.mutate(name.trim(), {
                    onSuccess: (data) => {
                      setRevealed({ id: data.id, key: data.key });
                      setName("");
                    },
                  });
                }}
              >
                <DialogHeader>
                  <DialogTitle>Create API key</DialogTitle>
                  <DialogDescription>
                    Give the key a memorable name — e.g. <code>billing-service</code>.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-2">
                  <Label htmlFor="key-name">Name</Label>
                  <Input
                    id="key-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. billing-service"
                    autoFocus
                    required
                  />
                  {create.error ? (
                    <p className="text-sm text-destructive">{create.error.message}</p>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? "Creating..." : "Create key"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{keys.length} keys</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet. Create one above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key: ApiKey) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      {key.isActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Revoked</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{key.creator.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(key.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!key.isActive || revoke.isPending}
                        onClick={() => revoke.mutate(key.id)}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
