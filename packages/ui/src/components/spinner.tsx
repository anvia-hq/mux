import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@repo/ui/lib/utils";

function Spinner({ className, icon, ...props }: React.ComponentProps<typeof HugeiconsIcon>) {
  return (
    <HugeiconsIcon
      icon={icon ?? Loading01Icon}
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
