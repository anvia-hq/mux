import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentPropsWithoutRef } from "react";

export interface InputProps extends Omit<ComponentPropsWithoutRef<typeof BaseInput>, "className"> {
  className?: string;
}

export function Input({ className = "", ...props }: InputProps) {
  return (
    <BaseInput
      {...props}
      className={`h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${className}`}
    />
  );
}
