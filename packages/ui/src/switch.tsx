import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ComponentPropsWithoutRef } from "react";

export interface SwitchProps extends Omit<
  ComponentPropsWithoutRef<typeof BaseSwitch.Root>,
  "className"
> {
  className?: string;
}

export function Switch({ className = "", ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      {...props}
      className={`inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-muted p-0.5 transition-colors data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 ${className}`}
    >
      <BaseSwitch.Thumb className="block h-3.5 w-3.5 rounded-full bg-background transition-transform data-[checked]:translate-x-4" />
    </BaseSwitch.Root>
  );
}
