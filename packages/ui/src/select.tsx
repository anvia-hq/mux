import { Field as BaseField } from "@base-ui/react/field";
import type { SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className = "", ...props }: SelectProps) {
  return (
    <BaseField.Control
      render={
        <select
          {...props}
          className={`h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${className}`}
        />
      }
    />
  );
}
