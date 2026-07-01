import { type FormEvent, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, Edit02Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/native-select";
import { Switch } from "@repo/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { Textarea } from "@repo/ui/components/textarea";
import { useModelTargetsQuery, type Model } from "../models/hooks";
import {
  type ModelAlias,
  type ModelAliasInput,
  useCreateModelAliasMutation,
  useDeleteModelAliasMutation,
  useModelAliasesQuery,
  useUpdateModelAliasMutation,
} from "./hooks";

type FormState = {
  id: string;
  name: string;
  description: string;
  targetModelId: string;
  enabled: boolean;
};

function emptyForm(targetModelId = ""): FormState {
  return {
    id: "",
    name: "",
    description: "",
    targetModelId,
    enabled: true,
  };
}

function toFormState(alias: ModelAlias): FormState {
  return {
    id: alias.id,
    name: alias.name,
    description: alias.description ?? "",
    targetModelId: alias.targetModelId,
    enabled: alias.enabled,
  };
}

function toInput(form: FormState): ModelAliasInput {
  return {
    id: form.id.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    targetModelId: form.targetModelId,
    enabled: form.enabled,
  };
}

function targetOptions(models: Model[]) {
  return models
    .filter((model) => model.type !== "alias")
    .map((model) => ({
      id: model.id,
      label:
        model.type === "fallback-group"
          ? `${model.id} · fallback group`
          : `${model.id} · ${model.name}`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function ModelAliasesPage() {
  const aliasesQuery = useModelAliasesQuery();
  const modelsQuery = useModelTargetsQuery();
  const createAlias = useCreateModelAliasMutation();
  const updateAlias = useUpdateModelAliasMutation();
  const deleteAlias = useDeleteModelAliasMutation();
  const aliases = aliasesQuery.data?.data ?? [];
  const targets = useMemo(() => targetOptions(modelsQuery.data?.data ?? []), [modelsQuery.data]);
  const firstTarget = targets[0]?.id ?? "";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(firstTarget));
  const [formError, setFormError] = useState<string | null>(null);
  const isEditing = editingId !== null;
  const isSaving = createAlias.isPending || updateAlias.isPending;
  const saveError = createAlias.error ?? updateAlias.error;
  const deleteError = deleteAlias.error;

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm(firstTarget));
    setFormError(null);
  }

  function setDialogState(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      resetForm();
    }
  }

  function openCreateDialog() {
    setEditingId(null);
    setForm(emptyForm(firstTarget));
    setFormError(null);
    setDialogOpen(true);
  }

  function editAlias(alias: ModelAlias) {
    setEditingId(alias.id);
    setForm(toFormState(alias));
    setFormError(null);
    setDialogOpen(true);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const input = toInput(form);
    if (!input.id || !input.name || !input.targetModelId) {
      setFormError("Alias ID, name, and target model are required.");
      return;
    }

    if (isEditing) {
      await updateAlias.mutateAsync(input);
      setDialogState(false);
    } else {
      await createAlias.mutateAsync(input);
      setDialogState(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Model aliases</h1>
          <p className="text-sm text-muted-foreground">
            Map short model IDs to provider models or fallback groups.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="w-fit rounded-md">
            {aliases.length} aliases
          </Badge>
          <Button type="button" onClick={openCreateDialog}>
            <HugeiconsIcon icon={Add01Icon} className="size-4" />
            Create alias
          </Button>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-2 border-b p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-medium">Configured aliases</div>
            <div className="text-sm text-muted-foreground">
              Clients can pass these IDs as the OpenAI-compatible model value.
            </div>
          </div>
          {deleteError ? <p className="text-destructive text-sm">{deleteError.message}</p> : null}
        </div>
        {aliasesQuery.isLoading ? (
          <div className="grid gap-3 p-4">
            {["row-1", "row-2", "row-3"].map((row) => (
              <div key={row} className="h-16 rounded-md bg-secondary/60" />
            ))}
          </div>
        ) : !aliases.length ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center">
            <HugeiconsIcon icon={Link01Icon} className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">No model aliases</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Create an alias after configuring at least one provider model or fallback group.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={openCreateDialog}>
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Create alias
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aliases.map((alias) => (
                <TableRow key={alias.id}>
                  <TableCell className="min-w-72 py-3">
                    <code className="text-xs font-medium">{alias.id}</code>
                    <div className="mt-1 text-sm">{alias.name}</div>
                    {alias.description ? (
                      <div className="mt-1 max-w-xl text-xs text-muted-foreground">
                        {alias.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="min-w-72 py-3">
                    <Badge variant={alias.targetAvailable ? "outline" : "destructive"}>
                      {alias.targetModelId}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={alias.enabled ? "default" : "secondary"}>
                      {alias.enabled ? "On" : "Off"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Edit ${alias.name}`}
                        onClick={() => editAlias(alias)}
                      >
                        <HugeiconsIcon icon={Edit02Icon} className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Delete ${alias.name}`}
                        disabled={deleteAlias.isPending}
                        onClick={() => deleteAlias.mutate(alias.id)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogState}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submitForm}>
            <DialogHeader>
              <DialogTitle>{isEditing ? "Edit model alias" : "Create model alias"}</DialogTitle>
              <DialogDescription>Aliases expose a short model ID to API clients.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2 text-sm">
                <label htmlFor="model-alias-id" className="font-medium">
                  Alias ID
                </label>
                <Input
                  id="model-alias-id"
                  value={form.id}
                  disabled={isEditing}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, id: event.target.value }))
                  }
                  placeholder="fast-chat"
                />
              </div>

              <div className="grid gap-2 text-sm">
                <label htmlFor="model-alias-name" className="font-medium">
                  Name
                </label>
                <Input
                  id="model-alias-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Fast chat"
                />
              </div>

              <div className="grid gap-2 text-sm">
                <label htmlFor="model-alias-target" className="font-medium">
                  Target model
                </label>
                <NativeSelect
                  id="model-alias-target"
                  value={form.targetModelId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, targetModelId: event.target.value }))
                  }
                  className="w-full"
                >
                  <NativeSelectOption value="">Select target</NativeSelectOption>
                  {targets.map((target) => (
                    <NativeSelectOption key={target.id} value={target.id}>
                      {target.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>

              <div className="grid gap-2 text-sm">
                <label htmlFor="model-alias-description" className="font-medium">
                  Description
                </label>
                <Textarea
                  id="model-alias-description"
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Stable alias for low-latency chat traffic."
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <span>
                  <label htmlFor="model-alias-enabled" className="block font-medium">
                    Enabled
                  </label>
                  <span className="text-muted-foreground text-xs">
                    Expose this alias in /v1/models.
                  </span>
                </span>
                <Switch
                  id="model-alias-enabled"
                  checked={form.enabled}
                  onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
                />
              </div>

              {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
              {saveError ? <p className="text-destructive text-sm">{saveError.message}</p> : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogState(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving || !targets.length}>
                {isSaving ? "Saving..." : isEditing ? "Save changes" : "Create alias"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
