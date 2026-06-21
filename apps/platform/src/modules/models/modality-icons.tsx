import {
  AudioWave01Icon,
  File01Icon,
  Image01Icon,
  Pdf01Icon,
  TextIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";

const modalityIcons: Record<string, IconSvgElement> = {
  text: TextIcon,
  image: Image01Icon,
  audio: AudioWave01Icon,
  video: Video01Icon,
  pdf: Pdf01Icon,
};

function labelForModality(modality: string) {
  return modality.slice(0, 1).toUpperCase() + modality.slice(1);
}

export function ModalityIcons({ modalities }: { modalities: string[] }) {
  if (!modalities.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1.5">
        {modalities.map((modality) => {
          const normalized = modality.toLowerCase();
          const label = labelForModality(modality);
          const icon = modalityIcons[normalized] ?? File01Icon;

          return (
            <Tooltip key={modality}>
              <TooltipTrigger asChild>
                <span
                  aria-label={label}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground"
                  role="img"
                  title={label}
                >
                  <HugeiconsIcon icon={icon} className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
