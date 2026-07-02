import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
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
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { Textarea } from "@repo/ui/components/textarea";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Copy01Icon, Delete02Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { useState, type FormEvent } from "react";
import { useCopyFeedback } from "../../lib/use-copy-feedback";
import { useApiKeysQuery, type ApiKey } from "../api-keys/hooks";
import { useUsersQuery, type DashboardUser } from "../users/hooks";
import {
  isForbiddenError,
  useApplyRedemptionMutation,
  useCreateRedemptionMutation,
  useDeleteRedemptionMutation,
  useRedemptionsQuery,
  useUpdateRedemptionMutation,
  type Redemption,
  type RedemptionTargetType,
} from "./hooks";

type CreatedRedemption = Redemption & { code: string };

export function RedemptionsPage() {
  const query = useRedemptionsQuery();
  const usersQuery = useUsersQuery();
  const apiKeysQuery = useApiKeysQuery();
  const create = useCreateRedemptionMutation();
  const update = useUpdateRedemptionMutation();
  const remove = useDeleteRedemptionMutation();
  const apply = useApplyRedemptionMutation();
  const { copiedId, copy } = useCopyFeedback();
  const [name, setName] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [count, setCount] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [createdRedemptions, setCreatedRedemptions] = useState<CreatedRedemption[] | null>(null);
  const [applyingRedemption, setApplyingRedemption] = useState<Redemption | null>(null);
  const [targetType, setTargetType] = useState<RedemptionTargetType>("USER");
  const [targetId, setTargetId] = useState("");

  if (isForbiddenError(query.error)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin only</CardTitle>
          <CardDescription>
            Redemption code management is restricted to administrators.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const redemptions = query.data?.redemptions ?? [];
  const users = usersQuery.data?.users ?? [];
  const apiKeys = apiKeysQuery.data?.keys ?? [];

  function resetCreateForm() {
    setName("");
    setAmountUsd("");
    setCount("1");
    setExpiresAt("");
    setCreatedRedemptions(null);
    create.reset();
  }

  function resetApplyForm() {
    setApplyingRedemption(null);
    setTargetType("USER");
    setTargetId("");
    apply.reset();
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amountUsd.trim());
    const parsedCount = count.trim() ? Number(count.trim()) : 1;
    const parsedExpiresAt = parseDateTimeLocal(expiresAt);

    if (!name.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 100) {
      return;
    }

    if (parsedExpiresAt === undefined) {
      return;
    }

    create.mutate(
      {
        name: name.trim(),
        amountUsd: parsedAmount,
        count: parsedCount,
        expiresAt: parsedExpiresAt,
      },
      {
        onSuccess: (data) => {
          setCreatedRedemptions(data.redemptions);
          setName("");
          setAmountUsd("");
          setCount("1");
          setExpiresAt("");
        },
      },
    );
  }

  function submitApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!applyingRedemption || !targetId) {
      return;
    }

    apply.mutate(
      {
        id: applyingRedemption.id,
        targetType,
        targetId,
      },
      {
        onSuccess: () => resetApplyForm(),
      },
    );
  }

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Redemptions</h1>
          <p className="text-sm text-muted-foreground">
            Create single-use USD credit codes and apply them to users or API keys.
          </p>
        </div>
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              resetCreateForm();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              New code
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            {createdRedemptions ? (
              <>
                <DialogHeader>
                  <DialogTitle>
                    Copy redemption code{createdRedemptions.length === 1 ? "" : "s"}
                  </DialogTitle>
                  <DialogDescription>
                    This is the only time the full value will be shown.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  readOnly
                  className="min-h-32 font-mono text-xs"
                  value={createdRedemptions.map((redemption) => redemption.code).join("\n")}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      copy({
                        value: createdRedemptions.map((redemption) => redemption.code).join("\n"),
                        copiedId: "redemption-created-codes",
                        successMessage: "Redemption code copied",
                        errorMessage: "Could not copy redemption code",
                      })
                    }
                  >
                    <HugeiconsIcon icon={Copy01Icon} className="size-4" />
                    {copiedId === "redemption-created-codes" ? "Copied" : "Copy"}
                  </Button>
                  <Button type="button" onClick={() => setCreatedRedemptions(null)}>
                    Done
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <form onSubmit={submitCreate}>
                <DialogHeader>
                  <DialogTitle>Create redemption code</DialogTitle>
                  <DialogDescription>
                    Generated codes can be shared or applied by an admin.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 py-2 sm:grid-cols-2">
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="redemption-name">Name</Label>
                    <Input
                      id="redemption-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. onboarding credit"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="redemption-amount">USD credit</Label>
                    <Input
                      id="redemption-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amountUsd}
                      onChange={(event) => setAmountUsd(event.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="redemption-count">Quantity</Label>
                    <Input
                      id="redemption-count"
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={count}
                      onChange={(event) => setCount(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="redemption-expires">Expires</Label>
                    <Input
                      id="redemption-expires"
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(event) => setExpiresAt(event.target.value)}
                    />
                  </div>
                  {create.error ? (
                    <p className="text-sm text-destructive sm:col-span-2">{create.error.message}</p>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? "Creating..." : "Create code"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Dialog
        open={Boolean(applyingRedemption)}
        onOpenChange={(open) => {
          if (!open) {
            resetApplyForm();
          }
        }}
      >
        <DialogContent>
          <form onSubmit={submitApply}>
            <DialogHeader>
              <DialogTitle>Apply redemption</DialogTitle>
              <DialogDescription>
                {applyingRedemption
                  ? `${formatUsd(applyingRedemption.amountUsd)} credit for ${applyingRedemption.name}`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label htmlFor="redemption-target-type">Target</Label>
                <NativeSelect
                  id="redemption-target-type"
                  className="w-full"
                  value={targetType}
                  onChange={(event) => {
                    setTargetType(event.target.value as RedemptionTargetType);
                    setTargetId("");
                  }}
                >
                  <NativeSelectOption value="USER">User credit</NativeSelectOption>
                  <NativeSelectOption value="API_KEY">API key credit</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="redemption-target-id">
                  {targetType === "USER" ? "User" : "API key"}
                </Label>
                <NativeSelect
                  id="redemption-target-id"
                  className="w-full"
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                  required
                >
                  <NativeSelectOption value="">
                    {targetType === "USER" ? "Select user" : "Select API key"}
                  </NativeSelectOption>
                  {targetType === "USER"
                    ? users.map((user) => (
                        <NativeSelectOption key={user.id} value={user.id}>
                          {formatUserOption(user)}
                        </NativeSelectOption>
                      ))
                    : apiKeys.map((key) => (
                        <NativeSelectOption key={key.id} value={key.id}>
                          {formatApiKeyOption(key)}
                        </NativeSelectOption>
                      ))}
                </NativeSelect>
              </div>
              {apply.error ? (
                <p className="text-sm text-destructive">{apply.error.message}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={apply.isPending || !targetId}>
                {apply.isPending ? "Applying..." : "Apply"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : redemptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No redemption codes yet.</p>
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Credit</TableHead>
                <TableHead>Applied to</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {redemptions.map((redemption) => (
                <TableRow key={redemption.id}>
                  <TableCell className="font-medium">**** {redemption.codeLastFour}</TableCell>
                  <TableCell>{redemption.name}</TableCell>
                  <TableCell>
                    <Badge variant={redemption.status === "active" ? "default" : "secondary"}>
                      {formatStatus(redemption.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatUsd(redemption.amountUsd)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatApplication(redemption)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {redemption.expiresAt
                      ? new Date(redemption.expiresAt).toLocaleString()
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(redemption.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={redemption.status !== "active" || apply.isPending}
                        onClick={() => setApplyingRedemption(redemption)}
                      >
                        <HugeiconsIcon icon={Link01Icon} className="size-4" />
                        Apply
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        disabled={redemption.status === "used" || update.isPending}
                        aria-label={
                          redemption.status === "disabled" ? "Enable code" : "Disable code"
                        }
                        onClick={() =>
                          update.mutate({
                            id: redemption.id,
                            status: redemption.status === "disabled" ? "ACTIVE" : "DISABLED",
                          })
                        }
                      >
                        <HugeiconsIcon
                          icon={redemption.status === "disabled" ? Add01Icon : Delete02Icon}
                          className="size-4"
                        />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        disabled={redemption.status === "used" || remove.isPending}
                        aria-label="Delete code"
                        onClick={() => remove.mutate(redemption.id)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function parseDateTimeLocal(value: string): string | null | undefined {
  if (!value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatUsd(value: number | null): string {
  if (value === null) {
    return "Unlimited";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function formatStatus(status: Redemption["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatApplication(redemption: Redemption): string {
  const application = redemption.application;

  if (!application) {
    return "Not applied";
  }

  if (application.targetType === "USER") {
    return application.user?.email ?? "Deleted user";
  }

  return application.apiKey
    ? `${application.apiKey.name} (${application.apiKey.creator.email})`
    : "Deleted API key";
}

function formatUserOption(user: DashboardUser): string {
  return `${user.email} · ${formatUserCredit(user.spendLimitUsd)}`;
}

function formatApiKeyOption(key: ApiKey): string {
  return `${key.name} · ${key.creator.email} · ${formatUsd(key.spendLimitUsd)}`;
}

function formatUserCredit(value: number | null | undefined): string {
  return value === null || value === undefined ? "No account cap" : formatUsd(value);
}
