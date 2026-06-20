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
import { Textarea } from "@repo/ui/components/textarea";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import {
  useCreatePromptMutation,
  useCreateVersionMutation,
  usePromptQuery,
  usePromptsQuery,
  useSetActiveVersionMutation,
  type Prompt,
  type PromptVersion,
} from "./hooks";

export function PromptsPage() {
  const list = usePromptsQuery();
  const prompts = list.data?.prompts ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Prompts</h1>
          <p className="text-sm text-muted-foreground">
            Versioned prompt templates. Each version is immutable; pick one as active per prompt.
          </p>
        </div>
        <NewPromptDialog />
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">{prompts.length} prompts</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {list.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : prompts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No prompts yet.</p>
            ) : (
              prompts.map((p: Prompt) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selectedId === p.id ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p._count?.versions ?? 0} versions
                    </div>
                  </div>
                  {p.activeVersion ? (
                    <Badge variant="secondary">v{p.activeVersion.version}</Badge>
                  ) : null}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <PromptDetail promptId={selectedId} />
      </div>
    </div>
  );
}

function NewPromptDialog() {
  const create = useCreatePromptMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");

  function reset() {
    setName("");
    setDescription("");
    setContent("");
    setModel("");
    setTemperature("");
    create.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <SparklesIcon className="size-4" />
          New prompt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || !content.trim()) return;
            create.mutate(
              {
                name: name.trim(),
                description: description.trim() || undefined,
                content: content,
                model: model.trim() || undefined,
                temperature: temperature ? Number(temperature) : undefined,
              },
              {
                onSuccess: () => {
                  setOpen(false);
                  reset();
                },
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Create prompt</DialogTitle>
            <DialogDescription>
              The first version is created automatically. You can add more versions after.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="support-greeting"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-desc">Description (optional)</Label>
              <Input
                id="p-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-content">Content</Label>
              <Textarea
                id="p-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="p-model">Model (optional)</Label>
                <Input
                  id="p-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-temp">Temperature (optional)</Label>
                <Input
                  id="p-temp"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                />
              </div>
            </div>
            {create.error ? (
              <p className="text-sm text-destructive">{create.error.message}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PromptDetail({ promptId }: { promptId: string | null }) {
  const detail = usePromptQuery(promptId);
  const addVersion = useCreateVersionMutation(promptId ?? "");
  const setActive = useSetActiveVersionMutation(promptId ?? "");
  const [newContent, setNewContent] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newTemp, setNewTemp] = useState("");

  if (!promptId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Select a prompt</CardTitle>
          <CardDescription>Choose a prompt on the left to view its versions.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (detail.isLoading || !detail.data) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">Loading...</CardContent>
      </Card>
    );
  }

  const prompt = detail.data.prompt;
  const versions = prompt.versions ?? [];

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{prompt.name}</CardTitle>
          <CardDescription>
            {prompt.description ?? "No description."} Active version:{" "}
            {prompt.activeVersion ? `v${prompt.activeVersion.version}` : "none"}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Add version</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!newContent.trim()) return;
              addVersion.mutate(
                {
                  content: newContent,
                  model: newModel.trim() || undefined,
                  temperature: newTemp ? Number(newTemp) : undefined,
                  notes: newNotes.trim() || undefined,
                },
                {
                  onSuccess: () => {
                    setNewContent("");
                    setNewNotes("");
                    setNewModel("");
                    setNewTemp("");
                  },
                },
              );
            }}
            className="grid gap-3"
          >
            <Textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={5}
              placeholder="New version content..."
              required
            />
            <div className="grid grid-cols-3 gap-3">
              <Input
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                placeholder="model (optional)"
              />
              <Input
                value={newTemp}
                onChange={(e) => setNewTemp(e.target.value)}
                placeholder="temp (optional)"
                type="number"
                step="0.1"
                min="0"
                max="2"
              />
              <Input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="release notes (optional)"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={addVersion.isPending}>
                {addVersion.isPending ? "Saving..." : "Add version"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{versions.length} versions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {versions.map((v: PromptVersion) => (
            <div
              key={v.id}
              className={`rounded-md border p-3 ${
                prompt.activeVersionId === v.id ? "border-primary" : ""
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Badge>v{v.version}</Badge>
                  {prompt.activeVersionId === v.id ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : null}
                  {v.model ? (
                    <span className="font-mono text-xs text-muted-foreground">{v.model}</span>
                  ) : null}
                  {typeof v.temperature === "number" ? (
                    <span className="text-xs text-muted-foreground">t={v.temperature}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                  {prompt.activeVersionId !== v.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate(v.id)}
                    >
                      Set active
                    </Button>
                  ) : null}
                </div>
              </div>
              <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
                {v.content}
              </pre>
              {v.notes ? (
                <p className="mt-2 text-xs text-muted-foreground">Notes: {v.notes}</p>
              ) : null}
              {v.creator?.email ? (
                <p className="mt-1 text-xs text-muted-foreground">By {v.creator.email}</p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
