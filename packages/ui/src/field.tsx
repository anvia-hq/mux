import { Field as BaseField } from "@base-ui/react/field";
import type { ReactNode } from "react";

export interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, children, className = "" }: FieldProps) {
  return (
    <BaseField.Root className={`flex flex-col gap-1.5 ${className}`}>
      <BaseField.Label className="text-xs font-medium text-muted-foreground">
        {label}
      </BaseField.Label>
      {children}
      {hint ? (
        <BaseField.Description className="text-xs text-muted-foreground">
          {hint}
        </BaseField.Description>
      ) : null}
    </BaseField.Root>
  );
}
