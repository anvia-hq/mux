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
import { Switch } from "@repo/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { Add01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useCopyFeedback } from "../../lib/use-copy-feedback";
import {
  useCreateInvitationMutation,
  useInvitationSettingsQuery,
  useInvitationsQuery,
  useRevokeInvitationMutation,
  useUpdateInvitationSettingsMutation,
  type Invitation,
} from "../invitations/hooks";
import {
  isForbiddenError,
  usePromoteUserMutation,
  useUsersQuery,
  type DashboardUser,
} from "./hooks";

export function UsersPage() {
  const query = useUsersQuery();
  const invitationsQuery = useInvitationsQuery();
  const invitationSettingsQuery = useInvitationSettingsQuery();
  const createInvitation = useCreateInvitationMutation();
  const revokeInvitation = useRevokeInvitationMutation();
  const updateInvitationSettings = useUpdateInvitationSettingsMutation();
  const promoteUser = usePromoteUserMutation();
  const { copiedId, copy } = useCopyFeedback();
  const [balanceUsd, setBalanceUsd] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("1");
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [promotionTarget, setPromotionTarget] = useState<DashboardUser | null>(null);

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
  const invitations = invitationsQuery.data?.invitations ?? [];
  const inviteRegistrationEnabled = invitationSettingsQuery.data?.inviteRegistrationEnabled ?? true;

  function resetInviteForm() {
    setBalanceUsd("");
    setMaxRedemptions("1");
    setRevealedCode(null);
    createInvitation.reset();
  }

  function openPromotionDialog(user: DashboardUser) {
    promoteUser.reset();
    setPromotionTarget(user);
  }

  function closePromotionDialog() {
    if (!promoteUser.isPending) {
      setPromotionTarget(null);
    }
  }

  function confirmPromotion() {
    if (!promotionTarget) return;

    promoteUser.mutate(promotionTarget.id, {
      onSuccess: () => setPromotionTarget(null),
    });
  }

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Review registered dashboard accounts and invite new users.
          </p>
        </div>
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              resetInviteForm();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              New invite
            </Button>
          </DialogTrigger>
          <DialogContent>
            {revealedCode ? (
              <>
                <DialogHeader>
                  <DialogTitle>Send this invite code</DialogTitle>
                  <DialogDescription>
                    This is the only time the full code will be shown.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border bg-muted/30 p-3">
                  <code className="block break-all text-xs">{revealedCode}</code>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      copy({
                        value: revealedCode,
                        copiedId: invitationCopyId(revealedCode),
                        successMessage: "Invite code copied",
                        errorMessage: "Could not copy invite code",
                      })
                    }
                  >
                    <HugeiconsIcon icon={Copy01Icon} className="size-4" />
                    {copiedId === invitationCopyId(revealedCode) ? "Copied" : "Copy"}
                  </Button>
                  <Button type="button" onClick={() => setRevealedCode(null)}>
                    Done
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const parsedBalance = balanceUsd.trim() ? Number(balanceUsd.trim()) : null;
                  const parsedMaxRedemptions = maxRedemptions.trim()
                    ? Number(maxRedemptions.trim())
                    : 1;

                  if (
                    parsedBalance !== null &&
                    (!Number.isFinite(parsedBalance) || parsedBalance <= 0)
                  ) {
                    return;
                  }

                  if (!Number.isInteger(parsedMaxRedemptions) || parsedMaxRedemptions < 1) {
                    return;
                  }

                  createInvitation.mutate(
                    { balanceUsd: parsedBalance, maxRedemptions: parsedMaxRedemptions },
                    {
                      onSuccess: (data) => {
                        setRevealedCode(data.code);
                        setBalanceUsd("");
                        setMaxRedemptions("1");
                      },
                    },
                  );
                }}
              >
                <DialogHeader>
                  <DialogTitle>Create invite</DialogTitle>
                  <DialogDescription>
                    The balance becomes each new user&apos;s first API key limit.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-2">
                  <Label htmlFor="invite-balance">USD balance</Label>
                  <Input
                    id="invite-balance"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={balanceUsd}
                    onChange={(event) => setBalanceUsd(event.target.value)}
                    placeholder="Unlimited"
                  />
                  <Label htmlFor="invite-max-redemptions">Max redemptions</Label>
                  <Input
                    id="invite-max-redemptions"
                    type="number"
                    min="1"
                    step="1"
                    value={maxRedemptions}
                    onChange={(event) => setMaxRedemptions(event.target.value)}
                  />
                  {createInvitation.error ? (
                    <p className="text-sm text-destructive">{createInvitation.error.message}</p>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createInvitation.isPending}>
                    {createInvitation.isPending ? "Creating..." : "Create invite"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">Invite-code registration</CardTitle>
            <CardDescription>
              Control whether invitation codes can create new user accounts.
            </CardDescription>
          </div>
          <Switch
            id="invite-registration-enabled"
            aria-label="Enable invite-code registration"
            checked={inviteRegistrationEnabled}
            disabled={invitationSettingsQuery.isLoading || updateInvitationSettings.isPending}
            onCheckedChange={(checked) =>
              updateInvitationSettings.mutate({ inviteRegistrationEnabled: checked })
            }
          />
        </CardHeader>
        {updateInvitationSettings.error ? (
          <CardContent>
            <p className="text-sm text-destructive">{updateInvitationSettings.error.message}</p>
          </CardContent>
        ) : null}
      </Card>

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
                  <TableHead>User credit</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                      {formatUserCredit(user.spendLimitUsd)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.updatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {user.role === "ADMIN" ? (
                        <span className="text-xs text-muted-foreground">Already admin</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={promoteUser.isPending && promotionTarget?.id === user.id}
                          onClick={() => openPromotionDialog(user)}
                        >
                          Promote
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <Dialog
        open={Boolean(promotionTarget)}
        onOpenChange={(open) => !open && closePromotionDialog()}
      >
        {promotionTarget ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Promote user to admin?</DialogTitle>
              <DialogDescription>
                {promotionTarget.email} will be able to manage users, API keys, providers, and
                gateway settings.
              </DialogDescription>
            </DialogHeader>
            {promoteUser.error ? (
              <p className="text-sm text-destructive">{promoteUser.error.message}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={promoteUser.isPending}
                onClick={closePromotionDialog}
              >
                Cancel
              </Button>
              <Button type="button" disabled={promoteUser.isPending} onClick={confirmPromotion}>
                {promoteUser.isPending ? "Promoting..." : "Promote to admin"}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <section className="grid min-w-0 gap-3">
        <h2 className="text-sm font-medium">{formatInvitationCount(invitations.length)}</h2>
        {invitationsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invitations yet.</p>
        ) : (
          <Card className="gap-0 overflow-hidden p-0">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Redemptions</TableHead>
                  <TableHead>Latest redeemer</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium">**** {invitation.codeLastFour}</TableCell>
                    <TableCell>
                      <Badge variant={invitation.status === "pending" ? "default" : "secondary"}>
                        {formatInvitationStatus(invitation.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatInvitationBalance(invitation.balanceUsd)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatInvitationUsage(invitation)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invitation.redeemer?.email ?? "Not redeemed"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(invitation.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={invitation.status !== "pending" || revokeInvitation.isPending}
                        onClick={() => revokeInvitation.mutate(invitation.id)}
                      >
                        Revoke
                      </Button>
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

function formatInvitationCount(count: number) {
  return `${count} ${count === 1 ? "invitation" : "invitations"}`;
}

function formatInvitationStatus(status: Invitation["status"]) {
  switch (status) {
    case "pending":
      return "Pending";
    case "redeemed":
      return "Redeemed";
    case "revoked":
      return "Revoked";
  }
}

function formatInvitationBalance(balanceUsd: number | null) {
  return formatUsd(balanceUsd);
}

function formatInvitationUsage(invitation: Invitation) {
  return `${invitation.redeemedCount} / ${invitation.maxRedemptions}`;
}

function invitationCopyId(code: string) {
  return `invitation:${code}`;
}

function formatUserCredit(value: number | null | undefined) {
  return value === null || value === undefined ? "No account cap" : formatUsd(value);
}

function formatUsd(value: number | null | undefined) {
  return value === null || value === undefined ? "Unlimited" : `$${value.toFixed(2)}`;
}
