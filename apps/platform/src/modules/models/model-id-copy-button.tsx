import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

export function ModelIdCopyButton({ modelId }: { modelId: string }) {
  async function copyModelId() {
    try {
      await navigator.clipboard.writeText(modelId);
      toast.success("Model ID copied", { description: modelId });
    } catch {
      toast.error("Could not copy model ID");
    }
  }

  return (
    <button
      type="button"
      onClick={copyModelId}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 text-left transition-colors hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Copy model ID"
    >
      <code className="truncate font-medium text-xs">{modelId}</code>
      <HugeiconsIcon
        icon={Copy01Icon}
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}
