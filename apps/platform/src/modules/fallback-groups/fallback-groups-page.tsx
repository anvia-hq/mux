import { type FormEvent, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  Edit02Icon,
  SaveIcon,
} from "@hugeicons/core-free-icons";
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
import { useModelsQuery, type Model } from "../models/hooks";
import {
  type FallbackGroup,
  type FallbackGroupInput,
  useCreateFallbackGroupMutation,
  useDeleteFallbackGroupMutation,
  useFallbackGroupsQuery,
  useUpdateFallbackGroupMutation,
} from "./hooks";
import { providerLabel } from "../providers/hooks";

type TargetDraft = {
  clientId: string;
  provider: string;
  modelId: string;
};

type FormState = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  targets: TargetDraft[];
};

function emptyForm(): FormState {
  return {
    id: "",
    name: "",
    description: "",
    enabled: true,
    targets: [createTargetDraft()],
  };
}

let targetDraftCounter = 0;

function createTargetDraft(provider = "", modelId = ""): TargetDraft {
  targetDraftCounter += 1;
  return { clientId: `target-${targetDraftCounter}`, provider, modelId };
}

function modelTargetId(model: Model) {
  const prefix = `${model.provider}:`;
  return model.id.startsWith(prefix) ? model.id.slice(prefix.length) : model.id;
}

function toFormState(group: FallbackGroup): FormState {
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? "",
    enabled: group.enabled,
    targets: group.targets.map((target) => createTargetDraft(target.provider, target.modelId)),
  };
}

function toInput(form: FormState): FallbackGroupInput {
  return {
    id: form.id.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    enabled: form.enabled,
    targets: form.targets.map((target) => ({
      provider: target.provider,
      modelId: target.modelId,
    })),
  };
}

function groupModelsByProvider(models: Model[]) {
  const groups = new Map<string, Model[]>();
  for (const model of models) {
    if (model.type === "fallback-group") continue;
    const existing = groups.get(model.provider) ?? [];
    existing.push(model);
    groups.set(model.provider, existing);
  }

  return Array.from(groups.entries())
    .map(([provider, providerModels]) => ({
      provider,
      models: providerModels.sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => providerLabel(a.provider).localeCompare(providerLabel(b.provider)));
}

export function FallbackGroupsPage() {
  const groupsQuery = useFallbackGroupsQuery();
  const modelsQuery = useModelsQuery();
  const createGroup = useCreateFallbackGroupMutation();
  const updateGroup = useUpdateFallbackGroupMutation();
  const deleteGroup = useDeleteFallbackGroupMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  const groups = groupsQuery.data?.data ?? [];
  const providerGroups = useMemo(
    () => groupModelsByProvider(modelsQuery.data?.data ?? []),
    [modelsQuery.data?.data],
  );
  const providerOptions = providerGroups.map((group) => group.provider);
  const isEditing = editingId !== null;
  const isSaving = createGroup.isPending || updateGroup.isPending;
  const saveError = createGroup.error ?? updateGroup.error;
  const deleteError = deleteGroup.error;

  function modelsForProvider(provider: string) {
    return providerGroups.find((group) => group.provider === provider)?.models ?? [];
  }

  function firstModelForProvider(provider: string) {
    const first = modelsForProvider(provider)[0];
    return first ? modelTargetId(first) : "";
  }

  function setTarget(index: number, next: Partial<TargetDraft>) {
    setForm((current) => ({
      ...current,
      targets: current.targets.map((target, targetIndex) => {
        if (targetIndex !== index) return target;
        const provider = next.provider ?? target.provider;
        const providerChanged = next.provider !== undefined && next.provider !== target.provider;
        return {
          clientId: target.clientId,
          provider,
          modelId: providerChanged
            ? firstModelForProvider(provider)
            : (next.modelId ?? target.modelId),
        };
      }),
    }));
  }

  function moveTarget(index: number, direction: -1 | 1) {
    setForm((current) => {
      const nextTargets = [...current.targets];
      const swapIndex = index + direction;
      if (swapIndex < 0 || swapIndex >= nextTargets.length) return current;
      [nextTargets[index], nextTargets[swapIndex]] = [nextTargets[swapIndex], nextTargets[index]];
      return { ...current, targets: nextTargets };
    });
  }

  function removeTarget(index: number) {
    setForm((current) => ({
      ...current,
      targets:
        current.targets.length === 1
          ? [createTargetDraft()]
          : current.targets.filter((_, targetIndex) => targetIndex !== index),
    }));
  }

  function addTarget() {
    const provider = providerOptions[0] ?? "";
    setForm((current) => ({
      ...current,
      targets: [...current.targets, createTargetDraft(provider, firstModelForProvider(provider))],
    }));
  }

  function editGroup(group: FallbackGroup) {
    setEditingId(group.id);
    setForm(toFormState(group));
    setFormError(null);
    setDialogOpen(true);
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  }

  function openCreateDialog() {
    resetForm();
    setDialogOpen(true);
  }

  function setDialogState(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      resetForm();
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const input = toInput(form);
    if (!input.id || !input.name) {
      setFormError("Group ID and name are required.");
      return;
    }
    if (input.targets.some((target) => !target.provider || !target.modelId)) {
      setFormError("Every fallback target needs a provider and model.");
      return;
    }

    if (isEditing) {
      await updateGroup.mutateAsync(input);
      setDialogState(false);
    } else {
      await createGroup.mutateAsync(input);
      setDialogState(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fallback groups</h1>
          <p className="text-sm text-muted-foreground">
            Create virtual models that try ordered provider targets when an upstream call fails.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="w-fit rounded-md">
            {groups.length} groups
          </Badge>
          <Button type="button" onClick={openCreateDialog}>
            <HugeiconsIcon icon={Add01Icon} className="size-4" />
            Create group
          </Button>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-2 border-b p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-medium">Configured groups</div>
            <div className="text-sm text-muted-foreground">
              Request these through the OpenAI-compatible API with the shown model ID.
            </div>
          </div>
          {deleteError ? <p className="text-destructive text-sm">{deleteError.message}</p> : null}
        </div>
        {groupsQuery.isLoading ? (
          <div className="grid gap-3 p-4">
            {["row-1", "row-2", "row-3"].map((row) => (
              <div key={row} className="h-16 rounded-md bg-secondary/60" />
            ))}
          </div>
        ) : !groups.length ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center">
            <div>
              <p className="text-sm font-medium">No fallback groups</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Create a virtual model after configuring at least one provider model.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={openCreateDialog}>
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Create group
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Targets</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="min-w-72 py-3">
                    <code className="text-xs font-medium">{group.publicModelId}</code>
                    <div className="mt-1 text-sm">{group.name}</div>
                    {group.description ? (
                      <div className="mt-1 max-w-xl text-xs text-muted-foreground">
                        {group.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="min-w-[28rem] py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {group.targets.map((target) => (
                        <Badge key={`${target.position}:${target.publicModelId}`} variant="outline">
                          {target.position}. {target.publicModelId}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={group.enabled ? "default" : "secondary"}>
                      {group.enabled ? "On" : "Off"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Edit ${group.name}`}
                        onClick={() => editGroup(group)}
                      >
                        <HugeiconsIcon icon={Edit02Icon} className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Delete ${group.name}`}
                        disabled={deleteGroup.isPending}
                        onClick={() => deleteGroup.mutate(group.id)}
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
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
          <form onSubmit={submitForm}>
            <DialogHeader>
              <DialogTitle>
                {isEditing ? "Edit fallback group" : "Create fallback group"}
              </DialogTitle>
              <DialogDescription>Targets are attempted top to bottom.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2 text-sm">
                <label htmlFor="fallback-group-id" className="font-medium">
                  Group ID
                </label>
                <Input
                  id="fallback-group-id"
                  value={form.id}
                  disabled={isEditing}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, id: event.target.value }))
                  }
                  placeholder="fast-chat"
                />
                <span className="text-xs text-muted-foreground">
                  Clients call mux:{form.id || "fast-chat"}
                </span>
              </div>

              <div className="grid gap-2 text-sm">
                <label htmlFor="fallback-group-name" className="font-medium">
                  Name
                </label>
                <Input
                  id="fallback-group-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Fast chat"
                />
              </div>

              <div className="grid gap-2 text-sm">
                <label htmlFor="fallback-group-description" className="font-medium">
                  Description
                </label>
                <Textarea
                  id="fallback-group-description"
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Primary low-latency chat route with a backup provider."
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <span>
                  <label htmlFor="fallback-group-enabled" className="block font-medium">
                    Enabled
                  </label>
                  <span className="text-muted-foreground text-xs">
                    Expose this group in /v1/models.
                  </span>
                </span>
                <Switch
                  id="fallback-group-enabled"
                  checked={form.enabled}
                  onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Targets</div>
                    <div className="text-xs text-muted-foreground">Ordered fallback chain</div>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={addTarget}>
                    <HugeiconsIcon icon={Add01Icon} className="size-4" />
                    Add
                  </Button>
                </div>

                <div className="grid gap-2">
                  {form.targets.map((target, index) => {
                    const providerModels = modelsForProvider(target.provider);
                    return (
                      <div key={target.clientId} className="grid gap-2 rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline">#{index + 1}</Badge>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Move target up"
                              disabled={index === 0}
                              onClick={() => moveTarget(index, -1)}
                            >
                              <HugeiconsIcon icon={ArrowUp01Icon} className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Move target down"
                              disabled={index === form.targets.length - 1}
                              onClick={() => moveTarget(index, 1)}
                            >
                              <HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Remove target"
                              onClick={() => removeTarget(index)}
                            >
                              <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-1.5 text-xs">
                          <label htmlFor={`${target.clientId}-provider`} className="font-medium">
                            Provider
                          </label>
                          <NativeSelect
                            id={`${target.clientId}-provider`}
                            value={target.provider}
                            onChange={(event) => setTarget(index, { provider: event.target.value })}
                            className="w-full"
                          >
                            <NativeSelectOption value="">Select provider</NativeSelectOption>
                            {providerOptions.map((provider) => (
                              <NativeSelectOption key={provider} value={provider}>
                                {providerLabel(provider)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>

                        <div className="grid gap-1.5 text-xs">
                          <label htmlFor={`${target.clientId}-model`} className="font-medium">
                            Model
                          </label>
                          <NativeSelect
                            id={`${target.clientId}-model`}
                            value={target.modelId}
                            onChange={(event) => setTarget(index, { modelId: event.target.value })}
                            disabled={!target.provider}
                            className="w-full"
                          >
                            <NativeSelectOption value="">Select model</NativeSelectOption>
                            {providerModels.map((model) => (
                              <NativeSelectOption key={model.id} value={modelTargetId(model)}>
                                {model.id}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
              {saveError ? <p className="text-destructive text-sm">{saveError.message}</p> : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogState(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving || modelsQuery.isLoading}>
                <HugeiconsIcon icon={SaveIcon} className="size-4" />
                {isSaving ? "Saving..." : isEditing ? "Save changes" : "Create group"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
